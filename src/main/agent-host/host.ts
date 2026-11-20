// @env node
// Agent 宿主：Agent 实例生命周期、pi 事件 → UI 事件映射（含工具/用量/队列）、
// 权限门接线、steer 插话路由、会话恢复与落盘。
import { randomUUID } from "node:crypto";
import {
  Agent,
  type AgentEvent,
  type AgentMessage,
  type AgentTool,
} from "@earendil-works/pi-agent-core";
import type { AssistantMessageEvent, ToolResultMessage } from "@earendil-works/pi-ai";
import type {
  ActiveRun,
  AgentRunEvent,
  AgentStatus,
  ComposerDraft,
  FileDiff,
  InterruptedRun,
  PermissionDecision,
  PromptInput,
  RunRef,
  SessionMeta,
  SessionSettings,
  SessionSettingsInput,
  Snapshot,
  ToolRule,
  UiAgentEvent,
  UiMessage,
} from "@shared/contract";
import { APP_NAME, DEFAULT_THINKING_LEVEL } from "../../shared/constants";
import { applyMessageEvent } from "../../shared/message-events";
import { hasSavedModel, resolveSessionModel } from "../../shared/providers";
import { toPublicSettings } from "../settings";
import { decryptSecret } from "../settings/secrets";
import type { ProviderConfig, Settings } from "../settings/types";
import { readFileChange, restoreFileChange } from "../workspace/file-changes";
import { createToolPathResolver, normalizeWorkingDirectory } from "../workspace/paths";
import { getCommandShell } from "../workspace/shell";
import type { RecordedFileChange } from "../workspace/types";
import type { McpManager } from "./mcp";
import { prepareMentionPrompt } from "./mentions";
import { resolveModel } from "./models";
import { PermissionManager } from "./permissions";
import { actionFingerprint, completeToolResults } from "./recovery";
import { messageParts, messageText, SessionStore, toUiMessages } from "./session-store";
import { loadSkillBody, scanSkills, skillSection } from "./skills";
import { createTools, labelOf } from "./tools";
import { PLAN_TOOL_NAME } from "./tools/constants";
import { readPlanSteps } from "./tools/plan";
import type { ToolEnvironment } from "./tools/types";
import type {
  ReferencedUserMessage,
  RunCheckpoint,
  RunningTask,
  TimedAssistantMessage,
} from "./types";

type Broadcast = (event: UiAgentEvent) => void;

export interface HostDeps {
  store: SessionStore;
  getSettings: () => Settings;
  /** 持久化设置（供权限规则落盘） */
  saveSettings: (settings: Settings) => void;
  broadcast: Broadcast;
  /** 技能目录（userData/skills/），FR-5.8 注入源 */
  skillsDir: string;
  mcp: McpManager;
}

interface UsageAccumulator {
  input: number;
  output: number;
  cacheRead: number;
  costTotal: number;
}

export class AgentHost {
  private agent: Agent | null = null;
  private agentSessionId: string | null = null;
  private agentProvider: ProviderConfig | null = null;
  /** 创建当前 Agent 实例时的完整 systemPrompt（人设/技能/会话覆盖变更 → 指纹变化即重建） */
  private agentSystemPrompt: string | null = null;
  private agentToolEnvironment: ToolEnvironment | null = null;
  private localTools: AgentTool[] = [];
  private readonly promptSkillInstructions = new Map<AgentMessage, readonly string[]>();
  private readonly thinkingStarts = new Map<number, number>();
  private thinkingDurations: Record<number, number> = {};
  private run?: RunningTask;
  private runningPrompt?: Promise<void>;
  private readonly sessionRules = new Map<string, ToolRule[]>();
  private sessionId: string | null = null;
  private composerId: string = randomUUID();
  private draftWorkingDirectory?: string;
  private uiMessages: UiMessage[] = [];
  private error: string | null = null;
  private nextId = 0;
  private unsubscribe: (() => void) | null = null;
  private usage: UsageAccumulator = { input: 0, output: 0, cacheRead: 0, costTotal: 0 };
  /** 最近一轮助手消息的上下文占用（input + cacheRead + cacheWrite + output） */
  private contextTokens = 0;
  /** 当前模型的上下文窗口（无 Agent 实例/未知模型 = null） */
  private contextWindow: number | null = null;
  private steerCount = 0;

  constructor(private readonly deps: HostDeps) {}

  private addGlobalRule(rule: ToolRule): void {
    const settings = this.deps.getSettings();
    this.deps.saveSettings({ ...settings, toolRules: [...(settings.toolRules ?? []), rule] });
  }

  private selectedRun(ref: RunRef): RunningTask | undefined {
    const run = this.run;
    return run?.state.runId === ref.runId &&
      run.state.sessionId === ref.sessionId &&
      this.sessionId === ref.sessionId
      ? run
      : undefined;
  }

