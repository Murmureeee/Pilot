// @env node
import { randomUUID } from "node:crypto";

import type {
  AgentEvent,
  AgentMessage,
  AgentTool,
  BeforeToolCallContext,
  BeforeToolCallResult,
} from "@earendil-works/pi-agent-core";
import type { AssistantMessageEvent, ToolResultMessage } from "@earendil-works/pi-ai";

import type {
  ActiveRun,
  AgentRunEvent,
  GitChangesView,
  ModelFailure,
  ModelRetryProgress,
  PermissionDecision,
  PermissionRequest,
  ToolRule,
  VerificationTask,
} from "@shared/contract";

import { visibleMessageText } from "../../shared/mentions";
import { applyMessageEvent } from "../../shared/message-events";
import { sameToolRule } from "../settings/tool-rules";
import { readFileChange } from "../workspace/file-changes";
import { relativeGitPath } from "../workspace/git";
import { captureGitSnapshot, compareGitSnapshots } from "../workspace/git-changes";
import { createGitTaskCheckpoint, describeGitCheckpoint } from "../workspace/git-checkpoint";
import { captureGitCheckpointBase } from "../workspace/git-review-files";
import type {
  GitCheckpointBase,
  GitCommandObservation,
  GitSnapshot,
  RecordedFileChange,
} from "../workspace/types";
import { withModelRetry } from "./model-retry";
import { PermissionManager } from "./permissions";
import { actionFingerprint, completeToolResults, failedRunOf, interruptedRunOf } from "./recovery";
import { messageParts, messageText, toUiMessages } from "./session-store";
import { loadSkillBody, skillSection } from "./skills";
import { labelOf } from "./tools";
import { PLAN_TOOL_NAME } from "./tools/constants";
import { readPlanSteps } from "./tools/plan";
import type {
  AgentRunOptions,
  ReferencedUserMessage,
  RunCheckpoint,
  SavedGitChanges,
  TimedAssistantMessage,
} from "./types";

export class AgentRun {
  private currentState: ActiveRun;
  private checkpoint: RunCheckpoint;
  private readonly preparation = new AbortController();
  private readonly completion = Promise.withResolvers<void>();
  private readonly permissions: PermissionManager;
  private readonly previousActions: ReadonlySet<string>;
  private readonly finishedTools = new Map<string, ToolResultMessage>();
  private readonly commandObservations: GitCommandObservation[] = [];
  private readonly promptSkillInstructions = new Map<AgentMessage, readonly string[]>();
  private readonly thinkingStarts = new Map<number, number>();
  private thinkingDurations: Record<number, number> = {};
  private gitFilesBefore?: GitCheckpointBase;
  private finishedGitChanges?: Promise<GitChangesView | null>;
  private persistError?: unknown;
  private modelFailure?: ModelFailure;
  private interruptedForExit = false;
  private queuedMessages = 0;
  readonly resumed: boolean;
  readonly gitBaseline: Promise<GitSnapshot>;

