// @env all
// 双进程共用契约：通道名与数据类型。此文件只允许类型与常量，不得引入运行时依赖。
import type {
  EXECUTION_APPROVAL_MODES,
  IMAGE_ATTACHMENT_MIME_TYPES,
  DIAGNOSTIC_EVENTS,
  LOG_LEVELS,
  SUPPORTED_LOCALES,
  THINKING_LEVELS,
} from "./constants";
import type { ProjectTrustRequest } from "./project-config";

export const IPC = {
  ping: "app:ping",
  runAgentSmoke: "agent:smoke-run",
  appInfo: "app:info",
  menuAction: "app:menu-action",
  appOpenPath: "app:open-path",
  appDiagnosticEvents: "app:diagnostic-events",
  appExportDiagnostics: "app:export-diagnostics",
  appSetLocale: "app:set-locale",
  appSetConversationVisible: "app:set-conversation-visible",
  appSetTitlebarTheme: "app:set-titlebar-theme",
  appGetUpdateStatus: "app:get-update-status",
  appCheckForUpdates: "app:check-for-updates",
  appDownloadUpdate: "app:download-update",
  appInstallUpdate: "app:install-update",
  appShowUpdatePackage: "app:show-update-package",
  agentPrompt: "agent:prompt",
  agentResume: "agent:resume",
  agentCompact: "agent:compact",
  agentSearchWorkspace: "agent:search-workspace",
  agentResolveDroppedPaths: "agent:resolve-dropped-paths",
  agentPreviewWorkspaceReference: "agent:preview-workspace-reference",
  agentAbort: "agent:abort",
  agentClearQueue: "agent:clear-queue",
  agentGetSnapshot: "agent:get-snapshot",
  sessionNew: "session:new",
  sessionSaveDraft: "session:save-draft",
  sessionSaveDraftImages: "session:save-draft-images",
  sessionUpdateSettings: "session:update-settings",
  sessionSetPlanMode: "session:set-plan-mode",
  sessionReviewPlan: "session:review-plan",
  sessionSelectProject: "session:select-project",
  sessionOpenDroppedProject: "session:open-dropped-project",
  sessionUseRecentProject: "session:use-recent-project",
  sessionOpenProjectFolder: "session:open-project-folder",
  sessionRemoveRecentProject: "session:remove-recent-project",
  sessionGitHead: "session:git-head",
  sessionGitChanges: "session:git-changes",
  sessionGitDiff: "session:git-diff",
  sessionStageGit: "session:stage-git",
  sessionPreviewGitCommit: "session:preview-git-commit",
  sessionCommitGit: "session:commit-git",
  sessionGitBranches: "session:git-branches",
  sessionGitWorktrees: "session:git-worktrees",
  sessionCreateGitWorktree: "session:create-git-worktree",
  sessionOpenGitWorktree: "session:open-git-worktree",
  sessionPreviewGitWorktree: "session:preview-git-worktree",
  sessionApplyGitWorktree: "session:apply-git-worktree",
  sessionPreviewWorktreeArchive: "session:preview-worktree-archive",
  sessionSwitchGitBranch: "session:switch-git-branch",
  sessionPreviewGitPush: "session:preview-git-push",
  sessionPushGit: "session:push-git",
  sessionPreviewGitPullRequest: "session:preview-git-pull-request",
  sessionCreateGitPullRequest: "session:create-git-pull-request",
  sessionGitCheckpointDiff: "session:git-checkpoint-diff",
  sessionPreviewGitRollback: "session:preview-git-rollback",
  sessionApplyGitRollback: "session:apply-git-rollback",
  sessionOpenGitLine: "session:open-git-line",
  sessionOpenWorkspaceFile: "session:open-workspace-file",
  sessionLoad: "session:load",
  sessionRename: "session:rename",
  sessionDelete: "session:delete",
  sessionPin: "session:pin",
  sessionArchive: "session:archive",
  sessionUnread: "session:unread",
  sessionFork: "session:fork",
  sessionBranchMessage: "session:branch-message",
  sessionPreviewMessageRollback: "session:preview-message-rollback",
  sessionApplyMessageRollback: "session:apply-message-rollback",
  sessionCopy: "session:copy",
  sessionSearch: "session:search",
  sessionExportMarkdown: "session:export-markdown",
  sessionPersona: "session:persona",
  sessionInstructionSources: "session:instruction-sources",
  sessionProjectConfig: "session:project-config",
  sessionSetProjectTrust: "session:set-project-trust",
  sessionPreviewMemory: "session:preview-memory",
  sessionSaveMemory: "session:save-memory",
  sessionUndoMemory: "session:undo-memory",
  sessionFileDiff: "session:file-diff",
  sessionUndoFileChange: "session:undo-file-change",
  sessionVerification: "session:verification",
  sessionVerificationRun: "session:verification-run",
  sessionStartVerification: "session:start-verification",
  sessionStopVerification: "session:stop-verification",
  sessionRerunVerification: "session:rerun-verification",
  sessionSetAfterTurnVerification: "session:set-after-turn-verification",
  sessionRepairVerification: "session:repair-verification",
  sessionTerminals: "session:terminals",
  sessionOpenTerminal: "session:open-terminal",
  sessionTerminalOutput: "session:terminal-output",
  sessionWriteTerminal: "session:write-terminal",
  sessionResizeTerminal: "session:resize-terminal",
  sessionStopTerminal: "session:stop-terminal",
  settingsModelCatalog: "settings:model-catalog",
  settingsTestProvider: "settings:test-provider",
  settingsPickWorkingDirectory: "settings:pick-working-directory",
  settingsPickImportDirectory: "settings:pick-import-directory",
  settingsPreviewExternalImport: "settings:preview-external-import",
  settingsImportExternal: "settings:import-external",
  settingsImportedPlugins: "settings:imported-plugins",
  settingsToggleImportedPlugin: "settings:toggle-imported-plugin",
  settingsPickPluginPackage: "settings:pick-plugin-package",
  settingsPreviewPluginPackage: "settings:preview-plugin-package",
  settingsInstallPluginPackage: "settings:install-plugin-package",
  settingsUninstallPlugin: "settings:uninstall-plugin",
  settingsPluginMarketplaces: "settings:plugin-marketplaces",
  settingsBrowsePluginMarketplace: "settings:browse-plugin-marketplace",
  settingsRemovePluginMarketplace: "settings:remove-plugin-marketplace",
  settingsSearchMcpRegistry: "settings:search-mcp-registry",
  skillsList: "skills:list",
  skillsRead: "skills:read",
  skillsDelete: "skills:delete",
  skillsImport: "skills:import",
  skillsToggle: "skills:toggle",
  settingsGet: "settings:get",
  settingsSave: "settings:save",
  settingsSetPromptTemplates: "settings:set-prompt-templates",
  settingsSetLogLevel: "settings:set-log-level",
  settingsSetNotificationsEnabled: "settings:set-notifications-enabled",
  settingsSetAutoDownloadUpdates: "settings:set-auto-download-updates",
  settingsSetExternalEditor: "settings:set-external-editor",
  settingsSelectModel: "settings:select-model",
  settingsSetThinkingLevel: "settings:set-thinking-level",
  settingsRevokeToolRule: "settings:revoke-tool-rule",
  settingsDismissRecovery: "settings:dismiss-recovery",
  settingsMcpList: "settings:mcp-list",
  settingsMcpSave: "settings:mcp-save",
  settingsMcpReconnect: "settings:mcp-reconnect",
  settingsMcpOAuthStart: "settings:mcp-oauth-start",
  settingsMcpOAuthCancel: "settings:mcp-oauth-cancel",
  settingsMcpOAuthSignOut: "settings:mcp-oauth-sign-out",
  settingsMcpRemove: "settings:mcp-remove",
  toolPermissionRespond: "tool:permission-respond",
  toolProjectTrustRespond: "tool:project-trust-respond",
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
  | {
      type: "file";
      id: string;
      label: string;
      meta: { workingDirectory: string; diff?: GitDiffReference };
    }
  | { type: "directory"; id: string; label: string; meta: { workingDirectory: string } }
  | {
      type: "skill";
      id: string;
      label: string;
      meta: { description: string; workingDirectory?: string };
    };

export type ComposerDraft = (string | PromptMention)[];

export type ImageAttachmentMimeType = (typeof IMAGE_ATTACHMENT_MIME_TYPES)[number];

export interface ImageAttachment {
  type: "image";
  name: string;
  mimeType: ImageAttachmentMimeType;
  data: string;
}

export type MessageBranchAction = "fork" | "edit" | "retry";

export interface PromptInput {
  text: string;
  mentions: (PromptMention & { offset?: number })[];
  images?: ImageAttachment[];
}

/** 数据目录（shell.openPath 的白名单目标，防止渲染层打开任意路径） */
export type OpenPathTarget = "settings" | "sessions" | "skills" | "logs";
export type LogLevel = (typeof LOG_LEVELS)[number];
export type DiagnosticSource = keyof typeof DIAGNOSTIC_EVENTS;
export type DiagnosticEventName = (typeof DIAGNOSTIC_EVENTS)[DiagnosticSource][number];
export interface DiagnosticEvent {
  time: string;
  level: Exclude<LogLevel, "off">;
  source: DiagnosticSource;
  event: DiagnosticEventName;
  errorName?: string;
  code?: string | number;
  line?: number;
  reason?: string;
  version?: string;
  processType?: string;
}

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
export const TERMINAL_EVENT_CHANNEL = "session:terminal-event";

export type UpdateStatus =
  | { state: "unavailable" | "idle" | "checking" | "current" }
  | { state: "error"; reason?: "appimage-install" | "package-missing" }
  | { state: "available"; version: string }
  | { state: "downloading"; version: string; percent: number }
  | { state: "ready" | "installing" | "package-ready"; version: string };

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

export type SubtaskStep = {
  id: string;
  toolName: string;
  label: string;
  inputSummary: string;
  state: "running" | "success" | "error";
  output?: string;
  durationMs?: number;
};

export type SubtaskTrace = {
  question: string;
  status: "running" | "success" | "error" | "stopped" | "interrupted";
  steps: SubtaskStep[];
  usage: UsageTotals & { costTotal: number };
};

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

export type MemoryScope = "project" | "global";

export interface MemoryProposal {
  text: string;
  scope?: MemoryScope;
}

export interface MemoryPreview {
  token: string;
  path: string | null;
  diff: FileDiff;
}

interface ToolInvocation {
  callId: string;
  toolName: string;
  label: string;
  inputSummary?: string;
}

export type UiUserPart =
  | { type: "text"; text: string }
  | ImageAttachment
  | {
      type: "mention";
      kind: PromptMention["type"];
      id: string;
      label: string;
      workingDirectory?: string;
      diff?: GitDiffReference;
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
      approval?: ToolApproval;
      sources?: WebSource[];
      memory?: MemoryProposal;
      subtask?: SubtaskTrace;
    });

