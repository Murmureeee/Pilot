// @env browser
import { create } from "zustand";

import type {
  ActiveRun,
  ApprovalMode,
  ComposerDraft,
  ExecutionApprovalMode,
  LogLevel,
  MenuAction,
  PermissionDecision,
  PlanMode,
  PromptInput,
  PublicSettings,
  RunRef,
  SessionMeta,
  SessionSettingsInput,
  SettingsInput,
  Snapshot,
  ThinkingLevel,
  ToolRule,
  UiAgentEvent,
} from "@shared/contract";
import { modelCatalogInput } from "@shared/providers";

import { applyAgentEvent, initialAgentUiState, type AgentUiState } from "../adapters/agent-events";
import { showFeedback, showFeedbackError } from "../lib/feedback";
import { currentLocale } from "../lib/i18n";
import { initialNavState, moveNav, peekNav, pushNav, type NavState } from "../lib/nav";
import type { ProjectSelection, SettingsSection } from "../lib/types";

type View = "chat" | "settings";

interface AgentStore extends AgentUiState {
  settings: PublicSettings | null;
  composerId: string | null;
  composerDraft: ComposerDraft;
  draftWorkingDirectory: string | null;
  choosingProject: boolean;
  projectError: string | null;
  view: View;
  /** 设置页当前分区（侧栏导航与设置内容共用） */
  settingsSection: SettingsSection;
  initialized: boolean;
  paletteOpen: boolean;
  nav: NavState;
  setPaletteOpen(open: boolean): void;
  setSettingsSection(section: SettingsSection): void;
  /** 保存全局人设/自定义指令（"" = 清空） */
  savePersona(text: string): Promise<void>;
  /** 会话级人设覆盖（null = 清除回落全局） */
  setSessionPersona(id: string, persona: string | null): Promise<void>;
  init(): Promise<void>;
  setView(view: View): void;
  revealRequest: number;
  prompt(
    input: PromptInput,
    workingDirectory: string | null,
    composerId: string,
  ): Promise<boolean | ActiveRun>;
  resumeRun(run: RunRef, compact?: boolean): Promise<void>;
  compactContext(composerId: string): Promise<void>;
  saveDraft(composerId: string, draft: ComposerDraft): Promise<void>;
  updateSessionSettings(input: SessionSettingsInput): Promise<void>;
  abort(run: RunRef): void;
  newSession(): Promise<void>;
  selectProject(selection?: ProjectSelection): Promise<void>;
  /** record=false 用于前进/后退（不重复入栈） */
  loadSession(id: string, record?: boolean): Promise<void>;
  /** 手动重命名会话（titleCustom 保护，自动标题不再覆盖） */
  renameSession(id: string, title: string): Promise<void>;
  /** 置顶/取消置顶（在当前项目分组内） */
  setSessionPinned(id: string, pinned: boolean): Promise<void>;
  /** 归档/取消归档（归档当前会话回草稿态） */
  setSessionArchived(id: string, archived: boolean): Promise<void>;
  /** 标记/清除未读（打开会话时主进程自动清除） */
  setSessionUnread(id: string, unread: boolean): Promise<void>;
  /** 分叉：复制转录为新会话 */
  forkSession(id: string): Promise<void>;
  /** 会话全文复制到剪贴板 */
  copySession(id: string): Promise<void>;
  /** 删除会话；删除当前会话时回到草稿态 */
  deleteSession(id: string): Promise<void>;
  navBack(): Promise<void>;
  navForward(): Promise<void>;
  saveSettings(input: SettingsInput): Promise<void>;
  setLogLevel(level: LogLevel): Promise<void>;
  setNotificationsEnabled(enabled: boolean): Promise<void>;
  dismissSettingsRecovery(): Promise<void>;
  retrySettingsRecovery(): Promise<void>;
  saveToolEnvironment(
    input: Pick<SettingsInput, "workingDirectory" | "commandShell">,
  ): Promise<void>;
  respondPermission(run: RunRef, requestId: string, decision: PermissionDecision): Promise<void>;
  menuAction(action: MenuAction): Promise<void>;
  /** 清空排队中的插话 */
  clearQueue(run: RunRef): void;
  setDefaultApprovalMode(mode: ExecutionApprovalMode): Promise<void>;
  setThinkingLevel(level: ThinkingLevel): Promise<void>;
  removeToolRule(rule: ToolRule): Promise<void>;
}