  respondPermission(ref: RunRef, requestId: string, decision: PermissionDecision): void {
    const run = this.selectedRun(ref);
    if (!run?.permissions.respond(requestId, decision)) return;
    this.send({ type: "permission_resolved", requestId });
    if (!run.permissions.hasPending()) this.sendStatus("streaming");
  }

  private send(event: AgentRunEvent): void {
    if (!this.run) return;
    this.uiMessages = applyMessageEvent(this.uiMessages, event);
    if (event.type === "error") this.error = event.message;
    const { runId, sessionId } = this.run.state;
    this.deps.broadcast({ ...event, run: { runId, sessionId } });
  }

  private sendStatus(status: Exclude<AgentStatus, "idle">): void {
    if (!this.run || this.run.state.status === status) return;
    this.run.state = { ...this.run.state, status };
    this.send({ type: "status", status });
  }

  private sendSessions(activeSessionId?: string): SessionMeta[] {
    const sessions = this.deps.store.list();
    this.deps.broadcast({
      type: "sessions",
      sessions,
      recentProjects: this.deps.store.listRecentProjects(sessions),
      activeSessionId,
    });
    return sessions;
  }

  private getCurrentSession(): SessionMeta | null {
    return this.sessionId ? this.deps.store.getMeta(this.sessionId) : null;
  }

  getProjectDirectory(): string | undefined {
    return this.sessionId ? this.getCurrentSession()?.workingDirectory : this.draftWorkingDirectory;
  }

  getWorkingDirectory(): string | undefined {
    const active = this.run?.state;
    if (active && active.sessionId === this.sessionId) return active.workingDirectory ?? undefined;
    const interrupted = this.sessionId && this.deps.store.checkpoint(this.sessionId);
    if (interrupted) return interrupted.workingDirectory ?? undefined;
    return this.getProjectDirectory() ?? this.deps.getSettings().workingDirectory;
  }

  private interruptedRunOf(sessionId: string): InterruptedRun | undefined {
    const checkpoint = this.deps.store.checkpoint(sessionId);
    if (checkpoint) {
      return { sessionId, runId: checkpoint.runId, workingDirectory: checkpoint.workingDirectory };
    }
  }

  hasActiveRun(): boolean {
    return this.run !== undefined;
  }

  private ensureSession(workingDirectory: string | undefined, settings?: SessionSettings): string {
    if (this.sessionId) return this.sessionId;
    const meta = this.deps.store.create(workingDirectory, this.composerId, settings);
    this.sessionId = meta.id;
    this.draftWorkingDirectory = undefined;
    this.sendSessions(meta.id);
    return meta.id;
  }

  /**
   * 组装 systemPrompt（FR-1.7 / FR-5.9，注入顺序固定）：
   * 应用提示词 → 人设/自定义指令（会话 personaOverride 优先于全局 persona）→ 启用技能 sections。
   */
  private buildSystemPrompt(
    sessionId: string,
    settings: Settings,
    workingDirectory: string | undefined,
  ): string {
    const sections = [`You are a helpful assistant running inside ${APP_NAME}.`];
    if (workingDirectory) {
      sections.push(
        "When citing a known workspace item in a reply, link to its workspace-relative path in Markdown. Use a trailing / for folders and add #L followed by the line number for files when known. URL-encode spaces and brackets in the link target.",
      );
    }

    const meta = this.deps.store.getMeta(sessionId);
    const custom = (meta?.personaOverride ?? settings.persona ?? "").trim();
    if (custom.length > 0) {
      sections.push(`## 个性化指令\n\n${custom}`);
    }

    const enabled = new Set(settings.skillsEnabled ?? []);
    for (const skill of scanSkills(this.deps.skillsDir, [...enabled])) {
      if (!skill.enabled) continue;
      const body = loadSkillBody(this.deps.skillsDir, skill.id);
      if (body && body.length > 0) {
        sections.push(skillSection(skill.name, body));
      }
    }
    return sections.join("\n\n");
  }

  private prepareRequestMessages(messages: AgentMessage[], systemPrompt: string): AgentMessage[] {
    // Apply explicit skills to the model request without putting their bodies in the transcript.
    return messages.map((message) => {
      if (message.role === "toolResult" && readFileChange(message.toolName, message.details)) {
        return { ...message, details: undefined };
      }
      if (message.role !== "user") return message;
      const sections = this.promptSkillInstructions
        .get(message)
        ?.filter((section) => !systemPrompt.includes(section));
      const { pilotReference, ...providerMessage } = message as ReferencedUserMessage;
      if (!pilotReference && !sections?.length) return message;
      const content = [messageText(message)];
      if (typeof pilotReference?.context === "string") content.push(pilotReference.context);
      if (sections?.length) content.push("## Skills selected for this request", ...sections);
      return {
        ...providerMessage,
        content: content.join("\n\n"),
      };
    });
  }

