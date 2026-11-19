// @env browser
// 事件 → UI 状态的纯函数 reducer（NFR-6：独立测试覆盖）。
import type {
  AgentStatus,
  SessionMeta,
  UsageTotals,
  UiAgentEvent,
  UiMessage,
} from "@shared/contract";
import { applyPlanUpdate } from "../../../shared/plan";

export interface AgentUiState {
  status: AgentStatus;
  messages: UiMessage[];
  sessionId: string | null;
  error: string | null;
  usage: UsageTotals & { costTotal: number };
  /** 最近一轮的上下文占用 token 数（FR-4.7 状态栏显示占用百分比用） */
  contextTokens: number;
  steerCount: number;
  sessions: SessionMeta[];
  /** 待确认的权限请求（同一时刻只展示一条） */
  pendingPermission: Extract<UiAgentEvent, { type: "permission_request" }> | null;
}

export function initialAgentUiState(): AgentUiState {
  return {
    status: "idle",
    messages: [],
    sessionId: null,
    error: null,
    usage: { input: 0, output: 0, cacheRead: 0, costTotal: 0 },
    contextTokens: 0,
    steerCount: 0,
    sessions: [],
    pendingPermission: null,
  };
}

function appendDelta(message: UiMessage, delta: string): void {
  const last = message.parts.at(-1);
  if (last?.type === "text") {
    last.text += delta;
  } else {
    message.parts.push({ type: "text", text: delta });
  }
}

function updateToolPart(
  state: AgentUiState,
  callId: string,
  patch: (part: Extract<UiMessage["parts"][number], { type: "tool" }>) => void,
): void {
  for (let i = state.messages.length - 1; i >= 0; i--) {
    for (const part of state.messages[i].parts) {
      if (part.type === "tool" && part.callId === callId) {
        patch(part);
        return;
      }
    }
  }
}

export function applyAgentEvent(state: AgentUiState, event: UiAgentEvent): AgentUiState {
  switch (event.type) {
    case "status":
      return { ...state, status: event.status };
    case "messages":
      return { ...state, messages: event.messages };
    case "user_message":
      return { ...state, messages: [...state.messages, event.message] };
    case "assistant_start":
      return {
        ...state,
        messages: [...state.messages, { id: event.id, role: "assistant", parts: [] }],
      };
    case "assistant_delta": {
      const messages = state.messages.map((m) => {
        if (m.id !== event.id || m.role !== "assistant") return m;
        const next: UiMessage = { ...m, parts: [...m.parts] };
        appendDelta(next, event.delta);
        return next;
      });
      return { ...state, messages };
    }
    case "assistant_end":
      return state;
    case "thinking_start": {
      const messages = state.messages.map((m) => {
        if (m.id !== event.id || m.role !== "assistant") return m;
        return { ...m, parts: [...m.parts, { type: "thinking" as const, text: "" }] };
      });
      return { ...state, messages };
    }
    case "thinking_delta": {
      const messages = state.messages.map((m) => {
        if (m.id !== event.id || m.role !== "assistant") return m;
        // 追加到最后一个 thinking 块（text 块之后不会再回写 thinking）
        const parts = [...m.parts];
        for (let i = parts.length - 1; i >= 0; i--) {
          const part = parts[i];
          if (part.type === "thinking") {
            parts[i] = { ...part, text: part.text + event.delta };
            break;
          }
        }
        return { ...m, parts };
      });
      return { ...state, messages };
    }
    case "sessions":
      return {
        ...state,
        sessions: event.sessions,
        sessionId: event.activeSessionId ?? state.sessionId,
      };
    case "plan":
      return { ...state, messages: applyPlanUpdate(state.messages, event.steps) };
    case "tool_start":
      return {
        ...state,
        messages: state.messages.map((m, i) =>
          i === state.messages.length - 1 && m.role === "assistant"
            ? {
                ...m,
                parts: [
                  ...m.parts,
                  {
                    type: "tool",
                    callId: event.callId,
                    toolName: event.toolName,
                    label: event.label,
                    state: "running",
                    inputSummary: event.inputSummary,
                  },
                ],
              }
            : m,
        ),
      };
    case "tool_update": {
      const next = { ...state, messages: [...state.messages] };
      updateToolPart(next, event.callId, (part) => {
        part.output = event.output;
      });
      return next;
    }
    case "tool_end": {
      const next = { ...state, messages: [...state.messages] };
      updateToolPart(next, event.callId, (part) => {
        part.state = event.state;
        if (event.output !== undefined) part.output = event.output;
        if (event.error !== undefined) part.error = event.error;
      });
      return next;
    }
    case "usage":
      return {
        ...state,
        usage: { ...event.tokens, costTotal: event.costTotal },
        contextTokens: event.contextTokens,
      };
    case "queue":
      return { ...state, steerCount: event.steerCount };
    case "permission_request":
      return { ...state, pendingPermission: event };
    case "error":
      return { ...state, error: event.message };
    default:
      return state;
  }
}
