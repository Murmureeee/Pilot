// @env all
// 渲染层可用的 API 形状。preload 实现它，renderer 通过 window.pi 消费。
import type {
  ActiveRun,
  AgentSmokeResult,
  AppInfo,
  ComposerDraft,
  FileDiff,
  GitCheckpointDiff,
  GitChangesView,
  GitCommitPreview,
  GitCommitResult,
  GitDiffRequest,
  GitFileDiff,
  GitPatchSelection,
  GitRollbackPreview,
  GitRollbackSelection,
  GitStageSelection,
  Locale,
  LogLevel,
  MenuAction,
  MessageBranchAction,
  MessageRollbackPreview,
  ModelCatalogEntry,
  OpenPathTarget,
  PermissionDecision,
  PingRequest,
  PingResponse,
  PlanDecision,
  ProjectGitHead,
  PromptInput,
  ProviderInput,
  ProviderTestResult,
  PublicSettings,
  RunRef,
  SessionMeta,
  SessionSearchResults,
  SessionInstructionSources,
  SessionSettingsInput,
  SettingsInput,
  SkillMeta,
  Snapshot,
  StartVerification,
  ThemeSetting,
  ThinkingLevel,
  ToolRule,
  UiAgentEvent,
  UpdateStatus,
  VerificationResult,
  VerificationState,
  WorkspaceEntry,
  WorkspaceReferencePreview,
  WorkspaceReferenceRequest,
} from "./contract";
import type {
  ExternalImportKind,
  ExternalImportPreview,
  ImportedPluginInfo,
  ImportReport,
} from "./imports";
import type { McpServerInfo, McpServerInput } from "./mcp";

