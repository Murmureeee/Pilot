// @env browser
// 事件 → UI 状态的纯函数 reducer（NFR-6：独立测试覆盖）。
import type {
  ActiveRun,
  AgentStatus,
  InterruptedRun,
  PermissionRequest,
  SessionMeta,
  UsageTotals,
  UiAgentEvent,
  UiMessage,
} from "@shared/contract";

import { applyMessageEvent } from "../../../shared/message-events";

export interface AgentUiState {
  status: AgentStatus;
  activeRun: ActiveRun | null;
  interruptedRun: InterruptedRun | null;
  messages: UiMessage[];
  sessionId: string | null;
  error: string | null;
  usage: UsageTotals & { costTotal: number };
  /** 最近一轮的上下文占用 token 数（FR-4.7 状态栏显示占用百分比用） */
  contextTokens: number;
  contextWindow: number | null;
  steerCount: number;
  sessions: SessionMeta[];
  recentProjects: string[];
  pendingPermissions: PermissionRequest[];
}

export function initialAgentUiState(): AgentUiState {
  return {
    status: "idle",
    activeRun: null,
    interruptedRun: null,
    messages: [],
    sessionId: null,
    error: null,
    usage: { input: 0, output: 0, cacheRead: 0, costTotal: 0 },
    contextTokens: 0,
    contextWindow: null,
    steerCount: 0,
    sessions: [],
    recentProjects: [],
    pendingPermissions: [],
  };
}

export function applyAgentEvent(state: AgentUiState, event: UiAgentEvent): AgentUiState {
  if (event.type === "run_started") {
    const belongsToSelection = event.run.sessionId === state.sessionId;
    return {
      ...state,
      activeRun: event.run,
      ...(belongsToSelection
        ? { status: event.run.status, error: null, interruptedRun: null }
        : {}),
    };
  }

  if ("run" in event) {
    const active = state.activeRun;
    if (active?.runId !== event.run.runId || active.sessionId !== event.run.sessionId) return state;
    const belongsToSelection = event.run.sessionId === state.sessionId;
    if (event.type === "status") {
      return {
        ...state,
        activeRun: event.status === "idle" ? null : { ...active, status: event.status },
        ...(belongsToSelection
          ? {
              status: event.status,
              interruptedRun: event.status === "idle" ? (event.interruptedRun ?? null) : null,
              pendingPermissions:
                event.status === "waiting_approval" ? state.pendingPermissions : [],
              steerCount: event.status === "idle" ? 0 : state.steerCount,
            }
          : {}),
      };
    }
    if (!belongsToSelection) return state;
  }

  switch (event.type) {
    case "verification_updated":
    case "snapshot":
      return state;
    case "sessions":
      return {
        ...state,
        sessions: event.sessions,
        recentProjects: event.recentProjects,
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
    case "permission_request": {
      const { run: _run, ...request } = event;
      return { ...state, pendingPermissions: [...state.pendingPermissions, request] };
    }
    case "permission_resolved":
      return {
        ...state,
        pendingPermissions: state.pendingPermissions.filter(
          ({ requestId }) => requestId !== event.requestId,
        ),
      };
    case "error":
      return { ...state, error: event.message };
    default: {
      if ("sessionId" in event && event.sessionId !== state.sessionId) return state;
      const messages = applyMessageEvent(state.messages, event);
      return messages === state.messages ? state : { ...state, messages };
    }
  }
}