  constructor(private readonly deps: AgentRunOptions) {
    const {
      agent,
      sessionId,
      environment,
      store,
      initialMessage,
      skillInstructions,
      clearDraftFor,
    } = deps;
    const previous = store.checkpoint(sessionId);
    const { workingDirectory } = environment;
    const runId = randomUUID();
    const task: VerificationTask = {
      taskId: previous?.task?.taskId ?? previous?.runId ?? runId,
      agentRunId: runId,
      title:
        previous?.task?.title ??
        (initialMessage
          ? visibleMessageText(messageParts(initialMessage)).trim().slice(0, 100)
          : undefined),
    };

    this.currentState = {
      sessionId,
      runId,
      workingDirectory: workingDirectory ?? null,
      status: "streaming",
    };
    this.checkpoint = {
      type: "pilot_run_checkpoint",
      runId,
      workingDirectory: this.state.workingDirectory,
      startIndex: previous?.startIndex ?? agent.state.messages.length,
      pending: initialMessage ? [initialMessage] : [],
      actions: previous?.actions ?? [],
      gitBaseline: previous?.gitBaseline,
      task,
    };
    store.save(sessionId, agent.state.messages, this.checkpoint);
    if (clearDraftFor !== undefined) store.saveDraft(clearDraftFor, []);
    if (initialMessage && skillInstructions?.length)
      this.promptSkillInstructions.set(initialMessage, skillInstructions);
    if (previous) this.restoreSelectedSkills(agent.state.messages.slice(previous.startIndex));

    const approvalMode =
      store.getMeta(sessionId)?.approvalMode ?? deps.getSettings().approvalMode ?? "standard";
    this.permissions = new PermissionManager(
      (request) => {
        this.sendStatus("waiting_approval");
        this.send(request);
      },
      () => deps.getSettings().toolRules ?? [],
      (rule) => this.addGlobalRule(rule),
      () => approvalMode,
      deps.sessionRules,
    );
    this.previousActions = new Set(previous?.actions);
    this.resumed = previous !== undefined;
    this.gitBaseline = previous
      ? Promise.resolve(
          previous.gitBaseline === undefined ? { unavailable: true } : previous.gitBaseline,
        )
      : captureGitSnapshot(workingDirectory);
    deps.view.error = null;
  }

  get state(): ActiveRun {
    return this.currentState;
  }

  get gitChangesAtEnd(): Promise<GitChangesView | null> | undefined {
    return this.finishedGitChanges;
  }

  get steerCount(): number {
    return this.queuedMessages;
  }

  get pendingPermissions(): PermissionRequest[] {
    return this.permissions.listPending();
  }

  start(): Promise<void> {
    void this.execute().then(this.completion.resolve, this.completion.reject);
    return this.completion.promise;
  }

  stop(): void {
    this.preparation.abort();
    this.deps.agent.abort();
    this.permissions.abortAll();
    this.sendStatus("stopping");
  }

  async stopAndWait(): Promise<void> {
    this.stop();
    await this.completion.promise;
  }

  async stopForExit(): Promise<void> {
    this.interruptedForExit = true;
    await this.stopAndWait();
    if (this.persistError) throw new Error("无法保存任务进度。", { cause: this.persistError });
  }

  respondPermission(requestId: string, decision: PermissionDecision): void {
    if (!this.permissions.respond(requestId, decision)) return;
    this.send({ type: "permission_resolved", requestId });
    if (!this.permissions.hasPending()) this.sendStatus("streaming");
  }

  enqueue(
    message: ReferencedUserMessage,
    skillInstructions: readonly string[],
    clearDraftFor?: string,
  ): void {
    if (skillInstructions.length) this.promptSkillInstructions.set(message, skillInstructions);
    this.saveCheckpoint({ ...this.checkpoint, pending: [...this.checkpoint.pending, message] });
    this.deps.agent.steer(message);
    if (clearDraftFor !== undefined) this.deps.store.saveDraft(clearDraftFor, []);
    this.sendQueue();
  }

  clearQueue(): void {
    this.saveCheckpoint({
      ...this.checkpoint,
      pending: this.checkpoint.pending.filter((message) => message === this.deps.initialMessage),
    });
    this.deps.agent.clearAllQueues();
    this.sendQueue();
  }

  private sendQueue(): void {
    this.queuedMessages = this.deps.agent.peekQueuedMessages().length;
    this.send({ type: "queue", steerCount: this.queuedMessages });
  }

  private send(event: AgentRunEvent): void {
    const { view, broadcast } = this.deps;
    view.messages = applyMessageEvent(view.messages, event);
    if (event.type === "error") view.error = event.message;
    const { runId, sessionId } = this.state;
    broadcast({ ...event, run: { runId, sessionId } });
  }

  private sendStatus(status: ActiveRun["status"]): void {
    if (this.state.status === status) return;
    this.currentState = { ...this.state, status };
    this.send({ type: "status", status });
  }

