import { describe, expect, it } from "vitest";
import { applyAgentEvent, initialAgentUiState } from "../src/renderer/src/adapters/agent-events";
import type { UiMessage } from "../src/shared/contract";

describe("agent-events adapter", () => {
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

  it("streams thinking into a dedicated part (thinking_start + deltas)", () => {
    let state = initialAgentUiState();
    const id = "s-1";
    state = applyAgentEvent(state, { type: "assistant_start", id });
    state = applyAgentEvent(state, { type: "thinking_start", id });
    state = applyAgentEvent(state, { type: "thinking_delta", id, delta: "let me " });
    state = applyAgentEvent(state, { type: "thinking_delta", id, delta: "think" });
    // 思考结束后正文开始：text 追加在 thinking 块之后，不混入思考文本
    state = applyAgentEvent(state, { type: "assistant_delta", id, delta: "answer" });

    const assistant = state.messages[0] as UiMessage;
    expect(assistant.parts).toEqual([
      { type: "thinking", text: "let me think" },
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
    });
    state = applyAgentEvent(state, {
      type: "usage",
      tokens: { input: 30, output: 13, cacheRead: 6 },
      costTotal: 0.03,
      contextTokens: 49,
    });
    state = applyAgentEvent(state, { type: "queue", steerCount: 2 });
    expect(state.usage).toEqual({ input: 30, output: 13, cacheRead: 6, costTotal: 0.03 });
    // 上下文占用同样是"最近一轮快照"语义：只替换、不累加
    expect(state.contextTokens).toBe(49);
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

  it("holds the latest permission request and clears on respond", () => {
    let state = initialAgentUiState();
    state = applyAgentEvent(state, {
      type: "permission_request",
      requestId: "r1",
      toolName: "bash",
      label: "执行命令",
      inputSummary: "{}",
      danger: true,
    });
    expect(state.pendingPermission?.requestId).toBe("r1");
    expect(state.pendingPermission?.danger).toBe(true);
    // 应答清空由 store 负责（respondPermission），reducer 只负责暂存
  });

  it("transitions status and keeps errors independent", () => {
    let state = initialAgentUiState();
    state = applyAgentEvent(state, { type: "status", status: "waiting_approval" });
    state = applyAgentEvent(state, { type: "error", message: "boom" });
    expect(state.status).toBe("waiting_approval");
    expect(state.error).toBe("boom");
  });
});