  /** 确保当前会话有 Agent 实例；跨会话或 provider/模型/systemPrompt 变更时重建（转录从落盘恢复） */
  private ensureAgent(workingDirectory: string | undefined): Agent {
    const settings = this.deps.getSettings();
    const selection = resolveSessionModel(settings, this.getCurrentSession()?.model);
    const provider = selection && settings.providers.find((p) => p.id === selection.providerId);
    if (!selection || !provider) throw new Error("尚未配置 provider，请先到设置页添加");
    const active = { ...provider, modelId: selection.modelId };

    if (workingDirectory) createToolPathResolver(workingDirectory)(".");
    const sessionId = this.ensureSession(workingDirectory);
    const systemPrompt = this.buildSystemPrompt(sessionId, settings, workingDirectory);
    const toolEnvironment: ToolEnvironment = {
      workingDirectory,
      commandShell: getCommandShell(settings.commandShell),
    };

    // FR-1.6：provider/模型变更；FR-1.7/5.9：人设/技能变更 → 重建，下一轮请求生效（上下文不丢）
    if (
      this.agent &&
      this.agentSessionId === sessionId &&
      !this.deps.store.checkpoint(sessionId) &&
      this.agentProvider?.id === active.id &&
      this.agentProvider.kind === active.kind &&
      this.agentProvider.modelId === active.modelId &&
      this.agentProvider.baseUrl === active.baseUrl &&
      this.agentProvider.apiKey === active.apiKey &&
      this.agentSystemPrompt === systemPrompt &&
      this.agentToolEnvironment?.workingDirectory === toolEnvironment.workingDirectory &&
      this.agentToolEnvironment?.commandShell === toolEnvironment.commandShell
    ) {
      this.agent.state.thinkingLevel = settings.thinkingLevel ?? DEFAULT_THINKING_LEVEL;
      return this.agent;
    }

    if (this.agentSessionId !== sessionId) this.resetAgent();
    const apiKey = decryptSecret(active.apiKey);
    const { model, streamFn } = resolveModel(active, apiKey);
    const { contextWindow } = model;
    this.contextWindow = Number.isFinite(contextWindow) && contextWindow > 0 ? contextWindow : null;

    this.localTools = createTools(toolEnvironment);
    const messages = this.deps.store.load(sessionId);
    // When resuming, pi takes the prompt from the leading system message.
    const first = messages[0];
    if (first?.role === "system") messages[0] = { ...first, content: systemPrompt };
    const agent = new Agent({
      initialState: {
        systemPrompt,
        model,
        tools: this.localTools,
        messages,
        thinkingLevel: settings.thinkingLevel ?? DEFAULT_THINKING_LEVEL,
      },
      streamFn,
      transformContext: async (contextMessages) =>
        this.prepareRequestMessages(contextMessages, systemPrompt),
      beforeToolCall: async ({ toolCall, args }, signal) => {
        signal?.throwIfAborted();
        const run = this.run;
        if (!run) throw new Error("工具调用缺少活动运行。");
        const action = actionFingerprint(toolCall.name, args, workingDirectory);
        if (action && run.previousActions.has(action)) {
          return {
            block: true,
            reason:
              "This operation was already started before the interruption. Use its saved result or verify its effects in the workspace.",
          };
        }
        if (run.persistError) throw run.persistError;
        const result = await run.permissions.gate(
          toolCall.name,
          args,
          this.deps.mcp.policyOf(toolCall.name),
        );
        if (!result?.block && !signal?.aborted) {
          if (action && !run.checkpoint.actions.includes(action)) {
            this.checkpointRun(run, {
              ...run.checkpoint,
              actions: [...run.checkpoint.actions, action],
            });
          }
          this.reportTool("tool_start", toolCall.id, toolCall.name, toolCall.arguments);
        }
        return result;
      },
    });

    this.unsubscribe?.();
    this.unsubscribe = agent.subscribe((event) => this.onAgentEvent(event));
    this.agent = agent;
    this.agentSessionId = sessionId;
    this.agentProvider = active;
    this.agentSystemPrompt = systemPrompt;
    this.agentToolEnvironment = toolEnvironment;
    this.uiMessages = toUiMessages(agent.state.messages, "s");
    // id 计数只数 UI 可见消息（user/assistant），与事件侧计数保持一致
    this.nextId = this.uiMessages.length;
    return agent;
  }

  private reportTool(
    type: "tool_call" | "tool_start",
    callId: string,
    toolName: string,
    args: unknown,
  ): void {
    const message = this.uiMessages.at(-1);
    if (toolName === PLAN_TOOL_NAME || message?.role !== "assistant") return;
    if (
      type === "tool_call" &&
      message.parts.some((part) => part.type === "tool" && part.callId === callId)
    )
      return;
    this.send({
      type,
      id: message.id,
      callId,
      toolName,
      label: this.toolLabel(toolName),
      inputSummary: JSON.stringify(args) ?? "{}",
    });
  }

