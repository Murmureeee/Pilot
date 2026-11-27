// @env node
import { contextBridge, ipcRenderer, webUtils } from "electron";

import type { PiApi } from "@shared/api";
import type {
  Locale,
  MenuAction,
  ModelCatalogEntry,
  OpenPathTarget,
  PingRequest,
  ProviderInput,
  ProviderTestResult,
  SessionMeta,
  SettingsInput,
  SkillMeta,
  TerminalEvent,
  ThemeSetting,
  UiAgentEvent,
  UpdateStatus,
} from "@shared/contract";
import {
  AGENT_EVENT_CHANNEL,
  IPC,
  TERMINAL_EVENT_CHANNEL,
  UPDATE_STATUS_CHANNEL,
} from "@shared/contract";

const api: PiApi = {
  ping: (request: PingRequest) => ipcRenderer.invoke(IPC.ping, request),
  runAgentSmoke: () => ipcRenderer.invoke(IPC.runAgentSmoke),
  getAppInfo: () => ipcRenderer.invoke(IPC.appInfo),
  menuAction: (action: MenuAction) => ipcRenderer.invoke(IPC.menuAction, action),
  scheduledTasksList: () => ipcRenderer.invoke(IPC.scheduledTasksList),
  scheduledTasksSave: (input, id) => ipcRenderer.invoke(IPC.scheduledTasksSave, input, id ?? null),
  scheduledTasksDelete: (id) => ipcRenderer.invoke(IPC.scheduledTasksDelete, id),
  scheduledTasksRun: (id, retryId) =>
    ipcRenderer.invoke(IPC.scheduledTasksRun, id, retryId ?? null),
  openPath: (target: OpenPathTarget) => ipcRenderer.invoke(IPC.appOpenPath, target),
  diagnosticEvents: () => ipcRenderer.invoke(IPC.appDiagnosticEvents),
  exportDiagnostics: (locale: Locale) => ipcRenderer.invoke(IPC.appExportDiagnostics, locale),
  exportBackup: () => ipcRenderer.invoke(IPC.appExportBackup),
  previewBackup: () => ipcRenderer.invoke(IPC.appPreviewBackup),
  cancelBackup: (token) => ipcRenderer.invoke(IPC.appCancelBackup, token),
  restoreBackup: (token) => ipcRenderer.invoke(IPC.appRestoreBackup, token),
  backupResult: () => ipcRenderer.invoke(IPC.appBackupResult),
  setLocale: (locale: Locale) => ipcRenderer.invoke(IPC.appSetLocale, locale),
  setConversationVisible: (visible) => ipcRenderer.invoke(IPC.appSetConversationVisible, visible),
  setTitlebarTheme: (theme: ThemeSetting) => ipcRenderer.invoke(IPC.appSetTitlebarTheme, theme),
  getUpdateStatus: () => ipcRenderer.invoke(IPC.appGetUpdateStatus),
  checkForUpdates: () => ipcRenderer.invoke(IPC.appCheckForUpdates),
  downloadUpdate: () => ipcRenderer.invoke(IPC.appDownloadUpdate),
  installUpdate: () => ipcRenderer.invoke(IPC.appInstallUpdate),
  showUpdatePackage: () => ipcRenderer.invoke(IPC.appShowUpdatePackage),
  onUpdateStatus: (callback) => {
    const listener = (_event: unknown, status: UpdateStatus): void => callback(status);
    ipcRenderer.on(UPDATE_STATUS_CHANNEL, listener);
    return () => ipcRenderer.removeListener(UPDATE_STATUS_CHANNEL, listener);
  },
  getSnapshot: () => ipcRenderer.invoke(IPC.agentGetSnapshot),
  agentPrompt: (input, expectedDirectory, composerId) =>
    ipcRenderer.invoke(IPC.agentPrompt, input, expectedDirectory, composerId),
  agentResume: (run, compact) => ipcRenderer.invoke(IPC.agentResume, run, compact),
  agentCompact: (composerId, focus) => ipcRenderer.invoke(IPC.agentCompact, composerId, focus),
  searchWorkspace: (query, expectedDirectory) =>
    ipcRenderer.invoke(IPC.agentSearchWorkspace, query, expectedDirectory),
  previewWorkspaceReference: (reference) =>
    ipcRenderer.invoke(IPC.agentPreviewWorkspaceReference, reference),
  agentAbort: (run) => ipcRenderer.invoke(IPC.agentAbort, run),
  clearQueue: (run) => ipcRenderer.invoke(IPC.agentClearQueue, run),
  sessionNew: () => ipcRenderer.invoke(IPC.sessionNew),
  sessionSaveDraft: (composerId, draft) =>
    ipcRenderer.invoke(IPC.sessionSaveDraft, composerId, draft),
  sessionSaveDraftImages: (composerId, images) =>
    ipcRenderer.invoke(IPC.sessionSaveDraftImages, composerId, images),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  resolveDroppedPaths: (composerId, workingDirectory, paths) =>
    ipcRenderer.invoke(IPC.agentResolveDroppedPaths, composerId, workingDirectory, paths),
  sessionUpdateSettings: (composerId, input) =>
    ipcRenderer.invoke(IPC.sessionUpdateSettings, composerId, input),
  sessionSetPlanMode: (composerId, enabled) =>
    ipcRenderer.invoke(IPC.sessionSetPlanMode, composerId, enabled),
  sessionReviewPlan: (composerId, proposalId, decision) =>
    ipcRenderer.invoke(IPC.sessionReviewPlan, composerId, proposalId, decision),
  sessionSelectProject: (locale, sessionId) =>
    ipcRenderer.invoke(IPC.sessionSelectProject, locale, sessionId),
  sessionOpenDroppedProject: (directory) =>
    ipcRenderer.invoke(IPC.sessionOpenDroppedProject, directory),
  sessionUseRecentProject: (directory, sessionId) =>
    ipcRenderer.invoke(IPC.sessionUseRecentProject, directory, sessionId),
  sessionOpenProjectFolder: (directory) =>
    ipcRenderer.invoke(IPC.sessionOpenProjectFolder, directory),
  sessionRemoveRecentProject: (directory) =>
    ipcRenderer.invoke(IPC.sessionRemoveRecentProject, directory),
  sessionGitHead: (directory) => ipcRenderer.invoke(IPC.sessionGitHead, directory),
  sessionGitChanges: (composerId, live) =>
    ipcRenderer.invoke(IPC.sessionGitChanges, composerId, live),
  sessionGitDiff: (composerId, request) =>
    ipcRenderer.invoke(IPC.sessionGitDiff, composerId, request),
  sessionStageGit: (composerId, selection) =>
    ipcRenderer.invoke(IPC.sessionStageGit, composerId, selection),
  sessionPreviewGitCommit: (composerId, selections) =>
    ipcRenderer.invoke(IPC.sessionPreviewGitCommit, composerId, selections),
  sessionCommitGit: (composerId, token, message) =>
    ipcRenderer.invoke(IPC.sessionCommitGit, composerId, token, message),
  sessionGitBranches: (composerId) => ipcRenderer.invoke(IPC.sessionGitBranches, composerId),
  sessionGitWorktrees: (composerId) => ipcRenderer.invoke(IPC.sessionGitWorktrees, composerId),
  sessionCreateGitWorktree: (composerId, request) =>
    ipcRenderer.invoke(IPC.sessionCreateGitWorktree, composerId, request),
  sessionOpenGitWorktree: (composerId, id) =>
    ipcRenderer.invoke(IPC.sessionOpenGitWorktree, composerId, id),
  sessionPreviewGitWorktree: (composerId, id) =>
    ipcRenderer.invoke(IPC.sessionPreviewGitWorktree, composerId, id),
  sessionApplyGitWorktree: (composerId, token, action) =>
    ipcRenderer.invoke(IPC.sessionApplyGitWorktree, composerId, token, action),
  sessionPreviewWorktreeArchive: (id) => ipcRenderer.invoke(IPC.sessionPreviewWorktreeArchive, id),
  sessionSwitchGitBranch: (composerId, token, request) =>
    ipcRenderer.invoke(IPC.sessionSwitchGitBranch, composerId, token, request),
  sessionPreviewGitPush: (composerId) => ipcRenderer.invoke(IPC.sessionPreviewGitPush, composerId),
  sessionPushGit: (composerId, token) => ipcRenderer.invoke(IPC.sessionPushGit, composerId, token),
  sessionPreviewGitPullRequest: (composerId) =>
    ipcRenderer.invoke(IPC.sessionPreviewGitPullRequest, composerId),
  sessionCreateGitPullRequest: (composerId, token, draft) =>
    ipcRenderer.invoke(IPC.sessionCreateGitPullRequest, composerId, token, draft),
  sessionGitCheckpointDiff: (composerId, id, path) =>
    ipcRenderer.invoke(IPC.sessionGitCheckpointDiff, composerId, id, path),
  sessionPreviewGitRollback: (composerId, selection) =>
    ipcRenderer.invoke(IPC.sessionPreviewGitRollback, composerId, selection),
  sessionApplyGitRollback: (composerId, token) =>
    ipcRenderer.invoke(IPC.sessionApplyGitRollback, composerId, token),
  sessionOpenGitLine: (composerId, request, line) =>
    ipcRenderer.invoke(IPC.sessionOpenGitLine, composerId, request, line),
  sessionOpenWorkspaceFile: (composerId, reference, line) =>
    ipcRenderer.invoke(IPC.sessionOpenWorkspaceFile, composerId, reference, line),
  sessionLoad: (id, record) => ipcRenderer.invoke(IPC.sessionLoad, id, record),
  sessionRename: (id: string, title: string) =>
    ipcRenderer.invoke(IPC.sessionRename, id, title) as Promise<SessionMeta[]>,
  sessionDelete: (id: string) => ipcRenderer.invoke(IPC.sessionDelete, id),
  sessionPin: (id: string, pinned: boolean) =>
    ipcRenderer.invoke(IPC.sessionPin, id, pinned) as Promise<SessionMeta[]>,
  sessionArchive: (id: string, archived: boolean) =>
    ipcRenderer.invoke(IPC.sessionArchive, id, archived),
  sessionUnread: (id: string, unread: boolean) =>
    ipcRenderer.invoke(IPC.sessionUnread, id, unread) as Promise<SessionMeta[]>,
  sessionFork: (id: string) => ipcRenderer.invoke(IPC.sessionFork, id) as Promise<SessionMeta[]>,
  sessionBranchMessage: (id, messageId, action) =>
    ipcRenderer.invoke(IPC.sessionBranchMessage, id, messageId, action),
  sessionPreviewMessageRollback: (id, messageId) =>
    ipcRenderer.invoke(IPC.sessionPreviewMessageRollback, id, messageId),
  sessionApplyMessageRollback: (id, token) =>
    ipcRenderer.invoke(IPC.sessionApplyMessageRollback, id, token),
  sessionCopy: (id: string) => ipcRenderer.invoke(IPC.sessionCopy, id) as Promise<string>,
  sessionSearch: (query, project) => ipcRenderer.invoke(IPC.sessionSearch, query, project),
  sessionExportMarkdown: (id, locale) => ipcRenderer.invoke(IPC.sessionExportMarkdown, id, locale),
  sessionPersona: (id: string, persona: string | null) =>
    ipcRenderer.invoke(IPC.sessionPersona, id, persona),
  sessionInstructionSources: (composerId) =>
    ipcRenderer.invoke(IPC.sessionInstructionSources, composerId),
  sessionProjectConfig: (composerId) => ipcRenderer.invoke(IPC.sessionProjectConfig, composerId),
  sessionSetProjectTrust: (composerId, directory, revision) =>
    ipcRenderer.invoke(IPC.sessionSetProjectTrust, composerId, directory, revision),
  sessionPreviewMemory: (composerId, directory, scope, text) =>
    ipcRenderer.invoke(IPC.sessionPreviewMemory, composerId, directory, scope, text),
  sessionSaveMemory: (composerId, token) =>
    ipcRenderer.invoke(IPC.sessionSaveMemory, composerId, token),
  sessionUndoMemory: (composerId, token) =>
    ipcRenderer.invoke(IPC.sessionUndoMemory, composerId, token),
  sessionFileDiff: (id, changeId) => ipcRenderer.invoke(IPC.sessionFileDiff, id, changeId),
  sessionUndoFileChange: (id, changeId) =>
    ipcRenderer.invoke(IPC.sessionUndoFileChange, id, changeId),
  sessionVerification: (id) => ipcRenderer.invoke(IPC.sessionVerification, id),
  sessionSetAfterTurnVerification: (id, directory, config) =>
    ipcRenderer.invoke(IPC.sessionSetAfterTurnVerification, id, directory, config),
  sessionRepairVerification: (id, runId, locale) =>
    ipcRenderer.invoke(IPC.sessionRepairVerification, id, runId, locale),
  sessionVerificationRun: (id, runId) => ipcRenderer.invoke(IPC.sessionVerificationRun, id, runId),
  sessionStartVerification: (id, request) =>
    ipcRenderer.invoke(IPC.sessionStartVerification, id, request),
  sessionStopVerification: (id, runId) =>
    ipcRenderer.invoke(IPC.sessionStopVerification, id, runId),
  sessionRerunVerification: (id, runId) =>
    ipcRenderer.invoke(IPC.sessionRerunVerification, id, runId),
  sessionTerminals: (id) => ipcRenderer.invoke(IPC.sessionTerminals, id),
  sessionOpenTerminal: (id, directory, size) =>
    ipcRenderer.invoke(IPC.sessionOpenTerminal, id, directory, size),
  sessionTerminalOutput: (id, terminalId) =>
    ipcRenderer.invoke(IPC.sessionTerminalOutput, id, terminalId),
  sessionWriteTerminal: (id, terminalId, data) =>
    ipcRenderer.invoke(IPC.sessionWriteTerminal, id, terminalId, data),
  sessionResizeTerminal: (id, terminalId, size) =>
    ipcRenderer.invoke(IPC.sessionResizeTerminal, id, terminalId, size),
  sessionStopTerminal: (id, terminalId) =>
    ipcRenderer.invoke(IPC.sessionStopTerminal, id, terminalId),
  onTerminalEvent: (callback) => {
    const listener = (_event: unknown, event: TerminalEvent): void => callback(event);
    ipcRenderer.on(TERMINAL_EVENT_CHANNEL, listener);
    return () => ipcRenderer.removeListener(TERMINAL_EVENT_CHANNEL, listener);
  },
  settingsGet: () => ipcRenderer.invoke(IPC.settingsGet),
  settingsUsageReport: () => ipcRenderer.invoke(IPC.settingsUsageReport),
  settingsDesktopBackground: () => ipcRenderer.invoke(IPC.settingsDesktopBackground),
  settingsSetDesktopBackground: (setting, enabled) =>
    ipcRenderer.invoke(IPC.settingsSetDesktopBackground, setting, enabled),
  settingsSave: (input: SettingsInput) => ipcRenderer.invoke(IPC.settingsSave, input),
  settingsSetProjectHooks: (directory, shell, commands) =>
    ipcRenderer.invoke(IPC.settingsSetProjectHooks, directory, shell, commands),
  settingsSetPromptTemplates: (templates) =>
    ipcRenderer.invoke(IPC.settingsSetPromptTemplates, templates),
  settingsSetLogLevel: (level) => ipcRenderer.invoke(IPC.settingsSetLogLevel, level),
  settingsSetNotificationsEnabled: (enabled) =>
    ipcRenderer.invoke(IPC.settingsSetNotificationsEnabled, enabled),
  settingsSetAutoDownloadUpdates: (enabled) =>
    ipcRenderer.invoke(IPC.settingsSetAutoDownloadUpdates, enabled),
  settingsSetExternalEditor: (editor) => ipcRenderer.invoke(IPC.settingsSetExternalEditor, editor),
  settingsSelectModel: (providerId, modelId) =>
    ipcRenderer.invoke(IPC.settingsSelectModel, providerId, modelId),
  settingsSetThinkingLevel: (level) => ipcRenderer.invoke(IPC.settingsSetThinkingLevel, level),
  settingsRevokeToolRule: (rule) => ipcRenderer.invoke(IPC.settingsRevokeToolRule, rule),
  settingsDismissRecovery: () => ipcRenderer.invoke(IPC.settingsDismissRecovery),
  mcpList: () => ipcRenderer.invoke(IPC.settingsMcpList),
  mcpSave: (input) => ipcRenderer.invoke(IPC.settingsMcpSave, input),
  mcpReconnect: (id) => ipcRenderer.invoke(IPC.settingsMcpReconnect, id),
  mcpOAuthStart: (target, requestId, locale) =>
    ipcRenderer.invoke(IPC.settingsMcpOAuthStart, target, requestId, locale),
  mcpOAuthCancel: (requestId) => ipcRenderer.invoke(IPC.settingsMcpOAuthCancel, requestId),
  mcpOAuthSignOut: (target) => ipcRenderer.invoke(IPC.settingsMcpOAuthSignOut, target),
  mcpRemove: (id) => ipcRenderer.invoke(IPC.settingsMcpRemove, id),
  pickImportDirectory: (locale) => ipcRenderer.invoke(IPC.settingsPickImportDirectory, locale),
  previewExternalImport: (kind, project) =>
    ipcRenderer.invoke(IPC.settingsPreviewExternalImport, kind, project),
  importExternal: (kind, project, selectedIds) =>
    ipcRenderer.invoke(IPC.settingsImportExternal, kind, project, selectedIds),
  importedPlugins: () => ipcRenderer.invoke(IPC.settingsImportedPlugins),
  toggleImportedPlugin: (id, enabled) =>
    ipcRenderer.invoke(IPC.settingsToggleImportedPlugin, id, enabled),
  pickPluginPackage: (kind, locale) =>
    ipcRenderer.invoke(IPC.settingsPickPluginPackage, kind, locale),
  previewPluginPackage: (source) => ipcRenderer.invoke(IPC.settingsPreviewPluginPackage, source),
  installPluginPackage: (source, token) =>
    ipcRenderer.invoke(IPC.settingsInstallPluginPackage, source, token),
  uninstallPlugin: (id) => ipcRenderer.invoke(IPC.settingsUninstallPlugin, id),
  pluginMarketplaces: () => ipcRenderer.invoke(IPC.settingsPluginMarketplaces),
  browsePluginMarketplace: (location, remember) =>
    ipcRenderer.invoke(IPC.settingsBrowsePluginMarketplace, location, remember),
  removePluginMarketplace: (location) =>
    ipcRenderer.invoke(IPC.settingsRemovePluginMarketplace, location),
  searchMcpRegistry: (query, cursor) =>
    cursor === undefined
      ? ipcRenderer.invoke(IPC.settingsSearchMcpRegistry, query)
      : ipcRenderer.invoke(IPC.settingsSearchMcpRegistry, query, cursor),
  pickWorkingDirectory: (locale: Locale) =>
    ipcRenderer.invoke(IPC.settingsPickWorkingDirectory, locale),
  skillsList: (composerId) =>
    ipcRenderer.invoke(IPC.skillsList, composerId) as Promise<SkillMeta[]>,
  skillsRead: (composerId, id, directory) =>
    ipcRenderer.invoke(IPC.skillsRead, composerId, id, directory) as Promise<string>,
  skillsDelete: (composerId, id, directory) =>
    ipcRenderer.invoke(IPC.skillsDelete, composerId, id, directory) as Promise<SkillMeta[]>,
  skillsImport: (locale, composerId) =>
    ipcRenderer.invoke(IPC.skillsImport, locale, composerId) as Promise<SkillMeta[] | null>,
  skillsToggle: (composerId, id, enabled) =>
    ipcRenderer.invoke(IPC.skillsToggle, composerId, id, enabled) as Promise<SkillMeta[]>,
  modelCatalog: (ref: string | ProviderInput) =>
    ipcRenderer.invoke(IPC.settingsModelCatalog, ref) as Promise<ModelCatalogEntry[]>,
  testProvider: (ref: string | ProviderInput) =>
    ipcRenderer.invoke(IPC.settingsTestProvider, ref) as Promise<ProviderTestResult>,
  permissionRespond: (run, requestId, decision) =>
    ipcRenderer.invoke(IPC.toolPermissionRespond, run, requestId, decision),
  projectTrustRespond: (run, requestId, decision) =>
    ipcRenderer.invoke(IPC.toolProjectTrustRespond, run, requestId, decision),
  onAgentEvent: (callback: (event: UiAgentEvent) => void) => {
    const listener = (_event: unknown, event: UiAgentEvent): void => callback(event);
    ipcRenderer.on(AGENT_EVENT_CHANNEL, listener);
    return () => ipcRenderer.removeListener(AGENT_EVENT_CHANNEL, listener);
  },
};

contextBridge.exposeInMainWorld("pi", api);
