// @env all
// 双进程共用契约：通道名与数据类型。此文件只允许类型与常量，不得引入运行时依赖。
import type { LOG_LEVELS, SUPPORTED_LOCALES, THINKING_LEVELS } from "./constants";

export const IPC = {
  ping: "app:ping",
  runAgentSmoke: "agent:smoke-run",
  appInfo: "app:info",
  menuAction: "app:menu-action",
  appOpenPath: "app:open-path",
  appSetLocale: "app:set-locale",
  appSetTitlebarTheme: "app:set-titlebar-theme",
  appGetUpdateStatus: "app:get-update-status",
  appCheckForUpdates: "app:check-for-updates",
  appInstallUpdate: "app:install-update",
  agentPrompt: "agent:prompt",
  agentResume: "agent:resume",
  agentCompact: "agent:compact",
  agentSearchWorkspace: "agent:search-workspace",
  agentPreviewWorkspaceReference: "agent:preview-workspace-reference",
  agentAbort: "agent:abort",
  agentClearQueue: "agent:clear-queue",
  agentGetSnapshot: "agent:get-snapshot",
  sessionNew: "session:new",
  sessionSaveDraft: "session:save-draft",
  sessionUpdateSettings: "session:update-settings",
  sessionSelectProject: "session:select-project",
  sessionUseRecentProject: "session:use-recent-project",
  sessionOpenProjectFolder: "session:open-project-folder",
  sessionRemoveRecentProject: "session:remove-recent-project",
  sessionGitHead: "session:git-head",
  sessionGitChanges: "session:git-changes",
  sessionGitDiff: "session:git-diff",
  sessionStageGit: "session:stage-git",
  sessionPreviewGitCommit: "session:preview-git-commit",
  sessionCommitGit: "session:commit-git",
  sessionGitCheckpointDiff: "session:git-checkpoint-diff",
  sessionPreviewGitRollback: "session:preview-git-rollback",
  sessionApplyGitRollback: "session:apply-git-rollback",
  sessionOpenGitLine: "session:open-git-line",
  sessionLoad: "session:load",
  sessionRename: "session:rename",
  sessionDelete: "session:delete",
  sessionPin: "session:pin",
  sessionArchive: "session:archive",
  sessionUnread: "session:unread",
  sessionFork: "session:fork",
  sessionCopy: "session:copy",
  sessionPersona: "session:persona",
  sessionInstructionSources: "session:instruction-sources",
  sessionFileDiff: "session:file-diff",
  sessionUndoFileChange: "session:undo-file-change",
  sessionVerification: "session:verification",
  sessionVerificationRun: "session:verification-run",
  sessionStartVerification: "session:start-verification",
  sessionStopVerification: "session:stop-verification",
  sessionRerunVerification: "session:rerun-verification",
  settingsModelCatalog: "settings:model-catalog",
  settingsTestProvider: "settings:test-provider",
  settingsPickWorkingDirectory: "settings:pick-working-directory",
  settingsPickImportDirectory: "settings:pick-import-directory",
  settingsPreviewExternalImport: "settings:preview-external-import",
  settingsImportExternal: "settings:import-external",
  settingsImportedPlugins: "settings:imported-plugins",
  settingsToggleImportedPlugin: "settings:toggle-imported-plugin",
  skillsList: "skills:list",
  skillsRead: "skills:read",
  skillsDelete: "skills:delete",
  skillsImport: "skills:import",
  skillsToggle: "skills:toggle",
  settingsGet: "settings:get",
  settingsSave: "settings:save",
  settingsSetLogLevel: "settings:set-log-level",
  settingsSelectModel: "settings:select-model",
  settingsSetThinkingLevel: "settings:set-thinking-level",
  settingsRevokeToolRule: "settings:revoke-tool-rule",
  settingsDismissRecovery: "settings:dismiss-recovery",
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

export interface WorkspaceReferenceRequest {
  path: string;
  workingDirectory?: string;
}

export type WorkspaceReferencePreview =
  | { kind: "file"; path: string; text: string | null }
  | { kind: "directory"; path: string; entries: WorkspaceEntry[]; truncated: boolean };

export type PromptMention =
  | { type: WorkspaceEntry["kind"]; id: string; label: string; meta: { workingDirectory: string } }
  | {
      type: "skill";
      id: string;
      label: string;
      meta: { description: string; workingDirectory?: string };
    };

export type ComposerDraft = (string | PromptMention)[];

export interface PromptInput {
  text: string;
  mentions: (PromptMention & { offset?: number })[];
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

export type FileChangeSummary = {
  id: string;
  path: string;
  kind: "created" | "modified";
  stats?: { added: number; removed: number };
  reverted?: boolean;
};

export type FileDiffLine = {
  kind: "context" | "added" | "removed";
  text: string;
  before?: number;
  after?: number;
  noNewline?: boolean;
};

export type FileDiff = {
  hunks: FileDiffLine[][];
  truncated: boolean;
};

interface ToolInvocation {
  callId: string;
  toolName: string;
  label: string;
  inputSummary?: string;
}

export type UiUserPart =
  | { type: "text"; text: string }
  | {
      type: "mention";
      kind: PromptMention["type"];
      id: string;
      label: string;
      workingDirectory?: string;
    };

export type UiPart =
  | { type: "compaction"; compaction: ContextCompaction }
  | UiUserPart
  | {
      type: "thinking";
      text: string;
      blockIndex?: number;
      streaming?: boolean;
      durationMs?: number;
    }
  | { type: "plan"; steps: PlanStep[] }
  | (ToolInvocation & {
      type: "tool";
      state: ToolState;
      output?: string;
      error?: string;
      durationMs?: number;
      fileChange?: FileChangeSummary;
    });

export interface UiMessage {
  id: string;
  role: "user" | "assistant" | "system" | "toolResult";
  parts: UiPart[];
  streaming?: boolean;
}

export type AgentStatus = "idle" | "streaming" | "waiting_approval" | "stopping";

export interface RunRef {
  runId: string;
  sessionId: string;
}

export interface ActiveRun extends RunRef {
  status: Exclude<AgentStatus, "idle">;
  workingDirectory: string | null;
  retry?: ModelRetryProgress;
  modelCapabilities?: ModelCapabilities;
  compacting?: boolean;
}

export interface ContextCompaction {
  id: string;
  position: number;
  summary: string;
  trimmedTools: number;
}

export interface InterruptedRun extends RunRef {
  workingDirectory: string | null;
}

export interface ModelRetryProgress {
  attempt: number;
  maxAttempts: number;
  retryAt: number | null;
}

export interface ModelFailure {
  kind:
    | "network"
    | "rate-limit"
    | "server"
    | "credentials"
    | "quota"
    | "capability"
    | "context-limit"
    | "other";
  detail: string;
}

export interface FailedRun extends RunRef {
  workingDirectory: string | null;
  failure: ModelFailure;
}

export type CommandDanger =
  | "git-force-push"
  | "git-hard-reset"
  | "git-clean"
  | "git-checkout-files"
  | "git-dynamic"
  | "download-and-execute"
  | "disk-operation"
  | "recursive-delete-outside-project"
  | "forced-delete"
  | "system-operation";

export interface PermissionRequest {
  type: "permission_request";
  requestId: string;
  toolName: string;
  label: string;
  inputSummary: string;
  danger: boolean;
  commandDanger?: CommandDanger;
  workingDirectory?: string;
  command?: string;
  rule?: ToolRule;
}

export interface UsageTotals {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export type AgentRunEvent =
  | { type: "status"; status: AgentStatus; interruptedRun?: InterruptedRun; failedRun?: FailedRun }
  | { type: "model_retry"; retry: ModelRetryProgress | null; resetReplyId?: string }
  | { type: "context_compacting"; compacting: boolean }
  | { type: "context_compacted"; compaction: ContextCompaction; contextTokens: number }
  | { type: "messages"; messages: UiMessage[] }
  | { type: "user_message"; message: UiMessage }
  | { type: "assistant_start"; id: string }
  | { type: "assistant_delta"; id: string; delta: string }
  | { type: "assistant_end"; id: string }
  | { type: "thinking_start"; id: string; blockIndex: number }
  | { type: "thinking_delta"; id: string; blockIndex: number; delta: string }
  | { type: "thinking_end"; id: string; blockIndex: number; text: string; durationMs?: number }
  | { type: "plan"; steps: PlanStep[] }
  | (ToolInvocation & { type: "tool_call" | "tool_start"; id?: string })
  | { type: "tool_update"; callId: string; output: string }
  | {
      type: "tool_end";
      callId: string;
      state: "success" | "error";
      output?: string;
      error?: string;
      durationMs?: number;
    }
  | { type: "file_change"; callId: string; change: FileChangeSummary }
  | {
      type: "usage";
      tokens: UsageTotals;
      costTotal: number;
      /** 最近一轮助手消息的上下文占用（input + cacheRead + cacheWrite + output） */
      contextTokens: number;
      contextWindow: number | null;
    }
  | { type: "queue"; steerCount: number }
  | PermissionRequest
  | { type: "permission_resolved"; requestId: string }
  | { type: "error"; message: string };

export type UiAgentEvent =
  | { type: "snapshot"; snapshot: Snapshot; navigation?: "record" | "reset" }
  | {
      type: "sessions";
      sessions: SessionMeta[];
      recentProjects: string[];
      activeSessionId?: string;
    }
  | { type: "run_started"; run: ActiveRun }
  | { type: "verification_updated"; result: VerificationResult }
  | (AgentRunEvent & { run: RunRef })
  | (Extract<AgentRunEvent, { type: "file_change" }> & { sessionId: string });

export type PermissionDecision = "once" | "session" | "global" | "deny";

export interface CommandPrefix {
  shell: CommandShell;
  args: string[];
}

/** 旧命令规则缺少 commandPrefix，保留在设置中供撤销。 */
export interface ToolRule {
  toolName: string;
  pathPrefix?: string;
  commandPrefix?: CommandPrefix;
}

export interface SessionModelSelection {
  providerId: string;
  modelId: string;
}

export interface SessionSettings {
  model?: SessionModelSelection;
  approvalMode?: ApprovalMode;
}

export interface SessionSettingsInput {
  model?: SessionModelSelection | null;
  approvalMode?: ApprovalMode | null;
}

export type ProjectInstructionSource =
  | { status: "unlinked" }
  | { status: "loaded" | "missing" | "empty" | "unavailable"; path: string };

export interface SessionInstructionSources {
  project: ProjectInstructionSource;
  personalization: "session" | "global" | null;
  enabledSkills: string[];
  running: boolean;
}

export const SESSION_RUN_RESULTS = ["success", "failed", "stopped", "interrupted"] as const;
export type SessionRunResult = (typeof SESSION_RUN_RESULTS)[number];

export interface SessionMeta extends SessionSettings {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  workingDirectory?: string;
  lastTask?: VerificationTask;
  lastRunResult?: SessionRunResult;
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

export type ProjectGitHead = { branch: string } | { detachedAt: string };

export interface GitChange {
  path: string;
  previousPath?: string;
  area: "staged" | "unstaged" | "untracked";
  kind: "added" | "modified" | "deleted" | "renamed" | "conflicted";
  origin: "existing" | "task" | "mixed";
  resolved?: true;
  taskReverted?: true;
}

export interface GitChangesView {
  phase: "workspace" | "running" | "interrupted" | "finished";
  changes: GitChange[] | null;
  checkpoint?: GitCheckpointReview;
  hasHistory?: true;
}

export interface GitDiffRequest {
  path: string;
  area: GitChange["area"];
  live?: boolean;
}

export interface GitFileDiff {
  diff: FileDiff | null;
  canOpen: boolean;
  lineTargets?: Record<number, number>;
  revision?: string;
  selectableHunks?: true;
  patch?: string;
}

export interface GitPatchSelection {
  path: string;
  revision: string;
  hunks?: number[];
}

export interface GitStageSelection extends GitPatchSelection {
  area: "unstaged" | "untracked";
}

export interface GitCommitPreview {
  token: string;
  branch: string | null;
  patch: string;
}

export interface GitCommitResult {
  commit: string;
  branch: string | null;
}

export type GitRollbackConflict = "ownership" | "index" | "snapshot" | "later-edit";

interface GitCheckpointFileSummary {
  path: string;
  conflict?: GitRollbackConflict;
  reverted?: true;
}

export interface GitCheckpointReview {
  id: string;
  files: GitCheckpointFileSummary[];
}

export interface GitCheckpointDiff {
  diff: FileDiff | null;
  revision: string;
  hunks: boolean[];
  wholeFile: boolean;
  conflict?: GitRollbackConflict;
  canOpen: boolean;
}

export interface GitRollbackSelection {
  checkpointId: string;
  path: string;
  revision: string;
  hunks?: number[];
}

export interface GitRollbackPreview {
  token: string;
  path: string;
  operation: "modify" | "create" | "delete";
  diff: FileDiff;
}

/** 主题（FR-5.5）：亮 / 暗 / 跟随系统；渲染层本地存储，切换时同步原生标题栏颜色 */
export type ThemeSetting = "light" | "dark" | "system";
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export type CommandShell = "powershell" | "bash";

export const VERIFICATION_KINDS = ["test", "typecheck", "build"] as const;
export type VerificationKind = (typeof VERIFICATION_KINDS)[number];
export type VerificationStatus =
  | "running"
  | "stopping"
  | "success"
  | "failed"
  | "stopped"
  | "interrupted";

export interface VerificationTask {
  taskId: string;
  agentRunId?: string;
  title?: string;
}

export interface VerificationRun extends RunRef {
  task: VerificationTask;
  rerunOf?: string;
  kind: VerificationKind;
  workingDirectory: string;
  command: string;
  shell: CommandShell;
  status: VerificationStatus;
  startedAt: number;
  durationMs: number;
  exitCode: number | null;
  revision: number;
  error?: string;
  saveError?: string;
}

export interface VerificationResult extends VerificationRun {
  output: string;
  truncated?: true;
}

export interface VerificationState {
  workingDirectory: string | null;
  commands: Partial<Record<VerificationKind, string>>;
  runs: VerificationRun[];
}

export interface StartVerification {
  workingDirectory: string;
  kind: VerificationKind;
  command: string;
}

export type ProviderKind = "anthropic" | "openai-compatible" | "openai-responses" | "faux";

/** 确认模式使用授权规则，完全访问放行常规操作，只读模式阻止写入与命令。危险命令始终需要单次确认。 */
export type ApprovalMode = "standard" | "full-access" | "read-only";

/** 模型思考强度（pi 的 7 档离散值，composer 滑块选择） */
export type ThinkingLevel = (typeof THINKING_LEVELS)[number];

export interface SkillMeta {
  id: string;
  name: string;
  description: string;
  directory: string;
  source: "installed" | ".agents/skills" | ".claude/skills";
  /** 已安装技能的启用状态保存到 settings.skillsEnabled。项目技能随项目生效。 */
  enabled: boolean;
}

export interface ModelCapabilities {
  contextWindow: number;
  maxTokens: number;
  supportsImages: boolean;
  supportsThinking: boolean;
}

/** USD per million tokens. */
export interface ModelPricing {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface ModelCatalogEntry extends Partial<ModelCapabilities> {
  id: string;
  name: string;
  cost?: Partial<ModelPricing>;
  overrides?: Partial<ModelCapabilities>;
}

export interface PublicModelCatalogEntry extends ModelCatalogEntry {
  automatic: ModelCapabilities;
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
type PublicProvider = Omit<ProviderFields, "models"> & {
  hasKey: boolean;
  models: PublicModelCatalogEntry[];
};

/** 成功时为备份路径，受阻时为原设置文件路径。 */
export interface SettingsRecovery {
  status: "recovered" | "blocked";
  path: string;
}

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
  recovery?: SettingsRecovery;
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
  /** 全局人设/自定义指令（"" = 清空）；缺省 = 保持不变 */
  persona?: string;
  /** 启用技能 id 列表；缺省 = 保持不变 */
  skillsEnabled?: string[];
}

export interface Snapshot {
  sessionId: string | null;
  composerId: string;
  composerDraft: ComposerDraft;
  draftWorkingDirectory: string | null;
  sessions: SessionMeta[];
  recentProjects: string[];
  messages: UiMessage[];
  status: AgentStatus;
  activeRun: ActiveRun | null;
  interruptedRun: InterruptedRun | null;
  failedRun: FailedRun | null;
  pendingPermissions: PermissionRequest[];
  error: string | null;
  settings: PublicSettings;
  usage: UsageTotals & { costTotal: number };
  /** 当前模型的上下文窗口大小（未知 = null，状态栏不显示占用） */
  contextWindow: number | null;
  /** 最近一轮的上下文占用 token 数 */
  contextTokens: number;
  steerCount: number;
}