  private reportModelRetry(retry: ModelRetryProgress | null): void {
    this.currentState = { ...this.state, retry: retry ?? undefined };
    const last = this.deps.view.messages.at(-1);
    const waiting = retry !== null && retry.retryAt !== null;
    const resetReplyId =
      waiting && last?.role === "assistant" && last.streaming ? last.id : undefined;
    if (resetReplyId) {
      this.thinkingStarts.clear();
      this.thinkingDurations = {};
    }
    this.send({ type: "model_retry", retry, resetReplyId });
  }

  private async beforeToolCall(
    { toolCall, args }: BeforeToolCallContext,
    signal?: AbortSignal,
  ): Promise<BeforeToolCallResult | undefined> {
    signal?.throwIfAborted();
    const { environment, mcp } = this.deps;
    const action = actionFingerprint(toolCall.name, args, environment.workingDirectory);
    if (action && this.previousActions.has(action)) {
      return {
        block: true,
        reason:
          "This operation was already started before the interruption. Use its saved result or verify its effects in the workspace.",
      };
    }
    if (this.persistError) throw this.persistError;
    const result = await this.permissions.gate(
      toolCall.name,
      args,
      mcp.policyOf(toolCall.name),
      environment,
    );
    if (!result?.block && !signal?.aborted) {
      if (action && !this.checkpoint.actions.includes(action)) {
        this.saveCheckpoint({ ...this.checkpoint, actions: [...this.checkpoint.actions, action] });
      }
      this.reportTool("tool_start", toolCall.id, toolCall.name, toolCall.arguments);
    }
    return result;
  }

