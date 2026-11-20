// @env node
// Agent 宿主：Agent 实例生命周期、pi 事件 → UI 事件映射（含工具/用量/队列）、
// 权限门接线、steer 插话路由、会话恢复与落盘。
import {
  Agent,
  type AgentEvent,
  type AgentMessage,
  type AgentTool,
} from "@earendil-works/pi-agent-core";
import type { AssistantMessageEvent, ToolResultMessage } from "@earendil-works/pi-ai";
import type {
  AgentStatus,
  FileDiff,
  PromptInput,
  SessionMeta,
  Snapshot,
  ToolRule,
  UiAgentEvent,
  UiMessage,
} from "@shared/contract";
import { APP_NAME, DEFAULT_THINKING_LEVEL } from "../../shared/constants";
import { applyMessageEvent } from "../../shared/message-events";
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
import { messageParts, messageText, SessionStore, toUiMessages } from "./session-store";
import { loadSkillBody, scanSkills, skillSection } from "./skills";
import { createTools, labelOf } from "./tools";
import { PLAN_TOOL_NAME } from "./tools/constants";
import { readPlanSteps } from "./tools/plan";
import type { ToolEnvironment } from "./tools/types";
import type { PreparedPrompt, ReferencedUserMessage, TimedAssistantMessage } from "./types";

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
  private preparingPrompt?: AbortController;
  private runningPrompt?: Promise<void>;
  private sessionId: string | null = null;
  private draftWorkingDirectory?: string;
  private uiMessages: UiMessage[] = [];
  private status: AgentStatus = "idle";
  private nextId = 0;
  private unsubscribe: (() => void) | null = null;
  private usage: UsageAccumulator = { input: 0, output: 0, cacheRead: 0, costTotal: 0 };
  /** 最近一轮助手消息的上下文占用（input + cacheRead + cacheWrite + output） */
  private contextTokens = 0;
  /** 当前模型的上下文窗口（无 Agent 实例/未知模型 = null） */
  private contextWindow: number | null = null;
  private steerCount = 0;

  readonly permissions: PermissionManager;

  constructor(private readonly deps: HostDeps) {
    this.permissions = new PermissionManager(
      (event) => {
        if (event.type === "permission_request" && this.status !== "waiting_approval") {
          this.sendStatus("waiting_approval");
        }
        deps.broadcast(event);
      },
      () => deps.getSettings().toolRules ?? [],
      (rule) => this.addGlobalRule(rule),
      () => deps.getSettings().approvalMode ?? "standard",
    );
  }

  private addGlobalRule(rule: ToolRule): void {
    const settings = this.deps.getSettings();
    this.deps.saveSettings({ ...settings, toolRules: [...(settings.toolRules ?? []), rule] });
  }

  respondPermission(
    requestId: string,
    decision: Parameters<PermissionManager["respond"]>[1],
  ): void {
    this.permissions.respond(requestId, decision);
    if (this.status === "waiting_approval" && !this.permissions.hasPending()) {
      this.sendStatus("streaming");
    }
  }

  /** 运行时切换思考强度（pi 支持中途修改，下一轮请求生效） */
  setThinkingLevel(level: Settings["thinkingLevel"]): void {
    if (!level) return;
    if (this.agent) this.agent.state.thinkingLevel = level;
  }

  private send(event: UiAgentEvent): void {
    this.uiMessages = applyMessageEvent(this.uiMessages, event);
    this.deps.broadcast(event);
  }

  private sendStatus(status: AgentStatus): void {
    this.status = status;
    this.send({ type: "status", status });
  }

  private getProjectDirectory(): string | undefined {
    return this.sessionId
      ? this.deps.store.getMeta(this.sessionId)?.workingDirectory
      : this.draftWorkingDirectory;
  }

  getWorkingDirectory(): string | undefined {
    if (this.status !== "idle" && this.agentToolEnvironment) {
      return this.agentToolEnvironment.workingDirectory;
    }
    return this.getProjectDirectory() ?? this.deps.getSettings().workingDirectory;
  }

  private ensureSession(workingDirectory: string | undefined): string {
    if (this.sessionId) return this.sessionId;
    const meta = this.deps.store.create(workingDirectory);
    this.sessionId = meta.id;
    this.draftWorkingDirectory = undefined;
    this.send({ type: "sessions", sessions: this.deps.store.list(), activeSessionId: meta.id });
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
  private ensureAgent(): Agent {
    const settings = this.deps.getSettings();
    const active = settings.providers.find((p) => p.id === settings.activeProviderId);
    if (!active) throw new Error("尚未配置 provider，请先到设置页添加");

    const workingDirectory = this.getWorkingDirectory();
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
      this.agentProvider?.id === active.id &&
      this.agentProvider.kind === active.kind &&
      this.agentProvider.modelId === active.modelId &&
      this.agentProvider.baseUrl === active.baseUrl &&
      this.agentProvider.apiKey === active.apiKey &&
      this.agentSystemPrompt === systemPrompt &&
      this.agentToolEnvironment?.workingDirectory === toolEnvironment.workingDirectory &&
      this.agentToolEnvironment?.commandShell === toolEnvironment.commandShell
    ) {
      return this.agent;
    }

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
        const result = await this.permissions.gate(
          toolCall.name,
          args,
          this.deps.mcp.policyOf(toolCall.name),
        );
        if (!result?.block && !signal?.aborted) {
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
      const queued = this.agent?.peekQueuedMessages() ?? [];
      this.steerCount = queued.length;
      this.send({ type: "queue", steerCount: this.steerCount });
      return;
    }

    if (event.type === "agent_end") {
      this.settle();
    }
  }

  /** 一轮运行结束：以 agent 转录为准全量校准 UI，落盘，回 idle */
  private settle(): void {
    this.promptSkillInstructions.clear();
    if (this.agent && this.agentSessionId) {
      this.uiMessages = toUiMessages(this.agent.state.messages, "s", (name) =>
        this.toolLabel(name),
      );
      this.nextId = this.uiMessages.length;
      this.send({ type: "messages", messages: this.uiMessages });

      const last = this.agent.state.messages.at(-1);
      if (last?.role === "assistant" && last.stopReason === "error") {
        this.send({ type: "error", message: last.errorMessage ?? "模型返回错误" });
      }
      this.deps.store.save(this.agentSessionId, this.agent.state.messages);
      // 自动标题可能已变化：推送会话列表刷新侧栏
      this.send({
        type: "sessions",
        sessions: this.deps.store.list(),
        activeSessionId: this.agentSessionId,
      });
    }
    this.steerCount = 0;
    this.send({ type: "queue", steerCount: 0 });
    this.sendStatus("idle");
  }

  private toolLabel(name: string): string {
    return this.deps.mcp.policyOf(name)?.label ?? labelOf(name);
  }

  checkWorkingDirectory(expected: string | null): void {
    if ((this.getWorkingDirectory() ?? null) !== expected) {
      throw new Error("工作目录已变更，请重新选择文件引用。");
    }
  }

  preparePrompt(input: string | PromptInput): string | PreparedPrompt {
    if (typeof input === "string") return input;
    const workingDirectory = this.getWorkingDirectory();
    return prepareMentionPrompt(
      input,
      (directory) => directory === workingDirectory,
      this.deps.skillsDir,
    );
  }

  /** 运行中 = 插话（steer），空闲 = 发起新一轮 */
  async prompt(input: string | PreparedPrompt): Promise<void> {
    const busy = this.status !== "idle";
    if (!busy) this.promptSkillInstructions.clear();
    const text = typeof input === "string" ? input : input.text;
    const message: ReferencedUserMessage = { role: "user", content: text, timestamp: Date.now() };
    if (typeof input !== "string" && input.reference) message.pilotReference = input.reference;
    if (typeof input !== "string" && input.skillInstructions.length > 0) {
      this.promptSkillInstructions.set(message, input.skillInstructions);
    }
    if (busy) {
      if (!this.agent) return;
      this.agent.steer(message);
      const queued = this.agent.peekQueuedMessages() ?? [];
      this.steerCount = queued.length;
      this.send({ type: "queue", steerCount: this.steerCount });
      return;
    }

    const running = this.runPrompt(message);
    this.runningPrompt = running;
    try {
      await running;
    } finally {
      if (this.runningPrompt === running) this.runningPrompt = undefined;
    }
  }

  private async runPrompt(message: ReferencedUserMessage): Promise<void> {
    const preparation = new AbortController();
    let agent: Agent | undefined;
    try {
      agent = this.ensureAgent();
      this.preparingPrompt = preparation;
      this.sendStatus("streaming");
      const externalTools = await this.deps.mcp.tools(
        this.getWorkingDirectory(),
        preparation.signal,
      );
      if (this.agent !== agent) return;
      preparation.signal.throwIfAborted();
      // pi snapshots tool declarations as it starts the prompt, before preparing the request.
      agent.state.tools = [...this.localTools, ...externalTools];
      this.preparingPrompt = undefined;
      await agent.prompt(message);
    } catch (error) {
      if (agent && this.agent !== agent) return;
      if (preparation.signal.aborted) {
        this.clearQueue();
        this.sendStatus("idle");
        return;
      }
      this.sendStatus("idle");
      this.send({
        type: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    } finally {
      if (this.preparingPrompt === preparation) this.preparingPrompt = undefined;
    }
  }

  abort(): void {
    this.permissions.abortAll();
    this.preparingPrompt?.abort();
    this.agent?.abort();
  }

  private async stopBeforeSwitch(): Promise<void> {
    if (!this.runningPrompt) return;
    // The current run needs its session and event subscription until it has saved the transcript.
    this.abort();
    await this.runningPrompt;
  }

  /** 清空排队中的插话（steer + followUp），状态行撤回入口 */
  clearQueue(): void {
    this.agent?.clearAllQueues();
    this.steerCount = 0;
    this.send({ type: "queue", steerCount: 0 });
  }

  /** 手动重命名；返回刷新后的会话列表 */
  renameSession(id: string, title: string): SessionMeta[] {
    this.deps.store.rename(id, title);
    const sessions = this.deps.store.list();
    this.send({ type: "sessions", sessions });
    return sessions;
  }

  /** 置顶/取消置顶 */
  pinSession(id: string, pinned: boolean): SessionMeta[] {
    this.deps.store.setPinned(id, pinned);
    const sessions = this.deps.store.list();
    this.send({ type: "sessions", sessions });
    return sessions;
  }

  /** 归档/取消归档；归档当前打开的会话时回到草稿态（数据保留在归档区） */
  async archiveSession(id: string, archived: boolean): Promise<Snapshot> {
    if (archived && this.sessionId === id) await this.stopBeforeSwitch();
    const directory = this.deps.store.getMeta(id)?.workingDirectory;
    this.deps.store.setArchived(id, archived);
    if (archived && this.sessionId === id) this.switchSession(null, [], directory);
    const sessions = this.deps.store.list();
    this.send({ type: "sessions", sessions });
    return this.getSnapshot();
  }

  /** 标记/清除未读 */
  unreadSession(id: string, unread: boolean): SessionMeta[] {
    this.deps.store.setUnread(id, unread);
    const sessions = this.deps.store.list();
    this.send({ type: "sessions", sessions });
    return sessions;
  }

  /** 分叉：复制转录为新会话 */
  forkSession(id: string): SessionMeta[] {
    this.deps.store.fork(id);
    const sessions = this.deps.store.list();
    this.send({ type: "sessions", sessions });
    return sessions;
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
    if (this.sessionId === id) await this.stopBeforeSwitch();
    const directory = this.deps.store.getMeta(id)?.workingDirectory;
    this.deps.store.remove(id);
    if (this.sessionId === id) this.switchSession(null, [], directory);
    const sessions = this.deps.store.list();
    this.send({ type: "sessions", sessions });
    return this.getSnapshot();
  }

  /** 新聊天：仅回到草稿态，不创建会话——首个 prompt 时才由 ensureSession 落盘建会话 */
  async newSession(): Promise<Snapshot> {
    await this.stopBeforeSwitch();
    this.switchSession(null, [], this.getProjectDirectory());
    return this.getSnapshot();
  }

  async openProject(directory: string): Promise<Snapshot> {
    const workingDirectory = normalizeWorkingDirectory(directory);
    await this.stopBeforeSwitch();
    this.switchSession(null, [], workingDirectory);
    return this.getSnapshot();
  }

  async bindProject(id: string, directory: string): Promise<Snapshot> {
    if (this.sessionId !== id) throw new Error("会话已切换，请重新关联项目。");
    const workingDirectory = normalizeWorkingDirectory(directory);
    await this.stopBeforeSwitch();
    if (this.sessionId !== id) throw new Error("会话已切换，请重新关联项目。");
    this.deps.store.bindProject(id, workingDirectory);
    this.resetAgent();
    return this.getSnapshot();
  }

  async loadSession(id: string): Promise<Snapshot> {
    if (this.sessionId === id || !this.deps.store.getMeta(id)) return this.getSnapshot();
    await this.stopBeforeSwitch();
    if (!this.deps.store.getMeta(id)) return this.getSnapshot();
    this.deps.store.setUnread(id, false);
    this.switchSession(id, toUiMessages(this.deps.store.load(id), "s"));
    return this.getSnapshot();
  }

  private resetAgent(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.agent = null;
    this.agentSessionId = null;
    this.permissions.resetSession();
  }

  private switchSession(
    id: string | null,
    messages: UiMessage[],
    draftWorkingDirectory?: string,
  ): void {
    this.resetAgent();
    this.sessionId = id;
    this.draftWorkingDirectory = draftWorkingDirectory;
    this.uiMessages = messages;
    this.nextId = messages.length;
    this.usage = { input: 0, output: 0, cacheRead: 0, costTotal: 0 };
    this.contextTokens = 0;
    this.contextWindow = null;
    this.steerCount = 0;
    this.status = "idle";
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
      this.agentSessionId === sessionId && this.agent
        ? this.agent.state.messages
        : this.deps.store.load(sessionId);
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
    if (this.status !== "idle") throw new Error("请等待当前回复结束后再撤销。");
    const { messages, index, message, change } = this.sessionFileChange(sessionId, changeId);
    if (change.summary.reverted) return;
    restoreFileChange(change, this.getWorkingDirectory());

    const reverted = { ...change.summary, reverted: true };
    const updated = messages.with(index, {
      ...message,
      details: { pilotFileChange: { ...change, summary: reverted } },
    });
    this.deps.store.save(sessionId, updated);
    if (this.agentSessionId === sessionId && this.agent) this.agent.state.messages = updated;
    this.send({ type: "file_change", callId: message.toolCallId, change: reverted });
  }

  getSnapshot(): Snapshot {
    return {
      sessionId: this.sessionId,
      draftWorkingDirectory: this.draftWorkingDirectory ?? null,
      sessions: this.deps.store.list(),
      messages: this.uiMessages,
      status: this.status,
      settings: toPublicSettings(this.deps.getSettings()),
      usage: { ...this.usage },
      contextWindow: this.contextWindow,
      contextTokens: this.contextTokens,
      steerCount: this.steerCount,
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
