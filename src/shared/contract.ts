// @env all
// 双进程共用契约：通道名与数据类型。此文件只允许类型与常量，不得引入运行时依赖。
import type { LOG_LEVELS, SUPPORTED_LOCALES, THINKING_LEVELS } from "./constants";

export const IPC = {
  ping: "app:ping",
  runAgentSmoke: "agent:smoke-run",
  appInfo: "app:info",
  menuAction: "app:menu-action",
  appOpenPath: "app:open-path",
  appSetTitlebarTheme: "app:set-titlebar-theme",
  appGetUpdateStatus: "app:get-update-status",
  appCheckForUpdates: "app:check-for-updates",
  appInstallUpdate: "app:install-update",
  agentPrompt: "agent:prompt",
  agentSearchWorkspace: "agent:search-workspace",
  agentAbort: "agent:abort",
  agentClearQueue: "agent:clear-queue",
  agentGetSnapshot: "agent:get-snapshot",
  sessionNew: "session:new",
  sessionLoad: "session:load",
  sessionRename: "session:rename",
  sessionDelete: "session:delete",
  sessionPin: "session:pin",
  sessionArchive: "session:archive",
  sessionUnread: "session:unread",
  sessionFork: "session:fork",
  sessionCopy: "session:copy",
  sessionPersona: "session:persona",
  settingsModelCatalog: "settings:model-catalog",
  settingsTestProvider: "settings:test-provider",
  settingsPickWorkingDirectory: "settings:pick-working-directory",
  settingsPickImportDirectory: "settings:pick-import-directory",
  settingsPreviewExternalImport: "settings:preview-external-import",
  settingsImportExternal: "settings:import-external",
  settingsImportedPlugins: "settings:imported-plugins",
  settingsToggleImportedPlugin: "settings:toggle-imported-plugin",
  skillsList: "skills:list",
  skillsImport: "skills:import",
  skillsToggle: "skills:toggle",
  settingsGet: "settings:get",
  settingsSave: "settings:save",
  settingsSetLogLevel: "settings:set-log-level",
  settingsSelectModel: "settings:select-model",
  settingsSetThinkingLevel: "settings:set-thinking-level",
  settingsMcpList: "settings:mcp-list",
  settingsMcpSave: "settings:mcp-save",
  settingsMcpReconnect: "settings:mcp-reconnect",
  settingsMcpRemove: "settings:mcp-remove",
  toolPermissionRespond: "tool:permission-respond",
} as const;

export interface WorkspaceEntry {
  path: string;
  kind: "file" | "directory";
}

/** 数据目录（shell.openPath 的白名单目标，防止渲染层打开任意路径） */
export type OpenPathTarget = "settings" | "sessions" | "skills" | "logs";
export type LogLevel = (typeof LOG_LEVELS)[number];

/** 菜单可触发的窗口级动作（白名单在主进程校验） */
export type MenuAction =
  | "undo"
  | "redo"
  | "cut"
  | "copy"
  | "paste"
  | "delete"
  | "select-all"
  | "zoom-in"
  | "zoom-out"
  | "zoom-reset"
  | "reload"
  | "fullscreen"
  | "close"
  | "quit";

export interface AppInfo {
  version: string;
  isDev: boolean;
  isWindows: boolean;
  /** 设置目录与会话目录（设置页「数据」区展示 + 打开） */
  settingsDir: string;
  sessionsDir: string;
}

/** 主进程 → 渲染层的事件推送通道（webContents.send） */
export const AGENT_EVENT_CHANNEL = "agent:event";
export const UPDATE_STATUS_CHANNEL = "app:update-status";

export type UpdateStatus =
  | { state: "unavailable" | "idle" | "checking" | "current" | "error" }
  | { state: "downloading"; version: string; percent: number }
  | { state: "ready" | "installing"; version: string };

export interface PingRequest {
  payload: string;
}

export interface PingResponse {
  payload: string;
  receivedAt: number;
}

export interface AgentSmokeResult {
  nodeVersion: string;
  ok: boolean;
  /** 本轮出现过的全部事件类型（去重，按首现顺序） */
  eventTypes: string[];
  /** 流式增量拼出的助手回复全文 */
  replyText: string;
  error?: string;
}

// ---------------------------------------------------------------------------
// Phase 2：聊天 UI 状态契约（parts 结构 + 工具/权限/队列/用量）
// ---------------------------------------------------------------------------

type ToolState = "pending" | "running" | "success" | "error";

export const PLAN_STATUSES = ["pending", "in_progress", "completed"] as const;

export interface PlanStep {
  title: string;
  status: (typeof PLAN_STATUSES)[number];
}

export type UiPart =
  | { type: "text"; text: string }
  | { type: "thinking"; text: string }
  | { type: "plan"; steps: PlanStep[] }
  | {
      type: "tool";
      callId: string;
      toolName: string;
      label: string;
      state: ToolState;
      inputSummary?: string;
      output?: string;
      error?: string;
    };

export interface UiMessage {
  id: string;
  role: "user" | "assistant" | "system" | "toolResult";
  parts: UiPart[];
}

export type AgentStatus = "idle" | "streaming" | "waiting_approval";

export interface UsageTotals {
  input: number;
  output: number;
  cacheRead: number;
}