  private finishThinking(id: string, blockIndex: number, text: string): void {
    const startedAt = this.thinkingStarts.get(blockIndex);
    this.thinkingStarts.delete(blockIndex);
    const durationMs =
      startedAt === undefined ? undefined : Math.round(performance.now() - startedAt);
    if (durationMs !== undefined) this.thinkingDurations[blockIndex] = durationMs;
    this.send({ type: "thinking_end", id, blockIndex, text, durationMs });
  }

  private onAssistantUpdate(event: AssistantMessageEvent): void {
    const last = this.uiMessages.at(-1);
    if (last?.role !== "assistant") return;
    const { id } = last;
    switch (event.type) {
      case "text_delta":
        this.send({ type: "assistant_delta", id, delta: event.delta });
        break;
      case "thinking_start":
        this.thinkingStarts.set(event.contentIndex, performance.now());
        this.send({ type: "thinking_start", id, blockIndex: event.contentIndex });
        break;
      case "thinking_delta":
        this.send({
          type: "thinking_delta",
          id,
          blockIndex: event.contentIndex,
          delta: event.delta,
        });
        break;
      case "thinking_end":
        this.finishThinking(id, event.contentIndex, event.content);
        break;
      case "toolcall_end":
        this.reportTool(
          "tool_call",
          event.toolCall.id,
          event.toolCall.name,
          event.toolCall.arguments,
        );
        break;
    }
  }

  private onAgentEvent(event: AgentEvent): void {
    const run = this.run;
    if (!run) return;
    if (event.type === "message_end" && event.message.role === "user") {
      const pending = run.checkpoint.pending.filter((message) => message !== event.message);
      this.checkpointRun(run, { ...run.checkpoint, pending });
      return;
    }

    if (event.type === "message_start") {
      const message = event.message;
      if (message.role === "user") {
        this.send({
          type: "user_message",
          message: {
            id: "s-" + this.nextId++,
            role: "user",
            parts: messageParts(message),
          },
        });
      } else if (message.role === "assistant") {
        this.thinkingStarts.clear();
        this.thinkingDurations = {};
        this.send({ type: "assistant_start", id: "s-" + this.nextId++ });
      }
      return;
    }

    if (event.type === "message_update") {
      this.onAssistantUpdate(event.assistantMessageEvent);
      return;
    }

    if (event.type === "message_end" && event.message.role === "assistant") {
      const assistant: TimedAssistantMessage = event.message;
      if (assistant.usage) {
        this.usage.input += assistant.usage.input;
        this.usage.output += assistant.usage.output;
        this.usage.cacheRead += assistant.usage.cacheRead;
        this.usage.costTotal += assistant.usage.cost?.total ?? 0;
        // 上下文占用 = 最近一轮（不是累计）：请求携带的 input/cache + 本轮输出
        const u = assistant.usage;
        this.contextTokens = u.input + u.output + u.cacheRead + (u.cacheWrite ?? 0);
        this.send({
          type: "usage",
          tokens: {
            input: this.usage.input,
            output: this.usage.output,
            cacheRead: this.usage.cacheRead,
          },
          costTotal: this.usage.costTotal,
          contextTokens: this.contextTokens,
          contextWindow: this.contextWindow,
        });
      }
      const last = this.uiMessages.at(-1);
      if (last?.role === "assistant") {
        for (const blockIndex of this.thinkingStarts.keys()) {
          const block = assistant.content[blockIndex];
          if (block?.type === "thinking") this.finishThinking(last.id, blockIndex, block.thinking);
        }
        if (Object.keys(this.thinkingDurations).length > 0)
          assistant.pilotThinkingDurations = this.thinkingDurations;
        // Save the tool calls before pi asks for approval or starts any of them.
        this.checkpointRun(run);
        this.send({ type: "assistant_end", id: last.id });
      }
      return;
    }

    if (event.type === "tool_execution_start") {
      this.reportTool("tool_call", event.toolCallId, event.toolName, event.args);
      return;
    }

    if (event.type === "tool_execution_update") {
      if (event.toolName === PLAN_TOOL_NAME) return;
      const output = resultText(event.partialResult);
      if (output !== undefined)
        this.send({ type: "tool_update", callId: event.toolCallId, output });
      return;
    }

    if (event.type === "tool_execution_end") {
      // Parallel tools publish completion before pi adds their result messages to the transcript.
      run.finishedTools.set(event.toolCallId, {
        role: "toolResult",
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        content: event.result.content ?? [],
        details: event.result.details,
        usage: event.result.usage,
        durationMs: event.durationMs,
        isError: event.isError,
        timestamp: Date.now(),
      });
      this.checkpointRun(run);
      if (event.toolName === PLAN_TOOL_NAME) {
        const steps = event.isError ? undefined : readPlanSteps(event.result.details);
        if (steps) this.send({ type: "plan", steps });
        return;
      }
      const output = resultText(event.result);
      this.send({
        type: "tool_end",
        callId: event.toolCallId,
        state: event.isError ? "error" : "success",
        output,
        error: event.isError ? (output ?? "工具执行失败") : undefined,
        durationMs: event.durationMs,
      });
      return;
    }

    if (event.type === "message_end" && event.message.role === "toolResult") {
      run.finishedTools.delete(event.message.toolCallId);
      const change = readFileChange(event.message.toolName, event.message.details);
      if (change)
        this.send({
          type: "file_change",
          callId: event.message.toolCallId,
          change: change.summary,
        });
      return;
    }

    if (event.type === "turn_end") {
      this.checkpointRun(run);
      const queued = this.agent?.peekQueuedMessages() ?? [];
      this.steerCount = queued.length;
      this.send({ type: "queue", steerCount: this.steerCount });
      return;
    }
  }

