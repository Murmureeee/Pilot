// @env browser
import { create } from "zustand";
import { applyAgentEvent, initialAgentUiState, type AgentUiState } from "../adapters/agent-events";
import { currentLocale } from "../lib/i18n";
import { initialNavState, moveNav, peekNav, pushNav, type NavState } from "../lib/nav";
import type { SettingsSection } from "../lib/types";
import type {
  ApprovalMode,
  LogLevel,
  MenuAction,
  PermissionDecision,
  PublicSettings,
  SettingsInput,
  SkillMeta,
  ThinkingLevel,
  ToolRule,
  UiAgentEvent,
} from "@shared/contract";

type View = "chat" | "settings";

interface AgentStore extends AgentUiState {
  settings: PublicSettings | null;
  view: View;
  /** 设置页当前分区（侧栏导航与设置内容共用） */
  settingsSection: SettingsSection;
  /** 技能列表（设置页「技能」分区；主进程扫描结果） */
  skills: SkillMeta[];
  initialized: boolean;
  paletteOpen: boolean;
  nav: NavState;
  /** 当前模型的上下文窗口（未知 = null，状态栏不显示占用） */
  contextWindow: number | null;
  setPaletteOpen(open: boolean): void;
  setSettingsSection(section: SettingsSection): void;
  /** 技能列表刷新（进设置页时拉取） */
  listSkills(): Promise<void>;
  /** 导入技能目录（主进程弹目录选择框；取消 = null 不更新） */
  importSkills(): Promise<void>;
  /** 启停技能（下一轮请求生效） */
  toggleSkill(id: string, enabled: boolean): Promise<void>;
  /** 保存全局人设/自定义指令（"" = 清空） */
  savePersona(text: string): Promise<void>;
  /** 会话级人设覆盖（null = 清除回落全局） */
  setSessionPersona(id: string, persona: string | null): Promise<void>;
  init(): Promise<void>;
  setView(view: View): void;
  prompt(text: string, referenceDirectory?: string): Promise<void>;
  abort(): void;
  newSession(): Promise<void>;
  /** record=false 用于前进/后退（不重复入栈） */
  loadSession(id: string, record?: boolean): Promise<void>;
  /** 手动重命名会话（titleCustom 保护，自动标题不再覆盖） */
  renameSession(id: string, title: string): Promise<void>;
  /** 置顶/取消置顶（侧栏「置顶」分区） */
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
  saveToolEnvironment(
    input: Pick<SettingsInput, "workingDirectory" | "commandShell">,
  ): Promise<void>;
  respondPermission(requestId: string, decision: PermissionDecision): void;
  menuAction(action: MenuAction): Promise<void>;
  /** 清空排队中的插话 */
  clearQueue(): void;
  setApprovalMode(mode: ApprovalMode): Promise<void>;
  setThinkingLevel(level: ThinkingLevel): Promise<void>;
  switchModel(providerId: string): Promise<void>;
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
      models,
    })),
    activeProviderId: settings.activeProviderId,
  };
}

function applySnapshotExtras(
  snapshot: Awaited<ReturnType<typeof window.pi.getSnapshot>>,
): Pick<AgentStore, "usage" | "contextTokens" | "contextWindow" | "steerCount"> {
  return {
    usage: snapshot.usage,
    contextTokens: snapshot.contextTokens,
    contextWindow: snapshot.contextWindow,
    steerCount: snapshot.steerCount,
  };
}

