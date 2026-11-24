// @env node
import { randomUUID } from "node:crypto";

import type {
  AgentEvent,
  AgentMessage,
  AgentTool,
  BeforeToolCallContext,
  BeforeToolCallResult,
  StreamFn,
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
  SkillMeta,
  ToolRule,
  Snapshot,
  UiUserPart,
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
import { CONTEXT_COMPACTION_RATIO } from "./constants";
import {
  assistantUsage,
  compactContext,
  compactedContext,
  compactionMarker,
  contextSize,
} from "./context-compaction";
import { capabilitiesFromModel } from "./model-capabilities";
import { withModelRetry } from "./model-retry";
import { PermissionManager } from "./permissions";
import { actionFingerprint, completeToolResults, failedRunOf, interruptedRunOf } from "./recovery";
import { messageParts, messageText, toUiMessages } from "./session-store";
import { skillCatalog } from "./skills";
import { labelOf } from "./tools";
import { PLAN_TOOL_NAME } from "./tools/constants";
import { readPlanSteps } from "./tools/plan";
import { createReadSkillTool } from "./tools/read-skill";
import type {
  AgentRunOptions,
  ReferencedUserMessage,
  RunCheckpoint,
  SavedCompaction,
  SavedGitChanges,
  TimedAssistantMessage,
} from "./types";

export class AgentRun {
  private currentState: ActiveRun;
  private checkpoint: RunCheckpoint;
  private savedMessageCount: number;
  private readonly preparation = new AbortController();
  private readonly completion = Promise.withResolvers<void>();
  private readonly permissions: PermissionManager;
  private readonly previousActions: ReadonlySet<string>;
  private readonly finishedTools = new Map<string, ToolResultMessage>();
  private readonly commandObservations: GitCommandObservation[] = [];
  private readonly listedSkills: ReadonlyMap<string, SkillMeta>;
  private readonly selectedSkillIds = new Set<string>();
  private readonly thinkingStarts = new Map<number, number>();
  private thinkingDurations: Record<number, number> = {};
  private gitFilesBefore?: GitCheckpointBase;
  private finishedGitChanges?: Promise<GitChangesView | null>;
  private persistError?: unknown;
  private modelFailure?: ModelFailure;
  private latestCompaction?: SavedCompaction;
  private autoCompactionFailed = false;
  private ownsCheckpoint: boolean;
  private interruptedForExit = false;
  private queuedMessages = 0;
  readonly resumed: boolean;
  readonly gitBaseline: Promise<GitSnapshot>;

  constructor(private readonly deps: AgentRunOptions) {
    const { agent, sessionId, environment, store, initialMessage, clearDraftFor } = deps;
    this.listedSkills = new Map(deps.skills.map((skill) => [skill.id, skill]));
    const previous = store.checkpoint(sessionId);
    this.latestCompaction = store.compactions(sessionId).at(-1);
    this.ownsCheckpoint = deps.compaction === undefined;
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
      modelCapabilities: capabilitiesFromModel(agent.state.model),
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
    if (this.ownsCheckpoint)
      store.startCheckpoint(sessionId, agent.state.messages, this.checkpoint);
    this.savedMessageCount = agent.state.messages.length;
    if (clearDraftFor !== undefined) store.saveDraft(clearDraftFor, []);
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
      : deps.compaction?.mode === "manual"
        ? Promise.resolve({ unavailable: true })
        : captureGitSnapshot(workingDirectory);
    deps.view.error = null;
  }

  get state(): ActiveRun {
    return this.currentState;
  }

  get acceptsPrompts(): boolean {
    return this.ownsCheckpoint;
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

  enqueue(message: ReferencedUserMessage, clearDraftFor?: string): void {
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
    const streamFunction = agent.streamFunction;
    agent.transformContext = (messages, requestSignal) =>
      this.prepareContext(messages, streamFunction, requestSignal ?? signal);
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
      const compaction = this.deps.compaction;
      if (compaction) {
        const pending = store.checkpoint(sessionId)?.pending.length ?? 0;
        const messages = agent.state.messages.slice(0, agent.state.messages.length - pending);
        const focus = compaction.mode === "manual" ? compaction.focus : "";
        const changed = await this.compact(messages, streamFunction, signal, true, focus);
        if (compaction.mode === "manual") {
          if (!changed && !signal.aborted) throw new Error("没有足够的较早内容可压缩。");
          return;
        }
        signal.throwIfAborted();
        if (!changed)
          throw new Error("没有足够的较早内容可压缩。请缩短当前请求或换用上下文更大的模型。");
      }
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
      if (this.listedSkills.size) {
        localTools.push(
          createReadSkillTool((id) => {
            const skill = this.listedSkills.get(id);
            return skill?.enabled || this.selectedSkillIds.has(id) ? skill : undefined;
          }),
        );
      }
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
      if (this.interruptedForExit && this.ownsCheckpoint) {
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

  private async prepareContext(
    messages: AgentMessage[],
    stream: StreamFn,
    signal: AbortSignal,
  ): Promise<AgentMessage[]> {
    const prepared = this.prepareRequestMessages(messages, this.deps.systemPrompt);
    const projected = compactedContext(prepared, this.latestCompaction, messages);
    const { contextWindow } = this.deps.agent.state.model;
    if (
      this.autoCompactionFailed ||
      contextSize(projected) < contextWindow * CONTEXT_COMPACTION_RATIO
    )
      return projected;
    try {
      if (await this.compact(messages, stream, signal, false, ""))
        return compactedContext(prepared, this.latestCompaction, messages);
    } catch {
      signal.throwIfAborted();
      this.autoCompactionFailed = true;
    }
    return projected;
  }

  private async compact(
    messages: AgentMessage[],
    stream: StreamFn,
    signal: AbortSignal,
    force: boolean,
    focus: string,
  ): Promise<boolean> {
    signal.throwIfAborted();
    const { agent, store } = this.deps;
    const prepared = this.prepareRequestMessages(messages, this.deps.systemPrompt);
    this.currentState = { ...this.state, compacting: true };
    this.send({ type: "context_compacting", compacting: true });
    try {
      const compaction = await compactContext({
        messages: prepared,
        original: messages,
        previous: this.latestCompaction,
        model: agent.state.model,
        stream,
        signal,
        force,
        focus,
        apiKey: await agent.getApiKey?.(agent.state.model.provider),
      });
      signal.throwIfAborted();
      if (!compaction) return false;
      if (this.deps.compaction?.mode === "retry" && !this.ownsCheckpoint) {
        // Commit the smaller context and transfer the saved task in the same write.
        store.addCompaction(
          this.state.sessionId,
          agent.state.messages,
          compaction,
          this.checkpoint,
        );
        this.ownsCheckpoint = true;
      } else {
        store.addCompaction(this.state.sessionId, messages, compaction);
      }
      this.savedMessageCount = agent.state.messages.length;
      this.latestCompaction = compaction;
      const contextTokens = contextSize(compactedContext(prepared, compaction, messages));
      this.deps.view.contextTokens = contextTokens;
      if (compaction.usage) this.addUsage(compaction.usage);
      this.send({
        type: "context_compacted",
        compaction: compactionMarker(compaction),
        contextTokens,
      });
      return true;
    } finally {
      this.currentState = { ...this.state, compacting: false };
      this.send({ type: "context_compacting", compacting: false });
    }
  }

  private addUsage(usage: Snapshot["usage"]): void {
    const view = this.deps.view;
    view.usage.input += usage.input;
    view.usage.output += usage.output;
    view.usage.cacheRead += usage.cacheRead;
    view.usage.cacheWrite += usage.cacheWrite;
    view.usage.costTotal += usage.costTotal;
    this.send({
      type: "usage",
      tokens: {
        input: view.usage.input,
        output: view.usage.output,
        cacheRead: view.usage.cacheRead,
        cacheWrite: view.usage.cacheWrite,
      },
      costTotal: view.usage.costTotal,
      contextTokens: view.contextTokens,
      contextWindow: view.contextWindow,
    });
  }

  private prepareRequestMessages(messages: AgentMessage[], systemPrompt: string): AgentMessage[] {
    this.selectedSkillIds.clear();
    return messages.map((message, index) => {
      if (index === 0 && message.role === "system") {
        return { ...message, content: systemPrompt };
      }
      if (message.role === "toolResult" && readFileChange(message.toolName, message.details)) {
        return { ...message, details: undefined };
      }
      if (message.role !== "user") return message;
      const { pilotReference, ...providerMessage } = message as ReferencedUserMessage;
      if (!pilotReference) return message;
      const content = [messageText(message)];
      if (typeof pilotReference?.context === "string") content.push(pilotReference.context);
      if (index >= this.checkpoint.startIndex) {
        const selected = this.collectSelectedSkills(pilotReference.parts ?? []);
        if (selected.length)
          content.push("## Skills selected for this request", skillCatalog(selected));
      }
      return {
        ...providerMessage,
        content: content.join("\n\n"),
      };
    });
  }

  private collectSelectedSkills(parts: readonly UiUserPart[]): SkillMeta[] {
    const selected: SkillMeta[] = [];
    for (const part of parts) {
      if (part.type !== "mention" || part.kind !== "skill" || this.selectedSkillIds.has(part.id))
        continue;
      const skill = this.listedSkills.get(part.id);
      if (
        !skill ||
        (skill.source !== "installed" && part.workingDirectory !== this.state.workingDirectory)
      )
        continue;
      this.selectedSkillIds.add(part.id);
      if (!skill.enabled) selected.push(skill);
    }
    return selected;
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
      if (assistant.usage && assistant.stopReason !== "error") {
        // 上下文占用 = 最近一轮（不是累计）：请求携带的 input/cache + 本轮输出
        const u = assistant.usage;
        this.deps.view.contextTokens = u.input + u.output + u.cacheRead + (u.cacheWrite ?? 0);
        this.addUsage(assistantUsage(u));
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
      const completedTool: ToolResultMessage = {
        role: "toolResult",
        toolCallId: event.toolCallId,
        toolName: event.toolName,
        content: event.result.content ?? [],
        details: event.result.details,
        usage: event.result.usage,
        durationMs: event.durationMs,
        isError: event.isError,
        timestamp: Date.now(),
      };
      this.finishedTools.set(event.toolCallId, completedTool);
      this.saveCheckpoint(this.checkpoint, completedTool);
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

  private saveCheckpoint(checkpoint = this.checkpoint, completedTool?: ToolResultMessage): void {
    const { agent, store } = this.deps;
    const { sessionId } = this.state;
    const messages = agent.state.messages;
    try {
      if (this.persistError) {
        store.writeTranscript(sessionId, [...messages, ...this.finishedTools.values()], checkpoint);
      } else if (
        messages.length > this.savedMessageCount ||
        checkpoint !== this.checkpoint ||
        completedTool
      ) {
        store.appendCheckpoint(
          sessionId,
          messages.slice(this.savedMessageCount),
          checkpoint,
          completedTool,
        );
      }
      this.savedMessageCount = messages.length;
      this.checkpoint = checkpoint;
    } catch (error) {
      this.persistError = error;
      agent.abort();
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
    this.deps.view.messages = toUiMessages(
      messages,
      "s",
      (name) => this.toolLabel(name),
      this.deps.store.compactions(sessionId),
    );
    this.deps.view.nextId = this.deps.view.messages.filter(({ role }) => role !== "system").length;
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