  private checkpointRun(run: RunningTask, checkpoint = run.checkpoint): void {
    try {
      this.deps.store.writeTranscript(
        run.state.sessionId,
        [...(this.agent?.state.messages ?? []), ...run.finishedTools.values()],
        checkpoint,
      );
      run.checkpoint = checkpoint;
    } catch (error) {
      run.persistError = error;
      this.agent?.abort();
      throw error;
    }
  }

  private settle(sessionId: string, messages: AgentMessage[]): void {
    this.deps.store.save(sessionId, messages);
    this.uiMessages = toUiMessages(messages, "s", (name) => this.toolLabel(name));
    this.nextId = this.uiMessages.length;
    this.send({ type: "messages", messages: this.uiMessages });
    const last = messages.at(-1);
    if (last?.role === "assistant" && last.stopReason === "error") {
      this.send({ type: "error", message: last.errorMessage ?? "模型返回错误" });
    }
    this.sendSessions();
  }

  private toolLabel(name: string): string {
    return this.deps.mcp.policyOf(name)?.label ?? labelOf(name);
  }

  checkWorkingDirectory(expected: string | null): void {
    if ((this.getWorkingDirectory() ?? null) !== expected) {
      throw new Error("工作目录已变更，请重新选择文件引用。");
    }
  }

  private checkComposerId(id: string): void {
    if (id !== this.composerId) throw new Error("会话已切换，请重试。");
  }

  saveSessionDraft(id: string, draft: ComposerDraft): void {
    this.checkComposerId(id);
    if (!this.sessionId && !draft.length) return;
    const sessionId = this.ensureSession(this.getWorkingDirectory());
    this.deps.store.saveDraft(sessionId, draft);
  }

  updateSessionSettings(id: string, input: SessionSettingsInput): void {
    this.checkComposerId(id);
    if (input.model && !hasSavedModel(this.deps.getSettings().providers, input.model)) {
      throw new Error("请从已保存的模型中选择。");
    }
    const changes: SessionSettings = {};
    if (input.model !== undefined) changes.model = input.model ?? undefined;
    if (input.approvalMode !== undefined) changes.approvalMode = input.approvalMode ?? undefined;
    if (!this.sessionId) {
      if (changes.model || changes.approvalMode) {
        this.ensureSession(this.getWorkingDirectory(), changes);
      }
      return;
    }
    this.deps.store.updateSettings(this.sessionId, changes);
    this.sendSessions();
  }

  /** 运行中 = 插话（steer），空闲 = 发起新一轮 */
  prompt(
    input: string | PromptInput,
    composerId?: string,
    expectedDirectory?: string | null,
  ): Promise<void> | ActiveRun {
    if (composerId !== undefined) this.checkComposerId(composerId);
    const active = this.run?.state;
    if (active && (active.sessionId !== this.sessionId || active.status === "stopping")) {
      return active;
    }
    if (expectedDirectory !== undefined) this.checkWorkingDirectory(expectedDirectory);
    const workingDirectory = this.getWorkingDirectory();
    const prepared =
      typeof input === "string"
        ? { text: input, skillInstructions: [] }
        : prepareMentionPrompt(
            input,
            (directory) => directory === workingDirectory,
            this.deps.skillsDir,
          );
    const agent = active && this.agent ? this.agent : this.ensureAgent(workingDirectory);
    const message: ReferencedUserMessage = {
      role: "user",
      content: prepared.text,
      timestamp: Date.now(),
      pilotReference: "reference" in prepared ? prepared.reference : undefined,
    };
    if (prepared.skillInstructions.length) {
      this.promptSkillInstructions.set(message, prepared.skillInstructions);
    }
    if (this.run) {
      this.checkpointRun(this.run, {
        ...this.run.checkpoint,
        pending: [...this.run.checkpoint.pending, message],
      });
      agent.steer(message);
      if (composerId !== undefined) this.deps.store.saveDraft(composerId, []);
      const queued = agent.peekQueuedMessages() ?? [];
      this.steerCount = queued.length;
      this.send({ type: "queue", steerCount: this.steerCount });
      return Promise.resolve();
    }

    return this.beginRun(agent, workingDirectory, message, composerId);
  }