export const useAgentStore = create<AgentStore>((set, get) => ({
  ...initialAgentUiState(),
  settings: null,
  view: "chat",
  settingsSection: "general",
  skills: [],
  initialized: false,
  paletteOpen: false,
  nav: initialNavState(),
  contextWindow: null,

  setPaletteOpen: (open) => set({ paletteOpen: open }),
  setSettingsSection: (section) => set({ settingsSection: section }),

  listSkills: async () => {
    const skills = await window.pi.skillsList();
    set({ skills });
  },

  importSkills: async () => {
    const skills = await window.pi.skillsImport(currentLocale());
    if (skills !== null) set({ skills });
  },

  toggleSkill: async (id, enabled) => {
    const skills = await window.pi.skillsToggle(id, enabled);
    // 启停状态持久化在 settings.skillsEnabled，一并刷新
    const settings = await window.pi.settingsGet();
    set({ skills, settings });
  },

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
        const next = applyAgentEvent(state, event);
        return event.type === "sessions" && next.sessionId && next.sessionId !== state.sessionId
          ? { ...next, nav: pushNav(state.nav, next.sessionId) }
          : next;
      });
    });
    const snapshot = await window.pi.getSnapshot();
    set({
      messages: snapshot.messages,
      status: snapshot.status,
      sessionId: snapshot.sessionId,
      sessions: snapshot.sessions,
      settings: snapshot.settings,
      nav: snapshot.sessionId ? pushNav(get().nav, snapshot.sessionId) : get().nav,
      ...applySnapshotExtras(snapshot),
    });
  },

  setView: (view) => set({ view }),

  prompt: async (text, referenceDirectory) => {
    set({ error: null });
    await window.pi.agentPrompt(text, referenceDirectory);
  },

  abort: () => window.pi.agentAbort(),

  newSession: async () => {
    const snapshot = await window.pi.sessionNew();
    set({
      messages: snapshot.messages,
      status: snapshot.status,
      sessionId: snapshot.sessionId,
      sessions: snapshot.sessions,
      error: null,
      ...applySnapshotExtras(snapshot),
    });
  },

  loadSession: async (id, record = true) => {
    const snapshot = await window.pi.sessionLoad(id);
    set({
      messages: snapshot.messages,
      status: snapshot.status,
      sessionId: snapshot.sessionId,
      sessions: snapshot.sessions,
      error: null,
      nav: record ? pushNav(get().nav, id) : get().nav,
      ...applySnapshotExtras(snapshot),
    });
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
    const snapshot = await window.pi.sessionArchive(id, archived);
    const { nav } = get();
    set({
      messages: snapshot.messages,
      status: snapshot.status,
      sessionId: snapshot.sessionId,
      sessions: snapshot.sessions,
      error: null,
      nav: snapshot.sessionId ? nav : initialNavState(),
      ...applySnapshotExtras(snapshot),
    });
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
    const text = await window.pi.sessionCopy(id);
    if (text.length > 0) await navigator.clipboard.writeText(text);
  },

  deleteSession: async (id) => {
    const snapshot = await window.pi.sessionDelete(id);
    const { nav } = get();
    set({
      messages: snapshot.messages,
      status: snapshot.status,
      sessionId: snapshot.sessionId,
      sessions: snapshot.sessions,
      error: null,
      // 当前会话被删除 → 前进/后退栈里指向它的历史一并失效（导航重置）
      nav: snapshot.sessionId ? nav : initialNavState(),
      ...applySnapshotExtras(snapshot),
    });
  },

  clearQueue: () => window.pi.clearQueue(),

  saveSettings: async (input) => {
    const settings = await window.pi.settingsSave(input);
    set({ settings, view: "chat" });
  },

  setLogLevel: async (logLevel) => {
    await window.pi.settingsSetLogLevel(logLevel);
    set(({ settings }) => (settings ? { settings: { ...settings, logLevel } } : {}));
  },

  saveToolEnvironment: async (input) => {
    const current = get().settings;
    if (!current) return;
    const settings = await window.pi.settingsSave({ ...providerSelection(current), ...input });
    set({ settings });
  },

  respondPermission: (requestId, decision) => {
    set({ pendingPermission: null });
    void window.pi
      .permissionRespond(requestId, decision)
      .then(async () => {
        if (decision !== "global") return;
        const { toolRules } = await window.pi.settingsGet();
        set(({ settings }) => (settings ? { settings: { ...settings, toolRules } } : {}));
      })
      .catch((cause: unknown) =>
        set({ error: cause instanceof Error ? cause.message : String(cause) }),
      );
  },

  menuAction: (action) => window.pi.menuAction(action),

  /** composer 权限徽章切换；providers 原样回传（key 由主进程保留） */
  setApprovalMode: async (mode) => {
    const s = get().settings;
    if (!s) return;
    const settings = await window.pi.settingsSave({
      ...providerSelection(s),
      approvalMode: mode,
    });
    set({ settings });
  },

  /** composer 模型快速切换：切换 active provider（下次 prompt 生效） */
  switchModel: async (providerId) => {
    const s = get().settings;
    if (!s) return;
    const settings = await window.pi.settingsSave({
      ...providerSelection(s),
      activeProviderId: providerId,
    });
    set({ settings });
  },

  /** 思考强度滑块：持久化 + 主进程同步到当前 Agent（下一轮请求生效） */
  setThinkingLevel: async (level) => {
    const settings = await window.pi.settingsSetThinkingLevel(level);
    set({ settings });
  },

  /** 设置页撤销授权规则（FR-5.4）：按 toolName+pathPrefix 匹配后整表提交 */
  removeToolRule: async (rule) => {
    const s = get().settings;
    if (!s) return;
    const settings = await window.pi.settingsSave({
      ...providerSelection(s),
      toolRules: (s.toolRules ?? []).filter(
        (r) => r.toolName !== rule.toolName || r.pathPrefix !== rule.pathPrefix,
      ),
    });
    set({ settings });
  },
}));