export interface PiApi {
  ping(request: PingRequest): Promise<PingResponse>;
  runAgentSmoke(): Promise<AgentSmokeResult>;
  getAppInfo(): Promise<AppInfo>;
  /** 窗口级菜单动作（编辑/缩放/重载/全屏/关闭/退出），主进程白名单校验 */
  menuAction(action: MenuAction): Promise<void>;
  /** 打开数据目录（设置/会话），主进程白名单校验 */
  openPath(target: OpenPathTarget): Promise<string>;
  /** 同步界面语言供主进程的原生提示使用。 */
  setLocale(locale: Locale): Promise<void>;
  setConversationVisible(visible: boolean): Promise<void>;
  /** 同步原生标题栏（窗控按钮）颜色到主题 */
  setTitlebarTheme(theme: ThemeSetting): Promise<void>;
  getUpdateStatus(): Promise<UpdateStatus>;
  checkForUpdates(): Promise<UpdateStatus>;
  installUpdate(): Promise<void>;
  showUpdatePackage(): Promise<void>;
  onUpdateStatus(callback: (status: UpdateStatus) => void): () => void;
  getSnapshot(): Promise<Snapshot>;
  agentPrompt(
    input: string | PromptInput,
    expectedDirectory?: string | null,
    composerId?: string,
  ): Promise<ActiveRun | null>;
  agentResume(run: RunRef, compact?: boolean): Promise<ActiveRun | null>;
  agentCompact(composerId: string, focus?: string): Promise<void>;
  searchWorkspace(query: string, expectedDirectory?: string): Promise<WorkspaceEntry[]>;
  previewWorkspaceReference(
    reference: WorkspaceReferenceRequest,
  ): Promise<WorkspaceReferencePreview>;
  agentAbort(run: RunRef): Promise<void>;
  /** 清空排队中的插话（steer + followUp） */
  clearQueue(run: RunRef): Promise<void>;
  sessionNew(): Promise<Snapshot>;
  sessionSaveDraft(composerId: string, draft: ComposerDraft): Promise<void>;
  sessionUpdateSettings(composerId: string, input: SessionSettingsInput): Promise<void>;
  sessionSetPlanMode(composerId: string, enabled: boolean): Promise<void>;
  sessionReviewPlan(composerId: string, proposalId: string, decision: PlanDecision): Promise<void>;
  sessionSelectProject(locale: Locale, sessionId?: string): Promise<Snapshot | null>;
  sessionUseRecentProject(directory: string, sessionId?: string): Promise<Snapshot>;
  sessionOpenProjectFolder(directory: string): Promise<void>;
  sessionRemoveRecentProject(directory: string): Promise<void>;
  sessionGitHead(directory: string): Promise<ProjectGitHead | null>;
  sessionGitChanges(composerId: string, live?: boolean): Promise<GitChangesView | null>;
  sessionGitDiff(composerId: string, request: GitDiffRequest): Promise<GitFileDiff>;
  sessionStageGit(composerId: string, selection: GitStageSelection): Promise<void>;
  sessionPreviewGitCommit(
    composerId: string,
    selections: GitPatchSelection[],
  ): Promise<GitCommitPreview>;
  sessionCommitGit(composerId: string, token: string, message: string): Promise<GitCommitResult>;
  sessionGitCheckpointDiff(
    composerId: string,
    checkpointId: string,
    path: string,
  ): Promise<GitCheckpointDiff>;
  sessionPreviewGitRollback(
    composerId: string,
    selection: GitRollbackSelection,
  ): Promise<GitRollbackPreview>;
  sessionApplyGitRollback(composerId: string, token: string): Promise<void>;
  sessionOpenGitLine(composerId: string, request: GitDiffRequest, line: number): Promise<void>;
  sessionLoad(id: string, record?: boolean): Promise<Snapshot>;
  sessionRename(id: string, title: string): Promise<SessionMeta[]>;
  sessionDelete(id: string): Promise<Snapshot>;
  /** 置顶/取消置顶，返回刷新后的会话列表 */
  sessionPin(id: string, pinned: boolean): Promise<SessionMeta[]>;
  /** 归档/取消归档（归档当前会话会回草稿态），返回快照 */
  sessionArchive(id: string, archived: boolean): Promise<Snapshot>;
  /** 标记/清除未读，返回刷新后的会话列表 */
  sessionUnread(id: string, unread: boolean): Promise<SessionMeta[]>;
  /** 分叉：复制转录为新会话，返回刷新后的会话列表 */
  sessionFork(id: string): Promise<SessionMeta[]>;
  sessionBranchMessage(
    composerId: string,
    messageId: string,
    action: MessageBranchAction,
  ): Promise<Snapshot>;
  sessionPreviewMessageRollback(
    composerId: string,
    messageId: string,
  ): Promise<MessageRollbackPreview>;
  sessionApplyMessageRollback(composerId: string, token: string): Promise<Snapshot>;
  /** 会话全文文本（复制到剪贴板用） */
  sessionCopy(id: string): Promise<string>;
  sessionSearch(query: string, project?: string | null): Promise<SessionSearchResults>;
  sessionExportMarkdown(id: string, locale: Locale): Promise<string | null>;
  /** 会话级人设覆盖（null = 清除，回落全局） */
  sessionPersona(id: string, persona: string | null): Promise<void>;
  sessionInstructionSources(composerId: string): Promise<SessionInstructionSources>;
  sessionFileDiff(id: string, changeId: string): Promise<FileDiff>;
  sessionUndoFileChange(id: string, changeId: string): Promise<void>;
  sessionVerification(composerId: string): Promise<VerificationState>;
  sessionVerificationRun(composerId: string, runId: string): Promise<VerificationResult>;
  sessionStartVerification(
    composerId: string,
    request: StartVerification,
  ): Promise<VerificationResult>;
  sessionStopVerification(composerId: string, runId: string): Promise<VerificationResult>;
  sessionRerunVerification(composerId: string, runId: string): Promise<VerificationResult>;
  settingsGet(): Promise<PublicSettings>;
  settingsSave(input: SettingsInput): Promise<PublicSettings>;
  settingsSetLogLevel(level: LogLevel): Promise<void>;
  settingsSetNotificationsEnabled(enabled: boolean): Promise<void>;
  settingsSelectModel(providerId: string, modelId: string): Promise<PublicSettings>;
  settingsSetThinkingLevel(level: ThinkingLevel): Promise<PublicSettings>;
  settingsRevokeToolRule(rule: ToolRule): Promise<PublicSettings>;
  settingsDismissRecovery(): Promise<PublicSettings>;
  mcpList(): Promise<McpServerInfo[]>;
  mcpSave(input: McpServerInput): Promise<McpServerInfo[]>;
  mcpReconnect(id: string): Promise<McpServerInfo[]>;
  mcpRemove(id: string): Promise<McpServerInfo[]>;
  pickWorkingDirectory(locale: Locale): Promise<string | null>;
  pickImportDirectory(locale: Locale): Promise<string | null>;
  previewExternalImport(
    kind: ExternalImportKind,
    project: string | null,
  ): Promise<ExternalImportPreview>;
  importExternal(
    kind: ExternalImportKind,
    project: string | null,
    selectedIds: string[],
  ): Promise<ImportReport>;
  importedPlugins(): Promise<ImportedPluginInfo[]>;
  toggleImportedPlugin(id: string, enabled: boolean): Promise<ImportedPluginInfo[]>;
  /** 技能列表（FR-5.8）：扫描 userData/skills/ + 合并启停状态 */
  skillsList(composerId: string): Promise<SkillMeta[]>;
  skillsRead(composerId: string, id: string, directory: string): Promise<string>;
  skillsDelete(composerId: string, id: string, directory: string): Promise<SkillMeta[]>;
  /** 导入技能目录：主进程弹目录选择框，取消返回 null */
  skillsImport(locale: Locale, composerId: string): Promise<SkillMeta[] | null>;
  /** 启停技能（持久化 settings.skillsEnabled），返回刷新后的列表 */
  skillsToggle(composerId: string, id: string, enabled: boolean): Promise<SkillMeta[]>;
  /** 模型目录浏览（FR-5.2）：ref = 已保存 provider id 或未保存草稿（FR-5.7 向导） */
  modelCatalog(ref: string | ProviderInput): Promise<ModelCatalogEntry[]>;
  /** Provider 连通性测试（FR-5.1）：最小流式探测 */
  testProvider(ref: string | ProviderInput): Promise<ProviderTestResult>;
  /** 对权限确认弹窗应答；requestId 来自 permission_request 事件 */
  permissionRespond(run: RunRef, requestId: string, decision: PermissionDecision): Promise<void>;
  /** 订阅主进程事件流；返回退订函数 */
  onAgentEvent(callback: (event: UiAgentEvent) => void): () => void;
}
