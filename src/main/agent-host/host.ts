// @env node
// Agent 宿主：Agent 实例生命周期、pi 事件 → UI 事件映射（含工具/用量/队列）、
// 权限门接线、steer 插话路由、会话恢复与落盘。
import {
  Agent,
  type AgentEvent,
  type AgentMessage,
  type AgentTool,
} from "@earendil-works/pi-agent-core";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import type {
  AgentStatus,
  SessionMeta,
  Snapshot,
  ToolRule,
  UiAgentEvent,
  UiMessage,
} from "@shared/contract";
import { APP_NAME } from "../../shared/constants";
import { applyPlanUpdate } from "../../shared/plan";
import { toPublicSettings } from "../settings";
import { decryptSecret } from "../settings/secrets";
import type { ProviderConfig, Settings } from "../settings/types";
import { getCommandShell } from "../workspace/shell";
import type { McpManager } from "./mcp";
import { resolveModel } from "./models";
import { PermissionManager } from "./permissions";
import { messageText, SessionStore, toUiMessages } from "./session-store";
import { loadSkillBody, scanSkills } from "./skills";
import { createTools, labelOf } from "./tools";
import { PLAN_TOOL_NAME } from "./tools/constants";
import { readPlanSteps } from "./tools/plan";
import type { ToolEnvironment } from "./tools/types";

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
  private preparingPrompt?: AbortController;
  private sessionId: string | null = null;
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
        // 权限请求进入等待审批态，应答后由 respondPermission 拉回 streaming
        if (event.type === "permission_request") this.sendStatus("waiting_approval");
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
    if (this.status === "waiting_approval") this.sendStatus("streaming");
  }

  /** 运行时切换思考强度（pi 支持中途修改，下一轮请求生效） */
  setThinkingLevel(level: Settings["thinkingLevel"]): void {
    if (!level) return;
    if (this.agent) this.agent.state.thinkingLevel = level;
  }

  private send(event: UiAgentEvent): void {
    this.deps.broadcast(event);
  }

  private sendStatus(status: AgentStatus): void {
    this.status = status;
    this.send({ type: "status", status });
  }

  private ensureSession(): string {
    if (this.sessionId) return this.sessionId;
    const meta = this.deps.store.create();
    this.sessionId = meta.id;
    return meta.id;
  }

  /**
   * 组装 systemPrompt（FR-1.7 / FR-5.9，注入顺序固定）：
   * 应用提示词 → 人设/自定义指令（会话 personaOverride 优先于全局 persona）→ 启用技能 sections。
   */
  private buildSystemPrompt(sessionId: string, settings: Settings): string {
    const sections = [`You are a helpful assistant running inside ${APP_NAME}.`];

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
        sections.push(`## 技能：${skill.name}\n\n${body}`);
      }
    }
    return sections.join("\n\n");
  }

  /** 确保当前会话有 Agent 实例；跨会话或 provider/模型/systemPrompt 变更时重建（转录从落盘恢复） */
  private ensureAgent(): Agent {
    const sessionId = this.ensureSession();
    const settings = this.deps.getSettings();
    const active = settings.providers.find((p) => p.id === settings.activeProviderId);
    if (!active) throw new Error("尚未配置 provider，请先到设置页添加");

    const systemPrompt = this.buildSystemPrompt(sessionId, settings);
    const toolEnvironment: ToolEnvironment = {
      workingDirectory: settings.workingDirectory,
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
    this.contextWindow = typeof model.contextWindow === "number" ? model.contextWindow : null;

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
        thinkingLevel: settings.thinkingLevel ?? "medium",
      },
      streamFn,
      beforeToolCall: async ({ toolCall, args }) =>
        this.permissions.gate(toolCall.name, args, this.deps.mcp.policyOf(toolCall.name)),
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

  private onAgentEvent(event: AgentEvent): void {
    if (event.type === "message_start") {
      const message = event.message;
      if (message.role === "user") {
        const ui: UiMessage = {
          id: `s-${this.nextId++}`,
          role: "user",
          parts: [{ type: "text", text: messageText(message) }],
        };
        this.uiMessages.push(ui);
        this.send({ type: "user_message", message: ui });
        return;
      }
      if (message.role === "assistant") {
        const ui: UiMessage = { id: `s-${this.nextId++}`, role: "assistant", parts: [] };
        this.uiMessages.push(ui);
        this.send({ type: "assistant_start", id: ui.id });
      }
      return;
    }

    if (event.type === "message_update") {
      const inner = event.assistantMessageEvent;
      if (inner.type === "text_delta") {
        const last = this.uiMessages.at(-1);
        if (last?.role === "assistant") {
          const textPart = last.parts.at(-1);
          if (textPart?.type === "text") {
            textPart.text += inner.delta;
          } else {
            last.parts.push({ type: "text", text: inner.delta });
          }
          this.send({ type: "assistant_delta", id: last.id, delta: inner.delta });
        }
      }
      if (inner.type === "thinking_start") {
        const last = this.uiMessages.at(-1);
        if (last?.role === "assistant") {
          last.parts.push({ type: "thinking", text: "" });
          this.send({ type: "thinking_start", id: last.id });
        }
      }
      if (inner.type === "thinking_delta") {
        const last = this.uiMessages.at(-1);
        if (last?.role === "assistant") {
          const thinkingPart = last.parts.findLast((p) => p.type === "thinking");
          if (thinkingPart?.type === "thinking") thinkingPart.text += inner.delta;
          this.send({ type: "thinking_delta", id: last.id, delta: inner.delta });
        }
      }
      return;
    }

    if (event.type === "message_end" && event.message.role === "assistant") {
      const assistant = event.message as AssistantMessage;
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
        });
      }
      const last = this.uiMessages.at(-1);
      if (last?.role === "assistant") this.send({ type: "assistant_end", id: last.id });
      return;
    }

    if (event.type === "tool_execution_start") {
      if (event.toolName === PLAN_TOOL_NAME) return;
      const last = this.uiMessages.at(-1);
      if (last?.role === "assistant") {
        const inputSummary = JSON.stringify(event.args) ?? "{}";
        const label = this.toolLabel(event.toolName);
        last.parts.push({
          type: "tool",
          callId: event.toolCallId,
          toolName: event.toolName,
          label,
          state: "running",
          inputSummary,
        });
        this.send({
          type: "tool_start",
          callId: event.toolCallId,
          toolName: event.toolName,
          label,
          inputSummary,
        });
      }
      return;
    }

    if (event.type === "tool_execution_update") {
      if (event.toolName === PLAN_TOOL_NAME) return;
      const output = resultText(event.partialResult);
      if (output !== undefined) {
        this.send({ type: "tool_update", callId: event.toolCallId, output });
      }
      return;
    }

    if (event.type === "tool_execution_end") {
      if (event.toolName === PLAN_TOOL_NAME) {
        const steps = event.isError ? undefined : readPlanSteps(event.result.details);
        if (steps) {
          this.uiMessages = applyPlanUpdate(this.uiMessages, steps);
          this.send({ type: "plan", steps });
        }
        return;
      }
      const output = resultText(event.result);
      const isError = event.isError;
      const part = findToolPart(this.uiMessages, event.toolCallId);
      if (part) {
        part.state = isError ? "error" : "success";
        if (output !== undefined) part.output = output;
        if (isError && output !== undefined) part.error = output;
      }
      this.send({
        type: "tool_end",
        callId: event.toolCallId,
        state: isError ? "error" : "success",
        output,
        error: isError ? (output ?? "工具执行失败") : undefined,
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

  acceptsReferenceDirectory(directory: string): boolean {
    return (
      this.deps.getSettings().workingDirectory === directory &&
      (this.status === "idle" || this.agentToolEnvironment?.workingDirectory === directory)
    );
  }

  /** 运行中 = 插话（steer），空闲 = 发起新一轮 */
  async prompt(text: string): Promise<void> {
    if (this.status === "streaming" || this.status === "waiting_approval") {
      if (!this.agent) return;
      const message: AgentMessage = { role: "user", content: text, timestamp: Date.now() };
      this.agent.steer(message);
      const queued = this.agent.peekQueuedMessages() ?? [];
      this.steerCount = queued.length;
      this.send({ type: "queue", steerCount: this.steerCount });
      return;
    }
    const preparation = new AbortController();
    let agent: Agent | undefined;
    try {
      agent = this.ensureAgent();
      this.preparingPrompt = preparation;
      this.sendStatus("streaming");
      const externalTools = await this.deps.mcp.tools(preparation.signal);
      if (this.agent !== agent) return;
      preparation.signal.throwIfAborted();
      // pi snapshots tool declarations as it starts the prompt, before preparing the request.
      agent.state.tools = [...this.localTools, ...externalTools];
      this.preparingPrompt = undefined;
      await agent.prompt(text);
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
    this.deps.store.setArchived(id, archived);
    if (archived && this.sessionId === id) {
      this.sessionId = null;
      this.agent = null;
      this.agentSessionId = null;
      this.uiMessages = [];
      this.permissions.resetSession();
      this.usage = { input: 0, output: 0, cacheRead: 0, costTotal: 0 };
      this.contextTokens = 0;
      this.contextWindow = null;
      this.steerCount = 0;
      this.send({ type: "messages", messages: this.uiMessages });
      this.send({ type: "queue", steerCount: 0 });
      this.sendStatus("idle");
    }
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
    this.deps.store.remove(id);
    if (this.sessionId === id) {
      this.sessionId = null;
      this.agent = null;
      this.agentSessionId = null;
      this.uiMessages = [];
      this.permissions.resetSession();
      this.usage = { input: 0, output: 0, cacheRead: 0, costTotal: 0 };
      this.contextTokens = 0;
      this.contextWindow = null;
      this.steerCount = 0;
      this.send({ type: "messages", messages: this.uiMessages });
      this.send({ type: "queue", steerCount: 0 });
      this.sendStatus("idle");
    }
    const sessions = this.deps.store.list();
    this.send({ type: "sessions", sessions });
    return this.getSnapshot();
  }

  /** 新聊天：仅回到草稿态，不创建会话——首个 prompt 时才由 ensureSession 落盘建会话 */
  async newSession(): Promise<Snapshot> {
    this.sessionId = null;
    this.agent = null;
    this.agentSessionId = null;
    this.uiMessages = [];
    this.permissions.resetSession();
    this.usage = { input: 0, output: 0, cacheRead: 0, costTotal: 0 };
    this.contextTokens = 0;
    this.contextWindow = null;
    this.steerCount = 0;
    this.send({ type: "queue", steerCount: 0 });
    this.sendStatus("idle");
    return this.getSnapshot();
  }

  async loadSession(id: string): Promise<Snapshot> {
    this.sessionId = id;
    this.agent = null;
    this.agentSessionId = null;
    // 打开即清除未读（snapshot.sessions 会带上刷新后的列表）
    this.deps.store.setUnread(id, false);
    this.uiMessages = toUiMessages(this.deps.store.load(id), "s");
    this.nextId = this.uiMessages.length;
    this.permissions.resetSession();
    this.usage = { input: 0, output: 0, cacheRead: 0, costTotal: 0 };
    this.contextTokens = 0;
    // Agent 实例尚未重建：窗口大小要等下一轮 usage 才可测得
    this.contextWindow = null;
    this.steerCount = 0;
    this.sendStatus("idle");
    this.send({ type: "messages", messages: this.uiMessages });
    return this.getSnapshot();
  }

  getSnapshot(): Snapshot {
    return {
      sessionId: this.sessionId,
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

function findToolPart(
  messages: UiMessage[],
  callId: string,
): Extract<UiMessage["parts"][number], { type: "tool" }> | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    for (const part of messages[i].parts) {
      if (part.type === "tool" && part.callId === callId) return part;
    }
  }
  return undefined;
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