  resume(ref: RunRef): Promise<void> | ActiveRun {
    const active = this.run?.state;
    if (active) return active;
    const checkpoint =
      this.sessionId === ref.sessionId ? this.deps.store.checkpoint(ref.sessionId) : undefined;
    if (checkpoint?.runId !== ref.runId) {
      throw new Error("该任务已更新，请重新打开会话。");
    }
    const directory = checkpoint.workingDirectory ?? undefined;
    const agent = this.ensureAgent(directory);
    const last = agent.state.messages.at(-1);
    const message: ReferencedUserMessage | undefined =
      !last || last.role === "assistant"
        ? {
            role: "user",
            content: "Continue the interrupted task from the saved conversation.",
            timestamp: Date.now(),
          }
        : undefined;
    return this.beginRun(agent, directory, message);
  }

  private beginRun(
    agent: Agent,
    workingDirectory: string | undefined,
    message?: ReferencedUserMessage,
    clearDraftFor?: string,
  ): Promise<void> {
    const sessionId = this.sessionId!;
    const previous = this.deps.store.checkpoint(sessionId);
    const runId = randomUUID();
    const checkpoint: RunCheckpoint = {
      type: "pilot_run_checkpoint",
      runId,
      workingDirectory: workingDirectory ?? null,
      startIndex: previous?.startIndex ?? agent.state.messages.length,
      pending: message ? [message] : [],
      actions: previous?.actions ?? [],
    };
    this.deps.store.save(sessionId, agent.state.messages, checkpoint);
    if (clearDraftFor !== undefined) this.deps.store.saveDraft(clearDraftFor, []);
    if (previous) this.restoreSelectedSkills(agent.state.messages.slice(previous.startIndex));
    const settings = this.deps.getSettings();
    const approvalMode =
      this.getCurrentSession()?.approvalMode ?? settings.approvalMode ?? "standard";
    const globalRules = [...(settings.toolRules ?? [])];
    const sessionRules = this.sessionRules.get(sessionId) ?? [];
    this.sessionRules.set(sessionId, sessionRules);
    const run: RunningTask = {
      state: {
        sessionId,
        runId,
        workingDirectory: checkpoint.workingDirectory,
        status: "streaming",
      },
      preparation: new AbortController(),
      checkpoint,
      initialMessage: message,
      finishedTools: new Map(),
      previousActions: new Set(previous?.actions),
      permissions: new PermissionManager(
        (request) => {
          this.sendStatus("waiting_approval");
          this.send(request);
        },
        () => globalRules,
        (rule) => {
          this.addGlobalRule(rule);
          globalRules.push(rule);
        },
        () => approvalMode,
        sessionRules,
      ),
    };
    this.error = null;
    this.run = run;
    this.runningPrompt = this.runPrompt(agent, message, run);
    return this.runningPrompt;
  }

  private restoreSelectedSkills(messages: AgentMessage[]): void {
    for (const message of messages) {
      if (message.role !== "user") continue;
      const sections = new Set<string>();
      for (const part of (message as ReferencedUserMessage).pilotReference?.parts ?? []) {
        if (part.type !== "mention" || part.kind !== "skill") continue;
        const body = loadSkillBody(this.deps.skillsDir, part.id);
        if (body) sections.add(skillSection(part.label, body));
      }
      if (sections.size) this.promptSkillInstructions.set(message, [...sections]);
    }
  }