export type UiAgentEvent =
  | { type: "status"; status: AgentStatus }
  | { type: "messages"; messages: UiMessage[] }
  | { type: "user_message"; message: UiMessage }
  | { type: "assistant_start"; id: string }
  | { type: "assistant_delta"; id: string; delta: string }
  | { type: "assistant_end"; id: string }
  | { type: "thinking_start"; id: string }
  | { type: "thinking_delta"; id: string; delta: string }
  | { type: "plan"; steps: PlanStep[] }
  /** 会话元数据全量刷新（自动标题/重命名/删除后推动侧栏更新） */
  | { type: "sessions"; sessions: SessionMeta[]; activeSessionId?: string }
  | {
      type: "tool_start";
      callId: string;
      toolName: string;
      label: string;
      inputSummary: string;
    }
  | { type: "tool_update"; callId: string; output: string }
  | {
      type: "tool_end";
      callId: string;
      state: "success" | "error";
      output?: string;
      error?: string;
    }
  | {
      type: "usage";
      tokens: UsageTotals;
      costTotal: number;
      /** 最近一轮助手消息的上下文占用（input + cacheRead + cacheWrite + output） */
      contextTokens: number;
    }
  | { type: "queue"; steerCount: number }
  | {
      type: "permission_request";
      requestId: string;
      toolName: string;
      label: string;
      inputSummary: string;
      danger: boolean;
    }
  | { type: "error"; message: string };

export type PermissionDecision = "once" | "session" | "global" | "deny";

/** 工具权限规则：pathPrefix 仅对文件类工具生效，缺省 = 匹配该工具全部调用 */
export interface ToolRule {
  toolName: string;
  pathPrefix?: string;
}

export interface SessionMeta {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  /** 用户手动重命名后为 true：自动标题（首条用户消息）不再覆盖 */
  titleCustom?: boolean;
  /** 置顶：侧栏「置顶」分区（时间倒序在其内），悬浮按钮/右键菜单可切换 */
  pinned?: boolean;
  /** 归档：从主列表隐藏，进「已归档」分区，可取消归档恢复 */
  archived?: boolean;
  /** 未读：侧栏标题加粗显示，打开会话即清除 */
  unread?: boolean;
  /** 会话级人设/指令覆盖（空/缺省 = 用全局 persona），右键「会话指令…」编辑 */
  personaOverride?: string;
}

/** 主题（FR-5.5）：亮 / 暗 / 跟随系统；渲染层本地存储，切换时同步原生标题栏颜色 */
export type ThemeSetting = "light" | "dark" | "system";
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export type CommandShell = "powershell" | "bash";

export type ProviderKind = "anthropic" | "openai-compatible" | "openai-responses" | "faux";

/** 权限模式（composer 徽章切换）：standard = 读放行写确认；full-access = 全放行；read-only = 写类直接拒绝 */
export type ApprovalMode = "standard" | "full-access" | "read-only";

/** 模型思考强度（pi 的 7 档离散值，composer 滑块选择） */
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

/** 技能元数据（SKILL.md 解析结果；path/body 不出主进程） */
export interface SkillMeta {
  /** 技能 id = 技能目录名（userData/skills/<id>/SKILL.md） */
  id: string;
  name: string;
  description: string;
  /** 启用状态（持久化在 settings.skillsEnabled） */
  enabled: boolean;
}

/** 模型目录条目（FR-5.2 浏览弹窗用） */
export interface ModelCatalogEntry {
  id: string;
  name: string;
  contextWindow?: number;
}

/** Provider 连通性测试结果（FR-5.1） */
export interface ProviderTestResult {
  ok: boolean;
  error?: string;
  latencyMs: number;
}

export interface ProviderFields {
  id: string;
  kind: ProviderKind;
  name: string;
  baseUrl?: string;
  modelId: string;
  models?: ModelCatalogEntry[];
}

/** 渲染层可见形态：明文/密文 key 永不出主进程，只有 hasKey 标志 */
type PublicProvider = ProviderFields & { hasKey: boolean; models: ModelCatalogEntry[] };
export interface PublicSettings {
  providers: PublicProvider[];
  activeProviderId: string;
  toolRules?: ToolRule[];
  approvalMode: ApprovalMode;
  thinkingLevel: ThinkingLevel;
  thinkingLevels: ThinkingLevel[];
  workingDirectory: string | null;
  commandShell: CommandShell;
  logLevel: LogLevel;
  /** 全局人设/自定义指令（设置页「个性化」编辑） */
  persona: string;
  /** 启用的技能 id 列表 */
  skillsEnabled: string[];
}

/** 渲染层提交形态；apiKey 为明文（仅变更时携带），主进程负责加密落盘 */
export interface ProviderInput extends ProviderFields {
  apiKey?: string;
}
export interface SettingsInput {
  providers: ProviderInput[];
  activeProviderId: string;
  approvalMode?: ApprovalMode;
  thinkingLevel?: ThinkingLevel;
  thinkingLevels?: ThinkingLevel[];
  /** null 恢复主目录；缺省保留原设置 */
  workingDirectory?: string | null;
  commandShell?: CommandShell;
  /** 整表替换工具授权规则（设置页撤销入口）；缺省 = 保持不变 */
  toolRules?: ToolRule[];
  /** 全局人设/自定义指令（"" = 清空）；缺省 = 保持不变 */
  persona?: string;
  /** 启用技能 id 列表；缺省 = 保持不变 */
  skillsEnabled?: string[];
}

export interface Snapshot {
  sessionId: string | null;
  sessions: SessionMeta[];
  messages: UiMessage[];
  status: AgentStatus;
  settings: PublicSettings;
  usage: UsageTotals & { costTotal: number };
  /** 当前模型的上下文窗口大小（未知 = null，状态栏不显示占用） */
  contextWindow: number | null;
  /** 最近一轮的上下文占用 token 数 */
  contextTokens: number;
  steerCount: number;
}