export type WebSource = { title: string; url: string };

export interface AssistantTiming {
  runId: string;
  startedAt: number;
  endedAt?: number;
}

export interface UiMessage {
  id: string;
  role: "user" | "assistant" | "system" | "toolResult";
  parts: UiPart[];
  streaming?: boolean;
  timing?: AssistantTiming;
}

export interface TranscriptLocation {
  messageId: string;
  partIndex: number;
  field: "text" | "input" | "output" | "path";
  occurrence: number;
}

export interface TranscriptSnippet {
  before: string;
  match: string;
  after: string;
}

export interface SessionSearchHit {
  sessionId: string;
  location: TranscriptLocation;
  snippet: TranscriptSnippet;
}

export interface SessionSearchResults {
  hits: SessionSearchHit[];
  hasMore: boolean;
}

export type AgentStatus = "idle" | "streaming" | "waiting_approval" | "stopping";

export interface RunRef {
  runId: string;
  sessionId: string;
}

export type RunBlocker = { kind: "workspace"; run: RunRef } | { kind: "capacity" };

export interface ActiveRun extends RunRef {
  planning?: true;
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

export interface PermissionFilePreview {
  path: string;
  operation: "create" | "overwrite" | "edit" | "write";
  diff?: FileDiff;
  error?: string;
}

export interface PermissionRequest {
  type: "permission_request";
  requestId: string;
  callId: string;
  toolName: string;
  label: string;
  inputSummary: string;
  danger: boolean;
  commandDanger?: CommandDanger;
  workingDirectory?: string;
  command?: string;
  commandShell?: CommandShell;
  position?: { index: number; total: number };
  file?: PermissionFilePreview;
  mcp?: { server: string; tool: string };
  web?: { domain: string; url: string; query?: string };
  rule?: ToolRule;
}

export type UsageTotals = {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
};

export type AgentRunEvent =
  | {
      type: "status";
      status: AgentStatus;
      result?: Exclude<SessionRunResult, "interrupted">;
      interruptedRun?: InterruptedRun;
      failedRun?: FailedRun;
    }
  | { type: "model_retry"; retry: ModelRetryProgress | null; resetReplyId?: string }
  | { type: "context_compacting"; compacting: boolean }
  | { type: "context_compacted"; compaction: ContextCompaction; contextTokens: number }
  | { type: "messages"; messages: UiMessage[] }
  | { type: "user_message"; message: UiMessage }
  | { type: "assistant_start"; id: string; timing: Omit<AssistantTiming, "endedAt"> }
  | { type: "assistant_delta"; id: string; delta: string }
  | { type: "assistant_end"; id: string; timing: Required<AssistantTiming> }
  | { type: "thinking_start"; id: string; blockIndex: number }
  | { type: "thinking_delta"; id: string; blockIndex: number; delta: string }
  | { type: "thinking_end"; id: string; blockIndex: number; text: string; durationMs?: number }
  | { type: "plan"; steps: PlanStep[] }
  | (ToolInvocation & { type: "tool_call" | "tool_start"; id?: string })
  | { type: "tool_update"; callId: string; output: string }
  | { type: "subtask_progress"; callId: string; trace: SubtaskTrace }
  | {
      type: "tool_end";
      callId: string;
      state: "success" | "error";
      output?: string;
      error?: string;
      durationMs?: number;
      sources?: WebSource[];
      memory?: MemoryProposal;
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
  | { type: "permission_resolved"; requestId: string; callId: string; approval: ToolApproval }
  | ProjectTrustRequest
  | { type: "project_trust_resolved"; requestId: string }
  | { type: "error"; message: string };

export type SessionNavigation = "record" | "reset" | "reveal";

export type UiAgentEvent =
  | { type: "snapshot"; snapshot: Snapshot; navigation?: SessionNavigation }
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

export interface ToolApproval {
  decision: PermissionDecision;
  rule?: ToolRule;
}

export interface CommandPrefix {
  shell: CommandShell;
  args: string[];
}

/** 旧命令规则缺少 commandPrefix，保留在设置中供撤销。 */
export interface ToolRule {
  toolName: string;
  pathPrefix?: string;
  commandPrefix?: CommandPrefix;
  domain?: string;
}

export interface SessionModelSelection {
  providerId: string;
  modelId: string;
}

export interface SessionSettings {
  model?: SessionModelSelection;
  approvalMode?: ApprovalMode;
  planMode?: PlanMode;
}

export interface SessionSettingsInput {
  model?: SessionModelSelection | null;
  approvalMode?: ApprovalMode | null;
}

export interface PlanMode {
  executionMode: ApprovalMode;
  proposal?: PlanProposal;
}

export interface PlanProposal {
  id: string;
  markdown: string;
  workingDirectory: string | null;
}

export type PlanDecision = { type: "save"; markdown: string } | { type: "execute" | "discard" };

export type ProjectInstructionSource =
  | { status: "unlinked" }
  | { status: "loaded" | "missing" | "empty" | "unavailable"; path: string };

export interface ScopedProjectInstructionSource {
  directory: string;
  source: Exclude<ProjectInstructionSource, { status: "unlinked" }>;
}

export interface SessionInstructionSources {
  project: ProjectInstructionSource;
  scopedProject?: ScopedProjectInstructionSource[];
  personalization: "session" | "global" | null;
  enabledSkills: string[];
  running: boolean;
}

export const SESSION_RUN_RESULTS = ["success", "failed", "stopped", "interrupted"] as const;
export type SessionRunResult = (typeof SESSION_RUN_RESULTS)[number];

export interface SessionMeta extends SessionSettings {
  worktree?: ManagedWorktree;
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  workingDirectory?: string;
  lastTask?: VerificationTask;
  lastRunResult?: SessionRunResult;
  /** 用户手动重命名后保留当前标题 */
  titleCustom?: boolean;
  titleGenerated?: true;
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

export interface GitBranchOptions {
  token: string;
  head: ProjectGitHead | null;
  branches: string[];
}

export interface ManagedWorktree {
  id: string;
  projectDirectory: string;
  directory: string;
  branch: string;
  baseBranch: string;
  baseCommit: string;
  removed?: true;
}

export interface GitWorktreeOptions {
  projectDirectory: string;
  currentBranch: string | null;
  defaultBranchName: string;
  branches: { name: string; commit: string }[];
  worktrees: ManagedWorktree[];
}

export interface GitWorktreeCreate {
  branch: string;
  baseBranch: string;
  baseCommit: string;
}

export interface GitWorktreeRemainder {
  worktree: ManagedWorktree;
  head: string;
  commits: number;
  changes: { path: string; status: string }[];
  omittedChanges: number;
  unavailable?: true;
}

export interface GitWorktreeReview extends GitWorktreeRemainder {
  token: string;
  patch: string;
  patchTruncated: boolean;
  mergeBlock?: string;
  removeBlock?: string;
}

export type GitWorktreeAction = "merge" | "remove";

export type GitBranchRequest = { kind: "create" | "switch"; branch: string };

export interface GitPushPreview {
  token: string;
  branch: string;
  remote: string;
  destination: string;
  targetBranch: string;
  newBranch: boolean;
  commits: { hash: string; subject: string }[];
}

export interface GitPushResult {
  trackingFailed?: true;
}

export interface GitPullRequestDraft {
  base: string;
  title: string;
  body: string;
}

export interface GitPullRequestPreview extends GitPullRequestDraft {
  token: string;
  repository: string;
  head: string;
}

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
  referencePaths?: GitDiffPaths;
  revision?: string;
  selectableHunks?: true;
  patch?: string;
}

export interface GitDiffPaths {
  path: string;
  previousPath?: string;
}

export interface DiffLineSpan {
  first: number;
  last: number;
}

export interface GitDiffReference extends Omit<GitDiffPaths, "path"> {
  area: GitChange["area"];
  before?: DiffLineSpan;
  after?: DiffLineSpan;
  openLine?: number;
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

export interface MessageRollbackPreview {
  token?: string;
  removedMessages: number;
  files: Omit<GitRollbackPreview, "token">[];
  conflicts: { path?: string; reason: string }[];
}

/** 主题（FR-5.5）：亮 / 暗 / 跟随系统；渲染层本地存储，切换时同步原生标题栏颜色 */
export type ThemeSetting = "light" | "dark" | "system";
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export type CommandShell = "powershell" | "bash";

type TerminalStatus = "running" | "stopping" | "success" | "failed" | "stopped";

export interface TerminalSize {
  columns: number;
  rows: number;
}

export interface TerminalRecord {
  id: string;
  composerId: string;
  workingDirectory: string;
  shell: CommandShell;
  source: "user" | "agent";
  command?: string;
  status: TerminalStatus;
  exitCode?: number;
  error?: string;
}

export interface TerminalOutput {
  offset: number;
  data: string;
}

export type TerminalEvent =
  | { type: "updated"; record: TerminalRecord }
  | { type: "removed"; composerId: string; id: string }
  | { type: "output"; composerId: string; id: string; output: TerminalOutput };

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
  trigger?: "after-turn";
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
  project?: VerificationProject;
}

export interface VerificationProject {
  directory: string;
  shell: CommandShell;
  afterTurn?: AfterTurnVerification;
  afterTurnSource?: "project";
  afterTurnOverride?: boolean;
  configRevision?: string;
  commandSources?: VerificationKind[];
}

export interface AfterTurnVerification {
  kind: VerificationKind;
  command: string;
  shell: CommandShell;
}

export interface StartVerification {
  workingDirectory: string;
  kind: VerificationKind;
  command: string;
  projectRevision?: string;
}

export type ProviderKind = "anthropic" | "openai-compatible" | "openai-responses" | "faux";

/** 确认模式使用授权规则，完全访问放行常规操作，只读模式阻止写入与命令。危险命令始终需要单次确认。 */
export type ApprovalMode = (typeof EXECUTION_APPROVAL_MODES)[number];

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

export interface PromptTemplate {
  name: string;
  text: string;
}

export type ExternalEditor =
  | { kind: "vscode" | "cursor" }
  | { kind: "jetbrains"; command: string }
  | { kind: "custom"; command: string; args: string[] };

export interface PublicSettings {
  providers: PublicProvider[];
  activeProviderId: string;
  auxiliaryModel: SessionModelSelection | null;
  toolRules?: ToolRule[];
  approvalMode: ApprovalMode;
  thinkingLevel: ThinkingLevel;
  thinkingLevels: ThinkingLevel[];
  workingDirectory: string | null;
  commandShell: CommandShell;
  externalEditor: ExternalEditor;
  logLevel: LogLevel;
  notificationsEnabled: boolean;
  autoDownloadUpdates: boolean;
  /** 全局人设/自定义指令（设置页「个性化」编辑） */
  persona: string;
  promptTemplates: PromptTemplate[];
  pluginPromptTemplates?: PromptTemplate[];
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
  /** null 跟随会话模型，缺省保留已保存的选择 */
  auxiliaryModel?: SessionModelSelection | null;
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
  draftImages: ImageAttachment[];
  draftSettings: SessionSettings;
  draftWorkingDirectory: string | null;
  worktree?: ManagedWorktree;
  sessions: SessionMeta[];
  recentProjects: string[];
  messages: UiMessage[];
  status: AgentStatus;
  activeRuns: ActiveRun[];
  workspaceRunIds: string[];
  interruptedRun: InterruptedRun | null;
  failedRun: FailedRun | null;
  pendingPermissions: PermissionRequest[];
  pendingProjectTrust: ProjectTrustRequest | null;
  error: string | null;
  settings: PublicSettings;
  usage: UsageTotals & { costTotal: number };
  /** 当前模型的上下文窗口大小（未知 = null，状态栏不显示占用） */
  contextWindow: number | null;
  /** 最近一轮的上下文占用 token 数 */
  contextTokens: number;
  steerCount: number;
}