function providerSelection(
  settings: PublicSettings,
): Pick<SettingsInput, "providers" | "activeProviderId"> {
  return {
    providers: settings.providers.map(({ id, kind, name, baseUrl, modelId, models }) => ({
      id,
      kind,
      name,
      baseUrl,
      modelId,
      models: modelCatalogInput(models),
    })),
    activeProviderId: settings.activeProviderId,
  };
}

export function selectActiveSession(
  state: Pick<AgentStore, "sessionId" | "sessions">,
): SessionMeta | undefined {
  return state.sessions.find(({ id }) => id === state.sessionId);
}

export function selectApprovalMode(
  state: Pick<AgentStore, "sessionId" | "sessions" | "settings">,
): ApprovalMode {
  const session = selectActiveSession(state);
  if (session?.planMode) return "plan";
  return session?.approvalMode ?? state.settings?.approvalMode ?? "standard";
}

export function selectPlanReview(
  state: Pick<AgentStore, "sessionId" | "sessions" | "status" | "failedRun" | "interruptedRun">,
): PlanMode | undefined {
  if (state.status !== "idle" || state.failedRun || state.interruptedRun) return undefined;
  const planMode = selectActiveSession(state)?.planMode;
  return planMode?.proposal ? planMode : undefined;
}

export function selectCanChangeApprovalMode(state: AgentStore): boolean {
  const planning = state.activeRun?.sessionId === state.sessionId && state.activeRun.planning;
  return !planning && !selectPlanReview(state);
}

export function selectProjectDirectory(
  state: Pick<AgentStore, "sessionId" | "draftWorkingDirectory" | "sessions">,
): string | null {
  if (state.sessionId) {
    return selectActiveSession(state)?.workingDirectory ?? null;
  }
  return state.draftWorkingDirectory;
}

export function selectWorkingDirectory(
  state: Pick<
    AgentStore,
    | "sessionId"
    | "draftWorkingDirectory"
    | "sessions"
    | "settings"
    | "activeRun"
    | "interruptedRun"
    | "failedRun"
  >,
): string | null {
  if (state.activeRun?.sessionId === state.sessionId) return state.activeRun.workingDirectory;
  if (state.interruptedRun?.sessionId === state.sessionId)
    return state.interruptedRun.workingDirectory;
  if (state.failedRun?.sessionId === state.sessionId) return state.failedRun.workingDirectory;
  return selectProjectDirectory(state) ?? state.settings?.workingDirectory ?? null;
}

function sessionSnapshot(
  snapshot: Snapshot,
  current: Pick<AgentStore, "composerId" | "composerDraft">,
): AgentUiState &
  Pick<AgentStore, "draftWorkingDirectory" | "composerId" | "composerDraft" | "settings"> {
  return {
    sessionId: snapshot.sessionId,
    composerId: snapshot.composerId,
    composerDraft:
      snapshot.composerId === current.composerId ? current.composerDraft : snapshot.composerDraft,
    draftWorkingDirectory: snapshot.draftWorkingDirectory,
    sessions: snapshot.sessions,
    recentProjects: snapshot.recentProjects,
    messages: snapshot.messages,
    status: snapshot.status,
    activeRun: snapshot.activeRun,
    interruptedRun: snapshot.interruptedRun,
    failedRun: snapshot.failedRun,
    settings: snapshot.settings,
    error: snapshot.error,
    usage: snapshot.usage,
    contextTokens: snapshot.contextTokens,
    contextWindow: snapshot.contextWindow,
    steerCount: snapshot.steerCount,
    pendingPermissions: snapshot.pendingPermissions,
  };
}