  private async execute(): Promise<void> {
    const { agent, initialMessage, store, tools } = this.deps;
    const { runId, sessionId } = this.state;
    const { signal } = this.preparation;
    const unsubscribe = agent.subscribe((event) => this.onAgentEvent(event));
    agent.beforeToolCall = (context, toolSignal) => this.beforeToolCall(context, toolSignal);
    agent.transformContext = async (messages) =>
      this.prepareRequestMessages(messages, this.deps.systemPrompt);
    const streamFunction = agent.streamFunction;
    agent.streamFunction = withModelRetry(streamFunction, {
      onRetry: (progress) => this.reportModelRetry(progress),
      onFailure: (failure) => {
        this.modelFailure = failure;
      },
    });
    let started = false;
    try {
      this.deps.onStarted();
      this.deps.broadcast({ type: "run_started", run: this.state });
      this.deps.onSessionUpdated();
      const gitBaseline = await this.gitBaseline;
      const directory = this.deps.environment.workingDirectory;
      if (!this.resumed && !signal.aborted && directory && gitBaseline && "root" in gitBaseline)
        this.gitFilesBefore = await captureGitCheckpointBase(directory, gitBaseline);
      if (this.checkpoint.gitBaseline === undefined)
        this.saveCheckpoint({ ...this.checkpoint, gitBaseline });
      const externalTools = signal.aborted
        ? []
        : await this.deps.mcp.tools(directory, signal).catch((error: unknown) => {
            if (signal.aborted) return [];
            throw error;
          });
      if (signal.aborted) {
        if (this.interruptedForExit) return;
        const messages = initialMessage
          ? [...agent.state.messages, initialMessage]
          : agent.state.messages;
        agent.state.messages = messages;
        await this.settle(messages);
        return;
      }
      // pi takes a snapshot of these tool declarations when starting the prompt.
      const localTools = tools.map((tool) =>
        tool.name === "bash" ? this.observeGitCommand(tool) : tool,
      );
      agent.state.tools = [...localTools, ...externalTools];
      started = true;
      if (initialMessage) await agent.prompt(initialMessage);
      else await agent.continue();
      if (this.interruptedForExit) return;
      if (this.persistError) throw this.persistError;
      const messages = agent.state.messages;
      const last = messages.at(-1);
      const failure =
        last?.role === "assistant" && last.stopReason === "error" ? this.modelFailure : undefined;
      // Continue from the last user message or tool result when the user retries.
      agent.state.messages = completeToolResults(failure ? messages.slice(0, -1) : messages);
      await this.settle(agent.state.messages, failure);
    } catch (error) {
      if (started || !signal.aborted) {
        this.send({
          type: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      }
    } finally {
      if (this.interruptedForExit) {
        try {
          this.saveCheckpoint();
          this.persistError = undefined;
        } catch {
          this.send({ type: "error", message: "无法保存任务进度。" });
        }
      }
      this.permissions.abortAll();
      agent.clearAllQueues();
      unsubscribe();
      agent.beforeToolCall = undefined;
      agent.transformContext = undefined;
      agent.streamFunction = streamFunction;
      agent.state.tools = tools;
      this.promptSkillInstructions.clear();
      this.queuedMessages = 0;
      this.deps.onFinished();
      const checkpoint = store.checkpoint(sessionId);
      this.deps.broadcast({
        type: "status",
        status: "idle",
        run: { runId, sessionId },
        interruptedRun: interruptedRunOf(sessionId, checkpoint),
        failedRun: failedRunOf(sessionId, checkpoint),
      });
    }
  }

  private addGlobalRule(rule: ToolRule): void {
    const settings = this.deps.getSettings();
    const rules = settings.toolRules ?? [];
    if (!rules.some((candidate) => sameToolRule(candidate, rule)))
      this.deps.saveSettings({ ...settings, toolRules: [...rules, rule] });
  }

  private prepareRequestMessages(messages: AgentMessage[], systemPrompt: string): AgentMessage[] {
    // Apply explicit skills to the model request without putting their bodies in the transcript.
    return messages.map((message, index) => {
      if (index === 0 && message.role === "system") {
        return { ...message, content: systemPrompt };
      }
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

  private reportTool(
    type: "tool_call" | "tool_start",
    callId: string,
    toolName: string,
    args: unknown,
  ): void {
    const message = this.deps.view.messages.at(-1);
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
    const last = this.deps.view.messages.at(-1);
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
    if (event.type === "message_end" && event.message.role === "user") {
      const pending = this.checkpoint.pending.filter((message) => message !== event.message);
      this.saveCheckpoint({ ...this.checkpoint, pending });
      return;
    }

    if (event.type === "message_start") {
      const message = event.message;
      if (message.role === "user") {
        this.send({
          type: "user_message",
          message: {
            id: "s-" + this.deps.view.nextId++,
            role: "user",
            parts: messageParts(message),
          },
        });
      } else if (message.role === "assistant") {
        this.thinkingStarts.clear();
        this.thinkingDurations = {};
        this.send({ type: "assistant_start", id: "s-" + this.deps.view.nextId++ });
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
        this.deps.view.usage.input += assistant.usage.input;
        this.deps.view.usage.output += assistant.usage.output;
        this.deps.view.usage.cacheRead += assistant.usage.cacheRead;
        this.deps.view.usage.costTotal += assistant.usage.cost?.total ?? 0;
        // 上下文占用 = 最近一轮（不是累计）：请求携带的 input/cache + 本轮输出
        const u = assistant.usage;
        this.deps.view.contextTokens = u.input + u.output + u.cacheRead + (u.cacheWrite ?? 0);
        this.send({
          type: "usage",
          tokens: {
            input: this.deps.view.usage.input,
            output: this.deps.view.usage.output,
            cacheRead: this.deps.view.usage.cacheRead,
          },
          costTotal: this.deps.view.usage.costTotal,
          contextTokens: this.deps.view.contextTokens,
          contextWindow: this.deps.view.contextWindow,
        });
      }
      const last = this.deps.view.messages.at(-1);
      if (last?.role === "assistant") {
        for (const blockIndex of this.thinkingStarts.keys()) {
          const block = assistant.content[blockIndex];
          if (block?.type === "thinking") this.finishThinking(last.id, blockIndex, block.thinking);
        }
        if (Object.keys(this.thinkingDurations).length > 0)
          assistant.pilotThinkingDurations = this.thinkingDurations;
        // Save the tool calls before pi asks for approval or starts any of them.
        this.saveCheckpoint();
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
      this.finishedTools.set(event.toolCallId, {
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
      this.saveCheckpoint();
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
      this.finishedTools.delete(event.message.toolCallId);
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
      this.saveCheckpoint();
      this.sendQueue();
      return;
    }
  }

  private saveCheckpoint(checkpoint = this.checkpoint): void {
    try {
      this.deps.store.writeTranscript(
        this.state.sessionId,
        [...this.deps.agent.state.messages, ...this.finishedTools.values()],
        checkpoint,
      );
      this.checkpoint = checkpoint;
    } catch (error) {
      this.persistError = error;
      this.deps.agent.abort();
      throw error;
    }
  }

  private observeGitCommand(tool: AgentTool): AgentTool {
    return {
      ...tool,
      execute: async (...args) => {
        const directory = this.state.workingDirectory;
        if (!this.gitFilesBefore || !directory) return tool.execute(...args);
        const before = await captureGitSnapshot(directory);
        args[2]?.throwIfAborted();
        try {
          return await tool.execute(...args);
        } finally {
          this.commandObservations.push({ before, after: await captureGitSnapshot(directory) });
        }
      },
    };
  }

  private recordedGitChanges(
    directory: string,
    root: string,
    messages: AgentMessage[],
  ): Map<string, RecordedFileChange[]> {
    const files = new Map<string, RecordedFileChange[]>();
    for (const message of messages) {
      if (message.role !== "toolResult") continue;
      const change = readFileChange(message.toolName, message.details);
      if (!change) continue;
      const path = relativeGitPath(directory, root, change.absolutePath);
      const changes = files.get(path) ?? [];
      changes.push(change);
      files.set(path, changes);
    }
    return files;
  }

  private async settle(messages: AgentMessage[], failure?: ModelFailure): Promise<void> {
    const { runId, sessionId, workingDirectory } = this.state;
    const reviewed = captureGitSnapshot(workingDirectory ?? undefined).then(async (current) => {
      const view = compareGitSnapshots(
        this.checkpoint.gitBaseline,
        current,
        "finished",
        this.resumed,
      );
      if (!view) return null;
      const checkpoint =
        workingDirectory && current && "root" in current
          ? await createGitTaskCheckpoint(
              runId,
              workingDirectory,
              this.checkpoint.gitBaseline,
              current,
              this.gitFilesBefore,
              view,
              this.recordedGitChanges(
                workingDirectory,
                current.root,
                messages.slice(this.checkpoint.startIndex),
              ),
              this.commandObservations,
            )
          : undefined;
      return {
        type: "pilot_git_changes" as const,
        workingDirectory,
        view,
        checkpoint,
        snapshot: checkpoint ? undefined : current,
      };
    });
    this.finishedGitChanges = reviewed.then((saved) => (saved ? finishedGitView(saved) : null));
    const changes = await reviewed;
    if (this.interruptedForExit) return;
    const checkpoint = failure ? { ...this.checkpoint, failure } : undefined;
    this.deps.store.save(sessionId, messages, checkpoint, changes, this.checkpoint.task);
    this.deps.view.messages = toUiMessages(messages, "s", (name) => this.toolLabel(name));
    this.deps.view.nextId = this.deps.view.messages.length;
    this.send({ type: "messages", messages: this.deps.view.messages });
    const last = messages.at(-1);
    if (last?.role === "assistant" && last.stopReason === "error") {
      this.send({ type: "error", message: last.errorMessage ?? "模型返回错误" });
    }
    this.deps.onSessionUpdated();
  }

  private toolLabel(name: string): string {
    return this.deps.mcp.policyOf(name)?.label ?? labelOf(name);
  }
}

export function finishedGitView(saved: SavedGitChanges): GitChangesView {
  if (!saved.checkpoint || !saved.checkpoint.files.length) return saved.view;
  const checkpoint = describeGitCheckpoint(saved.checkpoint);
  const reverted = new Set(
    checkpoint.files.filter((file) => file.reverted).map((file) => file.path),
  );
  return {
    ...saved.view,
    checkpoint,
    changes:
      saved.view.changes?.map((change) =>
        change.area !== "staged" && reverted.has(change.path)
          ? { ...change, taskReverted: true }
          : change,
      ) ?? null,
  };
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
