// @env all
// 渲染层可用的 API 形状。preload 实现它，renderer 通过 window.pi 消费。
import type {
  AfterTurnVerification,
  AgentSmokeResult,
  AppInfo,
  ComposerDraft,
  FileDiff,
  GitBranchOptions,
  GitBranchRequest,
  GitCheckpointDiff,
  GitChangesView,
  GitCommitPreview,
  GitCommitResult,
  GitDiffRequest,
  GitFileDiff,
  GitPatchSelection,
  GitPullRequestDraft,
  GitPullRequestPreview,
  GitPushPreview,
  GitPushResult,
  GitRollbackPreview,
  GitRollbackSelection,
  GitStageSelection,
  GitWorktreeAction,
  GitWorktreeCreate,
  GitWorktreeOptions,
  GitWorktreeRemainder,
  GitWorktreeReview,
  ExternalEditor,
  ImageAttachment,
  Locale,
  LogLevel,
  MemoryPreview,
  MemoryScope,
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
  PromptMention,
  PromptTemplate,
  ProviderInput,
  ProviderTestResult,
  PublicSettings,
  RunRef,
  RunBlocker,
  SessionMeta,
  SessionSearchResults,
  SessionInstructionSources,
  SessionSettingsInput,
  SettingsInput,
  SkillMeta,
  Snapshot,
  StartVerification,
  TerminalEvent,
  TerminalOutput,
  TerminalRecord,
  TerminalSize,
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
import type { McpRegistryPage, PluginMarketplace, PluginMarketplaceSource } from "./discovery";
import type {
  ExternalImportKind,
  ExternalImportPreview,
  ImportedPluginInfo,
  ImportReport,
  PluginPackagePreview,
  PluginPackageSource,
} from "./imports";
import type { McpOAuthRef, McpServerInfo, McpServerInput } from "./mcp";
import type { ProjectConfigInfo, ProjectTrustDecision } from "./project-config";

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
  ): Promise<RunBlocker | null>;
  agentResume(run: RunRef, compact?: boolean): Promise<void>;
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
  sessionSaveDraftImages(composerId: string, images: ImageAttachment[]): Promise<void>;
  getPathForFile(file: File): string;
  resolveDroppedPaths(
    composerId: string,
    workingDirectory: string,
    paths: string[],
  ): Promise<PromptMention[]>;
  sessionUpdateSettings(composerId: string, input: SessionSettingsInput): Promise<void>;
  sessionSetPlanMode(composerId: string, enabled: boolean): Promise<void>;
  sessionReviewPlan(composerId: string, proposalId: string, decision: PlanDecision): Promise<void>;
  sessionSelectProject(locale: Locale, sessionId?: string): Promise<Snapshot | null>;
  sessionOpenDroppedProject(directory: string): Promise<void>;
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
  sessionGitBranches(composerId: string): Promise<GitBranchOptions>;
  sessionGitWorktrees(composerId: string): Promise<GitWorktreeOptions>;
  sessionCreateGitWorktree(composerId: string, request: GitWorktreeCreate): Promise<Snapshot>;
  sessionOpenGitWorktree(composerId: string, id: string): Promise<Snapshot>;
  sessionPreviewGitWorktree(composerId: string, id: string): Promise<GitWorktreeReview>;
  sessionApplyGitWorktree(
    composerId: string,
    token: string,
    action: GitWorktreeAction,
  ): Promise<void>;
  sessionPreviewWorktreeArchive(id: string): Promise<GitWorktreeRemainder>;
  sessionSwitchGitBranch(
    composerId: string,
    token: string,
    request: GitBranchRequest,
  ): Promise<void>;
  sessionPreviewGitPush(composerId: string): Promise<GitPushPreview>;
  sessionPushGit(composerId: string, token: string): Promise<GitPushResult>;
  sessionPreviewGitPullRequest(composerId: string): Promise<GitPullRequestPreview>;
  sessionCreateGitPullRequest(
    composerId: string,
    token: string,
    draft: GitPullRequestDraft,
  ): Promise<string>;
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
  sessionOpenWorkspaceFile(
    composerId: string,
    reference: WorkspaceReferenceRequest,
    line?: number,
  ): Promise<void>;
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
  sessionProjectConfig(composerId: string): Promise<ProjectConfigInfo | null>;
  sessionSetProjectTrust(
    composerId: string,
    directory: string,
    revision: string | null,
  ): Promise<void>;
  sessionPreviewMemory(
    composerId: string,
    projectDirectory: string | null,
    scope: MemoryScope,
    text: string,
  ): Promise<MemoryPreview>;
  sessionSaveMemory(composerId: string, token: string): Promise<void>;
  sessionUndoMemory(composerId: string, token: string): Promise<void>;
  sessionFileDiff(id: string, changeId: string): Promise<FileDiff>;
  sessionUndoFileChange(id: string, changeId: string): Promise<void>;
  sessionVerification(composerId: string): Promise<VerificationState>;
  sessionSetAfterTurnVerification(
    composerId: string,
    directory: string,
    config: AfterTurnVerification | "project" | null,
  ): Promise<void>;
  sessionRepairVerification(composerId: string, runId: string, locale: Locale): Promise<void>;
  sessionVerificationRun(composerId: string, runId: string): Promise<VerificationResult>;
  sessionStartVerification(
    composerId: string,
    request: StartVerification,
  ): Promise<VerificationResult>;
  sessionStopVerification(composerId: string, runId: string): Promise<VerificationResult>;
  sessionRerunVerification(composerId: string, runId: string): Promise<VerificationResult>;
  sessionTerminals(composerId: string): Promise<TerminalRecord[]>;
  sessionOpenTerminal(
    composerId: string,
    workingDirectory: string,
    size: TerminalSize,
  ): Promise<TerminalRecord>;
  sessionTerminalOutput(composerId: string, id: string): Promise<TerminalOutput>;
  sessionWriteTerminal(composerId: string, id: string, data: string): Promise<void>;
  sessionResizeTerminal(composerId: string, id: string, size: TerminalSize): Promise<void>;
  sessionStopTerminal(composerId: string, id: string): Promise<void>;
  onTerminalEvent(callback: (event: TerminalEvent) => void): () => void;
  settingsGet(): Promise<PublicSettings>;
  settingsSave(input: SettingsInput): Promise<PublicSettings>;
  settingsSetPromptTemplates(templates: PromptTemplate[]): Promise<PublicSettings>;
  settingsSetLogLevel(level: LogLevel): Promise<void>;
  settingsSetNotificationsEnabled(enabled: boolean): Promise<void>;
  settingsSetExternalEditor(editor: ExternalEditor): Promise<ExternalEditor>;
  settingsSelectModel(providerId: string, modelId: string): Promise<PublicSettings>;
  settingsSetThinkingLevel(level: ThinkingLevel): Promise<PublicSettings>;
  settingsRevokeToolRule(rule: ToolRule): Promise<PublicSettings>;
  settingsDismissRecovery(): Promise<PublicSettings>;
  mcpList(): Promise<McpServerInfo[]>;
  mcpSave(input: McpServerInput): Promise<McpServerInfo[]>;
  mcpReconnect(id: string): Promise<McpServerInfo[]>;
  mcpOAuthStart(target: McpOAuthRef, requestId: string, locale: Locale): Promise<boolean>;
  mcpOAuthCancel(requestId: string): Promise<void>;
  mcpOAuthSignOut(target: McpOAuthRef): Promise<void>;
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
  pickPluginPackage(kind: "directory" | "zip", locale: Locale): Promise<string | null>;
  previewPluginPackage(source: PluginPackageSource | string): Promise<PluginPackagePreview>;
  installPluginPackage(
    source: PluginPackageSource | string,
    token: string,
  ): Promise<ImportedPluginInfo[]>;
  uninstallPlugin(id: string): Promise<ImportedPluginInfo[]>;
  pluginMarketplaces(): Promise<PluginMarketplaceSource[]>;
  browsePluginMarketplace(location: string, remember: boolean): Promise<PluginMarketplace>;
  removePluginMarketplace(location: string): Promise<PluginMarketplaceSource[]>;
  searchMcpRegistry(query: string, cursor?: string): Promise<McpRegistryPage>;
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
  /** 对项目信任请求应答；requestId 来自 project_trust_request 事件 */
  projectTrustRespond(
    run: RunRef,
    requestId: string,
    decision: ProjectTrustDecision,
  ): Promise<void>;
  /** 订阅主进程事件流；返回退订函数 */
  onAgentEvent(callback: (event: UiAgentEvent) => void): () => void;
}