export const useAgentStore = create<AgentStore>((set, get) => ({
  ...initialAgentUiState(),
  settings: null,
  composerId: null,
  composerDraft: [],
  draftWorkingDirectory: null,
  choosingProject: false,
  projectError: null,
  view: "chat",
  settingsSection: "general",
  initialized: false,
  paletteOpen: false,
  revealRequest: 0,
  nav: initialNavState(),

  setPaletteOpen: (open) => set({ paletteOpen: open }),
  setSettingsSection: (section) => set({ settingsSection: section }),

  savePersona: async (text) => {
    const s = get().settings;
    if (!s) return;
    const settings = await window.pi.settingsSave({
      ...providerSelection(s),
      persona: text,
    });
    set({ settings });
  },

  setSessionPersona: async (id, persona) => {
    await window.pi.sessionPersona(id, persona);
  },

  init: async () => {
    if (get().initialized) return;
    set({ initialized: true });
    window.pi.onAgentEvent((event: UiAgentEvent) => {
      set((state) => {
        if (event.type === "snapshot") {
          const { snapshot, navigation } = event;
          let nav = state.nav;
          if (navigation === "reset") nav = initialNavState();
          if (
            snapshot.sessionId &&
            (navigation === "record" || navigation === "reveal" || state.composerId === null)
          ) {
            nav = pushNav(nav, snapshot.sessionId);
          }
          return {
            ...sessionSnapshot(snapshot, state),
            nav,
            projectError: null,
            ...(navigation === "reveal"
              ? { view: "chat", paletteOpen: false, revealRequest: state.revealRequest + 1 }
              : {}),
          };
        }
        const next = applyAgentEvent(state, event);
        return event.type === "sessions" && next.sessionId && next.sessionId !== state.sessionId
          ? { ...next, nav: pushNav(state.nav, next.sessionId) }
          : next;
      });
    });
    await window.pi.getSnapshot();
  },

  setView: (view) => set({ view }),

  prompt: async (input, workingDirectory, composerId) => {
    const { composerDraft } = get();
    const blockedBy = await window.pi.agentPrompt(input, workingDirectory, composerId);
    if (blockedBy) return blockedBy;
    if (get().composerId !== composerId || get().composerDraft !== composerDraft) return false;
    set({ composerDraft: [] });
    return true;
  },

  resumeRun: async ({ sessionId, runId }, compact) => {
    try {
      await window.pi.agentResume({ sessionId, runId }, compact);
    } catch (cause) {
      const { interruptedRun, failedRun } = get();
      if (interruptedRun?.runId === runId || failedRun?.runId === runId) {
        set({ error: cause instanceof Error ? cause.message : String(cause) });
      }
    }
  },

  compactContext: async (composerId) => {
    try {
      await window.pi.agentCompact(composerId);
    } catch (cause) {
      if (get().composerId === composerId)
        set({ error: cause instanceof Error ? cause.message : String(cause) });
    }
  },

  saveDraft: async (composerId, draft) => {
    if (get().composerId !== composerId) return;
    set({ composerDraft: draft });
    await window.pi.sessionSaveDraft(composerId, draft);
  },

  updateSessionSettings: async (input) => {
    const { composerId } = get();
    if (composerId) await window.pi.sessionUpdateSettings(composerId, input);
  },

  abort: ({ runId, sessionId }) => void window.pi.agentAbort({ runId, sessionId }),

  newSession: async () => {
    await window.pi.sessionNew();
  },

  selectProject: async ({ sessionId, directory } = {}) => {
    if (get().choosingProject) return;
    set({ choosingProject: true, projectError: null });
    try {
      const snapshot = directory
        ? await window.pi.sessionUseRecentProject(directory, sessionId)
        : await window.pi.sessionSelectProject(currentLocale(), sessionId);
      if (!snapshot) return;
      set({ view: "chat" });
    } catch (error) {
      set({ view: "chat", projectError: error instanceof Error ? error.message : String(error) });
    } finally {
      set({ choosingProject: false });
    }
  },

  loadSession: async (id, record = true) => {
    await window.pi.sessionLoad(id, record);
  },

  navBack: async () => {
    const { nav } = get();
    const id = peekNav(nav, "back");
    if (!id) return;
    set({ nav: moveNav(nav, "back") });
    await get().loadSession(id, false);
  },

  navForward: async () => {
    const { nav } = get();
    const id = peekNav(nav, "forward");
    if (!id) return;
    set({ nav: moveNav(nav, "forward") });
    await get().loadSession(id, false);
  },

  renameSession: async (id, title) => {
    const sessions = await window.pi.sessionRename(id, title);
    set({ sessions });
  },

  setSessionPinned: async (id, pinned) => {
    const sessions = await window.pi.sessionPin(id, pinned);
    set({ sessions });
  },

  setSessionArchived: async (id, archived) => {
    try {
      await window.pi.sessionArchive(id, archived);
      showFeedback(archived ? "聊天已归档" : "聊天已恢复");
    } catch (error) {
      showFeedbackError("无法更新归档状态。请重试。", error);
    }
  },

  setSessionUnread: async (id, unread) => {
    const sessions = await window.pi.sessionUnread(id, unread);
    set({ sessions });
  },

  forkSession: async (id) => {
    const sessions = await window.pi.sessionFork(id);
    set({ sessions });
  },

  /** 会话全文复制到剪贴板（侧栏右键「复制」） */
  copySession: async (id) => {
    try {
      const text = await window.pi.sessionCopy(id);
      if (!text) return;
      await navigator.clipboard.writeText(text);
      showFeedback("已复制聊天全文");
    } catch (error) {
      showFeedbackError("无法复制聊天。请重试。", error);
    }
  },

  deleteSession: async (id) => {
    await window.pi.sessionDelete(id);
  },

  clearQueue: ({ runId, sessionId }) => void window.pi.clearQueue({ runId, sessionId }),

  saveSettings: async (input) => {
    const settings = await window.pi.settingsSave(input);
    set({ settings });
  },

  setLogLevel: async (logLevel) => {
    await window.pi.settingsSetLogLevel(logLevel);
    set(({ settings }) => (settings ? { settings: { ...settings, logLevel } } : {}));
  },
  setNotificationsEnabled: async (notificationsEnabled) => {
    await window.pi.settingsSetNotificationsEnabled(notificationsEnabled);
    set(({ settings }) => (settings ? { settings: { ...settings, notificationsEnabled } } : {}));
  },

  dismissSettingsRecovery: async () => {
    const settings = await window.pi.settingsDismissRecovery();
    set({ settings });
  },

  retrySettingsRecovery: async () => {
    const settings = await window.pi.settingsGet();
    set({ settings });
  },

  saveToolEnvironment: async (input) => {
    const current = get().settings;
    if (!current) return;
    const settings = await window.pi.settingsSave({ ...providerSelection(current), ...input });
    set({ settings });
  },

  respondPermission: async ({ runId, sessionId }, requestId, decision) => {
    if (get().pendingPermissions[0]?.requestId !== requestId) return;
    await window.pi.permissionRespond({ runId, sessionId }, requestId, decision);
    if (decision === "global") {
      try {
        const { toolRules } = await window.pi.settingsGet();
        set(({ settings }) => (settings ? { settings: { ...settings, toolRules } } : {}));
      } catch (cause) {
        set({ error: cause instanceof Error ? cause.message : String(cause) });
      }
    }
  },

  menuAction: (action) => window.pi.menuAction(action),

  setDefaultApprovalMode: async (mode) => {
    const s = get().settings;
    if (!s) return;
    const settings = await window.pi.settingsSave({
      ...providerSelection(s),
      approvalMode: mode,
    });
    set({ settings });
  },

  /** 思考强度滑块：持久化 + 主进程同步到当前 Agent（下一轮请求生效） */
  setThinkingLevel: async (level) => {
    const settings = await window.pi.settingsSetThinkingLevel(level);
    set({ settings });
  },

  removeToolRule: async (rule) => {
    const settings = await window.pi.settingsRevokeToolRule(rule);
    set({ settings });
  },
}));
