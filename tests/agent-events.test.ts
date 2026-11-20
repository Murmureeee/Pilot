import { describe, expect, it } from "vitest";
import { applyAgentEvent, initialAgentUiState } from "../src/renderer/src/adapters/agent-events";
import type { UiMessage } from "../src/shared/contract";

describe("agent-events adapter", () => {
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
      activeSessionId: session.id,
    });
    expect(state).toMatchObject({ sessionId: session.id, sessions: [session], messages: [] });
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
    const state = applyAgentEvent(initialAgentUiState(), { type: "user_message", message });
    expect(state.messages).toEqual([message]);
  });

  it("accumulates streaming deltas into the matching assistant message", () => {
    let state = initialAgentUiState();
    const id = "s-1";
    state = applyAgentEvent(state, {
      type: "user_message",
      message: { id: "s-0", role: "user", parts: [{ type: "text", text: "hi" }] },
    });
    state = applyAgentEvent(state, { type: "assistant_start", id });
    state = applyAgentEvent(state, { type: "assistant_delta", id, delta: "pon" });
    state = applyAgentEvent(state, { type: "assistant_delta", id, delta: "g" });
    state = applyAgentEvent(state, { type: "assistant_end", id });

    expect(state.messages).toHaveLength(2);
    const assistant = state.messages[1] as UiMessage;
    expect(assistant.parts).toEqual([{ type: "text", text: "pong" }]);
  });

  it("completes thinking on its own event while the assistant is still streaming", () => {
    let state = initialAgentUiState();
    const id = "s-1";
    state = applyAgentEvent(state, { type: "assistant_start", id });
    state = applyAgentEvent(state, { type: "thinking_start", id, blockIndex: 0 });
    state = applyAgentEvent(state, { type: "thinking_delta", id, blockIndex: 0, delta: "let me " });
    const active = state;
    state = applyAgentEvent(state, { type: "thinking_delta", id, blockIndex: 0, delta: "think" });
    state = applyAgentEvent(state, {
      type: "thinking_end",
      id,
      blockIndex: 0,
      text: "let me think",
      durationMs: 3000,
    });
    state = applyAgentEvent(state, { type: "assistant_delta", id, delta: "answer" });

    const assistant = state.messages[0] as UiMessage;
    expect(active.messages[0].parts[0]).toMatchObject({ streaming: true, text: "let me " });
    expect(assistant.streaming).toBe(true);
    expect(assistant.parts).toEqual([
      { type: "thinking", blockIndex: 0, text: "let me think", streaming: false, durationMs: 3000 },
      { type: "text", text: "answer" },
    ]);
  });

  it("creates and updates tool parts through the tool lifecycle", () => {
    let state = initialAgentUiState();
    state = applyAgentEvent(state, { type: "assistant_start", id: "a" });
    state = applyAgentEvent(state, {
      type: "tool_start",
      callId: "c1",
      toolName: "write_file",
      label: "写入文件",
      inputSummary: '{"path":"a.txt"}',
    });
    state = applyAgentEvent(state, { type: "tool_update", callId: "c1", output: "partial" });
    state = applyAgentEvent(state, {
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
    let state = initialAgentUiState();
    state = applyAgentEvent(state, { type: "assistant_start", id: "a" });
    state = applyAgentEvent(state, {
      type: "tool_start",
      callId: "c2",
      toolName: "bash",
      label: "执行命令",
      inputSummary: '{"command":"oops"}',
    });
    state = applyAgentEvent(state, {
      type: "tool_end",
      callId: "c2",
      state: "error",
      error: "boom",
    });

    const part = state.messages[0].parts[0];
    expect(part).toMatchObject({ type: "tool", state: "error", error: "boom" });
  });

  it("keeps dispatch order and immutable snapshots when tools finish out of order", () => {
    let state = applyAgentEvent(initialAgentUiState(), { type: "assistant_start", id: "a" });
    const first = {
      id: "a",
      callId: "first",
      toolName: "bash",
      label: "执行命令",
      inputSummary: '{"command":"pwd"}',
    };
    const second = { id: "a", callId: "second", toolName: "edit_file", label: "编辑文件" };
    state = applyAgentEvent(state, { type: "tool_call", ...first });
    state = applyAgentEvent(state, { type: "tool_call", ...second });
    const queued = state;
    state = applyAgentEvent(state, { type: "tool_start", ...second });
    state = applyAgentEvent(state, {
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
    state = applyAgentEvent(state, { type: "file_change", callId: "second", change });
    state = applyAgentEvent(state, { type: "tool_start", ...first });
    state = applyAgentEvent(state, {
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
    let state = applyAgentEvent(initialAgentUiState(), { type: "assistant_start", id: "a" });
    const firstPlan = [{ title: "First task", status: "completed" as const }];
    state = applyAgentEvent(state, { type: "plan", steps: firstPlan });
    state = applyAgentEvent(state, {
      type: "user_message",
      message: { id: "u", role: "user", parts: [{ type: "text", text: "second task" }] },
    });
    state = applyAgentEvent(state, { type: "assistant_start", id: "b" });
    state = applyAgentEvent(state, {
      type: "plan",
      steps: [{ title: "Second task", status: "in_progress" }],
    });
    const previous = state;
    state = applyAgentEvent(state, { type: "assistant_start", id: "c" });
    const completed = [{ title: "Second task", status: "completed" as const }];
    state = applyAgentEvent(state, { type: "plan", steps: completed });

    expect(state.messages[0].parts).toEqual([{ type: "plan", steps: firstPlan }]);
    expect(state.messages[2].parts).toEqual([{ type: "plan", steps: completed }]);
    expect(state.messages[3].parts).toEqual([]);
    expect(previous.messages[2].parts[0]).toMatchObject({ steps: [{ status: "in_progress" }] });
  });

  it("adopts the latest usage totals (主进程累计后发总量，reducer 只替换) and queue counts", () => {
    let state = initialAgentUiState();
    state = applyAgentEvent(state, {
      type: "usage",
      tokens: { input: 10, output: 5, cacheRead: 2 },
      costTotal: 0.01,
      contextTokens: 17,
      contextWindow: 128_000,
    });
    state = applyAgentEvent(state, {
      type: "usage",
      tokens: { input: 30, output: 13, cacheRead: 6 },
      costTotal: 0.03,
      contextTokens: 49,
      contextWindow: 64_000,
    });
    state = applyAgentEvent(state, { type: "queue", steerCount: 2 });
    expect(state.usage).toEqual({ input: 30, output: 13, cacheRead: 6, costTotal: 0.03 });
    // 上下文占用同样是"最近一轮快照"语义：只替换、不累加
    expect(state.contextTokens).toBe(49);
    expect(state.contextWindow).toBe(64_000);
    expect(state.steerCount).toBe(2);
  });

  it("refreshes the sessions list wholesale (自动标题/重命名/删除后)", () => {
    let state = initialAgentUiState();
    const sessions = [
      { id: "a", title: "重命名后的标题", createdAt: 1, updatedAt: 2, titleCustom: true },
    ];
    state = applyAgentEvent(state, { type: "sessions", sessions, activeSessionId: "a" });
    expect(state.sessions).toEqual(sessions);
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
    };
    const second = { ...first, requestId: "r2", danger: false };
    let state = applyAgentEvent(initialAgentUiState(), {
      type: "status",
      status: "waiting_approval",
    });
    state = applyAgentEvent(state, first);
    state = applyAgentEvent(state, second);
    expect(state.pendingPermissions).toEqual([first, second]);
    for (const status of ["streaming", "idle"] as const) {
      expect(applyAgentEvent(state, { type: "status", status }).pendingPermissions).toEqual([]);
    }
  });

  it("transitions status and keeps errors independent", () => {
    let state = initialAgentUiState();
    state = applyAgentEvent(state, { type: "status", status: "waiting_approval" });
    state = applyAgentEvent(state, { type: "error", message: "boom" });
    expect(state.status).toBe("waiting_approval");
    expect(state.error).toBe("boom");
  });
});
