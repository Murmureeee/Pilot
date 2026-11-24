import { describe, expect, it } from "vitest";

import {
  applyAgentEvent,
  initialAgentUiState,
  type AgentUiState,
} from "../src/renderer/src/adapters/agent-events";
import type { AgentRunEvent, SessionMeta, UiMessage } from "../src/shared/contract";

const run = { runId: "running-1", sessionId: "a" };

function initialRunUiState(): AgentUiState {
  return applyAgentEvent(
    { ...initialAgentUiState(), sessionId: run.sessionId },
    { type: "run_started", run: { ...run, status: "streaming", workingDirectory: "E:/a" } },
  );
}

function applyRunEvent(state: AgentUiState, event: AgentRunEvent): AgentUiState {
  return applyAgentEvent(state, { ...event, run });
}

describe("agent-events adapter", () => {
  it("resets only the streaming reply on retry and clears the state when the task fails", () => {
    const started = applyRunEvent(initialRunUiState(), { type: "assistant_start", id: "reply" });
    const partial = applyRunEvent(started, {
      type: "assistant_delta",
      id: "reply",
      delta: "Partial",
    });
    const retry = { attempt: 1, maxAttempts: 3, retryAt: 12_345 };
    const event = { type: "model_retry", retry, resetReplyId: "reply" } as const;
    const other = { ...partial, sessionId: "another" };
    expect(applyRunEvent(other, event)).toMatchObject({
      activeRun: { retry },
      messages: other.messages,
    });
    const waiting = applyRunEvent(partial, event);
    expect(waiting.activeRun?.retry).toEqual(retry);
    expect(waiting.messages).toEqual([
      { id: "reply", role: "assistant", parts: [], streaming: true },
    ]);
    expect(applyAgentEvent(waiting, { ...event, run: { ...run, runId: "stale" } })).toBe(waiting);
    const failedRun = {
      ...run,
      workingDirectory: "E:/a",
      failure: { kind: "server", detail: "503" },
    } as const;
    const ended = applyRunEvent(waiting, { type: "status", status: "idle", failedRun });
    expect(ended).toMatchObject({ activeRun: null, interruptedRun: null, failedRun });
    const next = { ...run, runId: "next", workingDirectory: "E:/a", status: "streaming" } as const;
    expect(applyAgentEvent(ended, { type: "run_started", run: next }).failedRun).toBeNull();
  });

  it("keeps verification output separate from agent messages and usage", () => {
    const state = initialRunUiState();
    expect(
      applyAgentEvent(state, {
        type: "verification_updated",
        result: {
          ...run,
          runId: "check-1",
          task: { taskId: "task-1", agentRunId: run.runId },
          kind: "test",
          command: "pnpm test --run",
          shell: "powershell",
          workingDirectory: "E:/a",
          status: "success",
          output: "passed",
          startedAt: 1,
          durationMs: 24,
          exitCode: 0,
          revision: 1,
        },
      }),
    ).toBe(state);
  });
  it("activates a newly created project session before its first message arrives", () => {
    const session = {
      id: "project-chat",
      title: "New chat",
      workingDirectory: "E:/projects/Pilot",
      createdAt: 1,
      updatedAt: 1,
    };
    const state = applyAgentEvent(initialAgentUiState(), {
      type: "sessions",
      sessions: [session],
      recentProjects: [session.workingDirectory],
      activeSessionId: session.id,
    });
    expect(state).toMatchObject({
      sessionId: session.id,
      sessions: [session],
      recentProjects: [session.workingDirectory],
      messages: [],
    });
  });

  it("preserves typed references in a user message event", () => {
    const message: UiMessage = {
      id: "s-0",
      role: "user",
      parts: [
        { type: "text", text: "Read " },
        { type: "mention", kind: "file", id: "src/index.ts", label: "index.ts" },
        { type: "text", text: "." },
      ],
    };
    const state = applyRunEvent(initialRunUiState(), { type: "user_message", message });
    expect(state.messages).toEqual([message]);
  });

  it("accumulates streaming deltas into the matching assistant message", () => {
    let state = initialRunUiState();
    const id = "s-1";
    state = applyRunEvent(state, {
      type: "user_message",
      message: { id: "s-0", role: "user", parts: [{ type: "text", text: "hi" }] },
    });
    state = applyRunEvent(state, { type: "assistant_start", id });
    state = applyRunEvent(state, { type: "assistant_delta", id, delta: "pon" });
    state = applyRunEvent(state, { type: "assistant_delta", id, delta: "g" });
    state = applyRunEvent(state, { type: "assistant_end", id });

    expect(state.messages).toHaveLength(2);
    const assistant = state.messages[1] as UiMessage;
    expect(assistant.parts).toEqual([{ type: "text", text: "pong" }]);
  });

  it("completes thinking on its own event while the assistant is still streaming", () => {
    let state = initialRunUiState();
    const id = "s-1";
    state = applyRunEvent(state, { type: "assistant_start", id });
    state = applyRunEvent(state, { type: "thinking_start", id, blockIndex: 0 });
    state = applyRunEvent(state, { type: "thinking_delta", id, blockIndex: 0, delta: "let me " });
    const active = state;
    state = applyRunEvent(state, { type: "thinking_delta", id, blockIndex: 0, delta: "think" });
    state = applyRunEvent(state, {
      type: "thinking_end",
      id,
      blockIndex: 0,
      text: "let me think",
      durationMs: 3000,
    });
    state = applyRunEvent(state, { type: "assistant_delta", id, delta: "answer" });

    const assistant = state.messages[0] as UiMessage;
    expect(active.messages[0].parts[0]).toMatchObject({ streaming: true, text: "let me " });
    expect(assistant.streaming).toBe(true);
    expect(assistant.parts).toEqual([
      { type: "thinking", blockIndex: 0, text: "let me think", streaming: false, durationMs: 3000 },
      { type: "text", text: "answer" },
    ]);
  });

  it("creates and updates tool parts through the tool lifecycle", () => {
    let state = initialRunUiState();
    state = applyRunEvent(state, { type: "assistant_start", id: "a" });
    state = applyRunEvent(state, {
      type: "tool_start",
      callId: "c1",
      toolName: "write_file",
      label: "写入文件",
      inputSummary: '{"path":"a.txt"}',
    });
    state = applyRunEvent(state, { type: "tool_update", callId: "c1", output: "partial" });
    state = applyRunEvent(state, {
      type: "tool_end",
      callId: "c1",
      state: "success",
      output: "done",
    });

    const part = state.messages[0].parts[0];
    expect(part).toMatchObject({
      type: "tool",
      callId: "c1",
      state: "success",
      output: "done",
    });
  });

  it("marks tool parts as error with error output", () => {
    let state = initialRunUiState();
    state = applyRunEvent(state, { type: "assistant_start", id: "a" });
    state = applyRunEvent(state, {
      type: "tool_start",
      callId: "c2",
      toolName: "bash",
      label: "执行命令",
      inputSummary: '{"command":"oops"}',
    });
    state = applyRunEvent(state, {
      type: "tool_end",
      callId: "c2",
      state: "error",
      error: "boom",
    });

    const part = state.messages[0].parts[0];
    expect(part).toMatchObject({ type: "tool", state: "error", error: "boom" });
  });

  it("keeps dispatch order and immutable snapshots when tools finish out of order", () => {
    let state = applyRunEvent(initialRunUiState(), { type: "assistant_start", id: "a" });
    const first = {
      id: "a",
      callId: "first",
      toolName: "bash",
      label: "执行命令",
      inputSummary: '{"command":"pwd"}',
    };
    const second = { id: "a", callId: "second", toolName: "edit_file", label: "编辑文件" };
    state = applyRunEvent(state, { type: "tool_call", ...first });
    state = applyRunEvent(state, { type: "tool_call", ...second });
    const queued = state;
    state = applyRunEvent(state, { type: "tool_start", ...second });
    state = applyRunEvent(state, {
      type: "tool_end",
      callId: "second",
      state: "success",
      output: "written",
      durationMs: 12,
    });
    const completed = state;
    const change = {
      id: "test-change",
      path: "src/main.ts",
      kind: "modified" as const,
      stats: { added: 2, removed: 1 },
    };
    state = applyRunEvent(state, { type: "file_change", callId: "second", change });
    state = applyRunEvent(state, { type: "tool_start", ...first });
    state = applyRunEvent(state, {
      type: "tool_end",
      callId: "first",
      state: "error",
      error: "command failed",
    });
    expect(state.messages[0].parts).toMatchObject([
      { callId: "first", state: "error", error: "command failed" },
      { callId: "second", state: "success", fileChange: change, durationMs: 12 },
    ]);
    expect(queued.messages[0].parts[1]).toMatchObject({ state: "pending" });
    expect(completed.messages[0].parts[1]).not.toHaveProperty("fileChange");
  });

  it("replaces the plan for the current turn without touching earlier turns", () => {
    let state = applyRunEvent(initialRunUiState(), { type: "assistant_start", id: "a" });
    const firstPlan = [{ title: "First task", status: "completed" as const }];
    state = applyRunEvent(state, { type: "plan", steps: firstPlan });
    state = applyRunEvent(state, {
      type: "user_message",
      message: { id: "u", role: "user", parts: [{ type: "text", text: "second task" }] },
    });
    state = applyRunEvent(state, { type: "assistant_start", id: "b" });
    state = applyRunEvent(state, {
      type: "plan",
      steps: [{ title: "Second task", status: "in_progress" }],
    });
    const previous = state;
    state = applyRunEvent(state, { type: "assistant_start", id: "c" });
    const completed = [{ title: "Second task", status: "completed" as const }];
    state = applyRunEvent(state, { type: "plan", steps: completed });

    expect(state.messages[0].parts).toEqual([{ type: "plan", steps: firstPlan }]);
    expect(state.messages[2].parts).toEqual([{ type: "plan", steps: completed }]);
    expect(state.messages[3].parts).toEqual([]);
    expect(previous.messages[2].parts[0]).toMatchObject({ steps: [{ status: "in_progress" }] });
  });

  it("adopts the latest usage totals (主进程累计后发总量，reducer 只替换) and queue counts", () => {
    let state = initialRunUiState();
    state = applyRunEvent(state, {
      type: "usage",
      tokens: { input: 10, output: 5, cacheRead: 2, cacheWrite: 1 },
      costTotal: 0.01,
      contextTokens: 17,
      contextWindow: 128_000,
    });
    state = applyRunEvent(state, {
      type: "usage",
      tokens: { input: 30, output: 13, cacheRead: 6, cacheWrite: 2 },
      costTotal: 0.03,
      contextTokens: 49,
      contextWindow: 64_000,
    });
    state = applyRunEvent(state, { type: "queue", steerCount: 2 });
    expect(state.usage).toEqual({
      input: 30,
      output: 13,
      cacheRead: 6,
      cacheWrite: 2,
      costTotal: 0.03,
    });
    // 上下文占用同样是"最近一轮快照"语义：只替换、不累加
    expect(state.contextTokens).toBe(49);
    expect(state.contextWindow).toBe(64_000);
    expect(state.steerCount).toBe(2);
  });

  it("places compression markers between transcript messages without changing their IDs", () => {
    const messages: UiMessage[] = [
      { id: "first", role: "user", parts: [] },
      { id: "second", role: "assistant", parts: [] },
    ];
    const compaction = { id: "summary", position: 1, summary: "Saved", trimmedTools: 1 };
    let state = applyRunEvent(initialRunUiState(), { type: "messages", messages });
    state = applyRunEvent(state, { type: "context_compacting", compacting: true });
    expect(state.activeRun?.compacting).toBe(true);
    const event = { type: "context_compacted", compaction, contextTokens: 1200 } as const;
    const other = { ...state, sessionId: "other" };
    expect(applyRunEvent(other, event)).toBe(other);
    state = applyRunEvent(applyRunEvent(state, event), event);
    expect(state.contextTokens).toBe(1200);
    expect(state.messages.map(({ id }) => id)).toEqual(["first", "compaction-summary", "second"]);
    expect(state.messages[1].parts).toEqual([{ type: "compaction", compaction }]);
  });

  it("refreshes the sessions list wholesale (自动标题/重命名/删除后)", () => {
    let state = initialAgentUiState();
    const sessions = [
      {
        id: "a",
        title: "重命名后的标题",
        createdAt: 1,
        updatedAt: 2,
        titleCustom: true,
        model: { providerId: "local", modelId: "chat" },
        approvalMode: "read-only",
      },
    ] satisfies SessionMeta[];
    state.recentProjects = ["E:/projects/previous"];
    state = applyAgentEvent(state, {
      type: "sessions",
      sessions,
      recentProjects: ["E:/projects/Pilot"],
      activeSessionId: "a",
    });
    expect(state.sessions).toEqual(sessions);
    expect(state.recentProjects).toEqual(["E:/projects/Pilot"]);
    expect(state.sessionId).toBe("a");
  });

  it("queues permission requests in arrival order and clears them when approval ends", () => {
    const first = {
      type: "permission_request" as const,
      requestId: "r1",
      toolName: "bash",
      label: "执行命令",
      inputSummary: "{}",
      danger: true,
      commandDanger: "git-clean" as const,
    };
    const second: Extract<AgentRunEvent, { type: "permission_request" }> = {
      ...first,
      requestId: "r2",
      danger: false,
      commandDanger: undefined,
      command: "pnpm test",
      workingDirectory: "E:/projects/Pilot",
      rule: { toolName: "bash", commandPrefix: { shell: "powershell", args: ["pnpm", "test"] } },
    };
    let state = applyRunEvent(initialRunUiState(), {
      type: "status",
      status: "waiting_approval",
    });
    state = applyRunEvent(state, first);
    state = applyRunEvent(state, second);
    expect(state.pendingPermissions).toEqual([first, second]);
    state = applyRunEvent(state, { type: "permission_resolved", requestId: first.requestId });
    expect(state.pendingPermissions).toEqual([second]);
    expect(state.status).toBe("waiting_approval");
    for (const status of ["streaming", "stopping", "idle"] as const) {
      expect(applyRunEvent(state, { type: "status", status }).pendingPermissions).toEqual([]);
    }
  });

  it("updates the background run notice while ignoring its messages, queue, errors, and stale completion", () => {
    const state = {
      ...initialRunUiState(),
      sessionId: "b",
      status: "idle" as const,
      messages: [
        { id: "s-0", role: "assistant", parts: [{ type: "text", text: "B" }] },
      ] satisfies UiMessage[],
    };
    const waiting = applyRunEvent(state, { type: "status", status: "waiting_approval" });
    expect(waiting.status).toBe("idle");
    expect(waiting.activeRun?.status).toBe("waiting_approval");
    const background: AgentRunEvent[] = [
      { type: "assistant_delta", id: "s-0", delta: "A only" },
      { type: "queue", steerCount: 1 },
      { type: "error", message: "A failed" },
      {
        type: "permission_request",
        requestId: "a1",
        toolName: "bash",
        label: "Bash",
        inputSummary: "{}",
        danger: false,
      },
    ];
    for (const event of background) expect(applyRunEvent(waiting, event)).toBe(waiting);
    expect(
      applyAgentEvent(waiting, {
        type: "status",
        status: "idle",
        run: { ...run, runId: "older-run" },
      }),
    ).toBe(waiting);
    expect(applyRunEvent(waiting, { type: "status", status: "idle" })).toMatchObject({
      sessionId: "b",
      messages: state.messages,
      activeRun: null,
    });
  });

  it("transitions status and keeps errors independent", () => {
    let state = initialRunUiState();
    state = applyRunEvent(state, { type: "status", status: "waiting_approval" });
    state = applyRunEvent(state, { type: "error", message: "boom" });
    expect(state.status).toBe("waiting_approval");
    expect(state.error).toBe("boom");
  });

  it("keeps the interrupted checkpoint on its chat and clears it when the task resumes", () => {
    const checkpoint = { ...run, workingDirectory: "E:/a" };
    const ended = { type: "status", status: "idle", interruptedRun: checkpoint } as const;
    const state = initialRunUiState();
    expect(applyRunEvent({ ...state, sessionId: "b" }, ended).interruptedRun).toBeNull();
    const interrupted = applyRunEvent(state, ended);
    expect(interrupted.interruptedRun).toEqual(checkpoint);
    const next = { ...checkpoint, runId: "resume", status: "streaming" } as const;
    expect(
      applyAgentEvent(interrupted, { type: "run_started", run: next }).interruptedRun,
    ).toBeNull();
  });
});
