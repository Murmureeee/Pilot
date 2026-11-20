// @env browser
// 事件 → UI 状态的纯函数 reducer（NFR-6：独立测试覆盖）。
import type {
  AgentStatus,
  SessionMeta,
  UsageTotals,
  UiAgentEvent,
  UiMessage,
} from "@shared/contract";
import { applyMessageEvent } from "../../../shared/message-events";

export interface AgentUiState {
  status: AgentStatus;
  messages: UiMessage[];
  sessionId: string | null;
  error: string | null;
  usage: UsageTotals & { costTotal: number };
  /** 最近一轮的上下文占用 token 数（FR-4.7 状态栏显示占用百分比用） */
  contextTokens: number;
  contextWindow: number | null;
  steerCount: number;
  sessions: SessionMeta[];
  pendingPermissions: Extract<UiAgentEvent, { type: "permission_request" }>[];
}

export function initialAgentUiState(): AgentUiState {
  return {
    status: "idle",
    messages: [],
    sessionId: null,
    error: null,
    usage: { input: 0, output: 0, cacheRead: 0, costTotal: 0 },
    contextTokens: 0,
    contextWindow: null,
    steerCount: 0,
    sessions: [],
    pendingPermissions: [],
  };
}

export function applyAgentEvent(state: AgentUiState, event: UiAgentEvent): AgentUiState {
  switch (event.type) {
    case "status":
      return {
        ...state,
        status: event.status,
        pendingPermissions: event.status === "waiting_approval" ? state.pendingPermissions : [],
      };
    case "sessions":
      return {
        ...state,
        sessions: event.sessions,
        sessionId: event.activeSessionId ?? state.sessionId,
      };
    case "usage":
      return {
        ...state,
        usage: { ...event.tokens, costTotal: event.costTotal },
        contextTokens: event.contextTokens,
        contextWindow: event.contextWindow,
      };
    case "queue":
      return { ...state, steerCount: event.steerCount };
    case "permission_request":
      return { ...state, pendingPermissions: [...state.pendingPermissions, event] };
    case "error":
      return { ...state, error: event.message };
    default: {
      const messages = applyMessageEvent(state.messages, event);
      return messages === state.messages ? state : { ...state, messages };
    }
  }
}