  private async runPrompt(
    agent: Agent,
    message: ReferencedUserMessage | undefined,
    run: RunningTask,
  ): Promise<void> {
    const { preparation } = run;
    let started = false;
    try {
      this.deps.broadcast({ type: "run_started", run: run.state });
      this.sendSessions();
      const externalTools = await this.deps.mcp
        .tools(run.state.workingDirectory ?? undefined, preparation.signal)
        .catch((error: unknown) => {
          if (preparation.signal.aborted) return [];
          throw error;
        });
      if (preparation.signal.aborted) {
        const messages = message ? [...agent.state.messages, message] : agent.state.messages;
        agent.state.messages = messages;
        this.settle(run.state.sessionId, messages);
        return;
      }
      // pi snapshots tool declarations as it starts the prompt, before preparing the request.
      agent.state.tools = [...this.localTools, ...externalTools];
      started = true;
      if (message) await agent.prompt(message);
      else await agent.continue();
      if (run.persistError) throw run.persistError;
      agent.state.messages = completeToolResults(agent.state.messages);
      this.settle(run.state.sessionId, agent.state.messages);
    } catch (error) {
      if (started || !preparation.signal.aborted) {
        this.send({
          type: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    } finally {
      run.permissions.abortAll();
      agent.clearAllQueues();
      this.promptSkillInstructions.clear();
      this.steerCount = 0;
      this.run = undefined;
      this.runningPrompt = undefined;
      const { runId, sessionId } = run.state;
      this.deps.broadcast({
        type: "status",
        status: "idle",
        run: { runId, sessionId },
        interruptedRun: this.interruptedRunOf(sessionId),
      });
    }
  }

  abort(ref: RunRef): void {
    const run = this.selectedRun(ref);
    if (run) this.stop(run);
  }

  private stop(run: RunningTask): void {
    run.preparation.abort();
    this.agent?.abort();
    run.permissions.abortAll();
    this.sendStatus("stopping");
  }

  private async stopOwnedRun(id: string): Promise<void> {
    const run = this.run;
    if (run?.state.sessionId !== id) return;
    const completion = this.runningPrompt;
    this.stop(run);
    await completion;
  }

  /** 清空排队中的插话（steer + followUp），状态行撤回入口 */
  clearQueue(ref: RunRef): void {
    const run = this.selectedRun(ref);
    if (!run) return;
    this.checkpointRun(run, {
      ...run.checkpoint,
      pending: run.checkpoint.pending.filter((message) => message === run.initialMessage),
    });
    this.agent?.clearAllQueues();
    this.steerCount = 0;
    this.send({ type: "queue", steerCount: 0 });
  }

  /** 手动重命名；返回刷新后的会话列表 */
  renameSession(id: string, title: string): SessionMeta[] {
    this.deps.store.rename(id, title);
    return this.sendSessions();
  }

  /** 置顶/取消置顶 */
  pinSession(id: string, pinned: boolean): SessionMeta[] {
    this.deps.store.setPinned(id, pinned);
    return this.sendSessions();
  }

  /** 归档/取消归档；归档当前打开的会话时回到草稿态（数据保留在归档区） */
  async archiveSession(id: string, archived: boolean): Promise<Snapshot> {
    if (archived && this.run?.state.sessionId === id) await this.stopOwnedRun(id);
    const directory = this.deps.store.getMeta(id)?.workingDirectory;
    this.deps.store.setArchived(id, archived);
    if (archived && this.sessionId === id) {
      this.switchSession(null, directory);
      return this.publishSnapshot("reset");
    }
    this.sendSessions();
    return this.getSnapshot();
  }

  /** 标记/清除未读 */
  unreadSession(id: string, unread: boolean): SessionMeta[] {
    this.deps.store.setUnread(id, unread);
    return this.sendSessions();
  }

  /** 分叉：复制转录为新会话 */
  forkSession(id: string): SessionMeta[] {
    this.deps.store.fork(id);
    return this.sendSessions();
  }

  /** 会话全文文本（渲染层写入剪贴板） */
  copySession(id: string): string {
    return this.deps.store.transcriptText(id) ?? "";
  }

  /** 会话级人设覆盖（FR-5.9 每会话粒度；变更经 systemPrompt 指纹在下一轮生效） */
  setSessionPersona(id: string, persona: string | null): void {
    this.deps.store.setPersonaOverride(id, persona);
  }

  /** 删除会话；删除当前会话时回到草稿态（不新建会话文件） */
  async deleteSession(id: string): Promise<Snapshot> {
    if (this.run?.state.sessionId === id) await this.stopOwnedRun(id);
    const directory = this.deps.store.getMeta(id)?.workingDirectory;
    this.deps.store.remove(id);
    this.sessionRules.delete(id);
    if (this.agentSessionId === id) this.resetAgent();
    if (this.sessionId === id) {
      this.switchSession(null, directory);
      return this.publishSnapshot("reset");
    }
    this.sendSessions();
    return this.getSnapshot();
  }

  /** 在首次编辑草稿、改会话设置或主动发送时才创建会话记录。 */
  newSession(): Snapshot {
    this.switchSession(null, this.getProjectDirectory());
    return this.publishSnapshot();
  }

  openProject(directory: string): Snapshot {
    const workingDirectory = normalizeWorkingDirectory(directory);
    this.deps.store.rememberProject(workingDirectory);
    this.switchSession(null, workingDirectory);
    return this.publishSnapshot();
  }

  useRecentProject(directory: string, sessionId?: string): Snapshot | Promise<Snapshot> {
    if (!this.deps.store.listRecentProjects().includes(directory)) {
      throw new Error("找不到该最近项目。");
    }
    return sessionId ? this.bindProject(sessionId, directory) : this.openProject(directory);
  }

  async bindProject(id: string, directory: string): Promise<Snapshot> {
    if (this.sessionId !== id) throw new Error("会话已切换，请重新关联项目。");
    const workingDirectory = normalizeWorkingDirectory(directory);
    if (this.run?.state.sessionId === id) await this.stopOwnedRun(id);
    if (this.sessionId !== id) throw new Error("会话已切换，请重新关联项目。");
    this.deps.store.bindProject(id, workingDirectory);
    this.sessionRules.delete(id);
    if (this.agentSessionId === id) this.resetAgent();
    return this.publishSnapshot();
  }

  loadSession(id: string, record = true): Snapshot {
    if (!this.deps.store.getMeta(id)) return this.getSnapshot();
    if (this.sessionId !== id) {
      this.deps.store.setUnread(id, false);
      this.switchSession(id);
    }
    return this.publishSnapshot(record ? "record" : undefined);
  }

  private resetAgent(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.agent = null;
    this.agentSessionId = null;
    this.uiMessages = [];
    this.nextId = 0;
    this.usage = { input: 0, output: 0, cacheRead: 0, costTotal: 0 };
    this.contextTokens = 0;
    this.contextWindow = null;
    this.error = null;
  }

  private switchSession(id: string | null, draftWorkingDirectory?: string): void {
    this.sessionId = id;
    this.composerId = id ?? randomUUID();
    this.draftWorkingDirectory = draftWorkingDirectory;
  }

  private sessionFileChange(
    sessionId: string,
    changeId: string,
  ): {
    messages: AgentMessage[];
    index: number;
    message: ToolResultMessage;
    change: RecordedFileChange;
  } {
    if (this.sessionId !== sessionId) throw new Error("会话已切换，请重新打开文件变更。");
    const messages =
      this.agentSessionId === sessionId &&
      this.agent &&
      (this.run?.state.sessionId === sessionId || !this.deps.store.checkpoint(sessionId))
        ? this.agent.state.messages
        : this.deps.store.read(sessionId).messages;
    for (const [index, message] of messages.entries()) {
      if (message.role !== "toolResult") continue;
      const change = readFileChange(message.toolName, message.details);
      if (change?.summary.id === changeId) return { messages, index, message, change };
    }
    throw new Error("找不到这条文件变更。");
  }

  getFileDiff(sessionId: string, changeId: string): FileDiff {
    const { change } = this.sessionFileChange(sessionId, changeId);
    if (!change.snapshot) throw new Error("此文件没有可用的差异预览。");
    return change.snapshot.diff;
  }

  undoFileChange(sessionId: string, changeId: string): void {
    if (this.run?.state.sessionId === sessionId) {
      throw new Error("请等待当前回复结束后再撤销。");
    }
    const { messages, index, message, change } = this.sessionFileChange(sessionId, changeId);
    if (change.summary.reverted) return;
    restoreFileChange(change, this.getWorkingDirectory());

    const reverted = { ...change.summary, reverted: true };
    const updated = messages.with(index, {
      ...message,
      details: { pilotFileChange: { ...change, summary: reverted } },
    });
    this.deps.store.save(sessionId, updated, this.deps.store.checkpoint(sessionId));
    const event = { type: "file_change" as const, callId: message.toolCallId, change: reverted };
    if (this.agentSessionId === sessionId && this.agent) {
      this.agent.state.messages = updated;
      this.uiMessages = applyMessageEvent(this.uiMessages, event);
    }
    this.deps.broadcast({ ...event, sessionId });
  }

  publishSnapshot(navigation?: "record" | "reset"): Snapshot {
    const snapshot = this.getSnapshot();
    // Selection and run updates share a channel so a live delta cannot overtake its snapshot.
    this.deps.broadcast({ type: "snapshot", snapshot, navigation });
    return snapshot;
  }

  getSnapshot(): Snapshot {
    const sessions = this.deps.store.list();
    const activeRun = this.run?.state ?? null;
    const ownRun = activeRun?.sessionId === this.sessionId ? this.run : undefined;
    const hasLiveMessages = this.sessionId !== null && this.sessionId === this.agentSessionId;
    const interruptedRun =
      !ownRun && this.sessionId ? this.interruptedRunOf(this.sessionId) : undefined;
    return {
      sessionId: this.sessionId,
      composerId: this.composerId,
      composerDraft: this.sessionId ? this.deps.store.loadDraft(this.sessionId) : [],
      draftWorkingDirectory: this.draftWorkingDirectory ?? null,
      sessions,
      recentProjects: this.deps.store.listRecentProjects(sessions),
      messages:
        hasLiveMessages && !interruptedRun
          ? this.uiMessages
          : this.sessionId
            ? toUiMessages(this.deps.store.load(this.sessionId), "s")
            : [],
      status: ownRun?.state.status ?? "idle",
      activeRun,
      interruptedRun: interruptedRun ?? null,
      pendingPermissions: ownRun?.permissions.listPending() ?? [],
      error: hasLiveMessages ? this.error : null,
      settings: toPublicSettings(this.deps.getSettings()),
      usage: hasLiveMessages
        ? { ...this.usage }
        : { input: 0, output: 0, cacheRead: 0, costTotal: 0 },
      contextWindow: hasLiveMessages ? this.contextWindow : null,
      contextTokens: hasLiveMessages ? this.contextTokens : 0,
      steerCount: ownRun ? this.steerCount : 0,
    };
  }
}

/** 从工具结果 / 部分结果提取纯文本 */
function resultText(result: unknown): string | undefined {
  if (!result || typeof result !== "object") return undefined;
  const content = (result as { content?: unknown }).content;
  if (!Array.isArray(content)) return undefined;
  return content
    .map((block) =>
      block && typeof block === "object" && "text" in block
        ? String((block as { text: unknown }).text)
        : "",
    )
    .join("");
}
