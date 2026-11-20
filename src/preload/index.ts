// @env node
import { contextBridge, ipcRenderer } from "electron";
import type { PiApi } from "@shared/api";
import type {
  Locale,
  MenuAction,
  ModelCatalogEntry,
  OpenPathTarget,
  PermissionDecision,
  PingRequest,
  ProviderInput,
  ProviderTestResult,
  SessionMeta,
  SettingsInput,
  SkillMeta,
  ThemeSetting,
  UiAgentEvent,
  UpdateStatus,
} from "@shared/contract";
import { AGENT_EVENT_CHANNEL, IPC, UPDATE_STATUS_CHANNEL } from "@shared/contract";

const api: PiApi = {
  ping: (request: PingRequest) => ipcRenderer.invoke(IPC.ping, request),
  runAgentSmoke: () => ipcRenderer.invoke(IPC.runAgentSmoke),
  getAppInfo: () => ipcRenderer.invoke(IPC.appInfo),
  menuAction: (action: MenuAction) => ipcRenderer.invoke(IPC.menuAction, action),
  openPath: (target: OpenPathTarget) => ipcRenderer.invoke(IPC.appOpenPath, target),
  setTitlebarTheme: (theme: ThemeSetting) => ipcRenderer.invoke(IPC.appSetTitlebarTheme, theme),
  getUpdateStatus: () => ipcRenderer.invoke(IPC.appGetUpdateStatus),
  checkForUpdates: () => ipcRenderer.invoke(IPC.appCheckForUpdates),
  installUpdate: () => ipcRenderer.invoke(IPC.appInstallUpdate),
  onUpdateStatus: (callback) => {
    const listener = (_event: unknown, status: UpdateStatus): void => callback(status);
    ipcRenderer.on(UPDATE_STATUS_CHANNEL, listener);
    return () => ipcRenderer.removeListener(UPDATE_STATUS_CHANNEL, listener);
  },
  getSnapshot: () => ipcRenderer.invoke(IPC.agentGetSnapshot),
  agentPrompt: (input, referenceDirectory) =>
    ipcRenderer.invoke(IPC.agentPrompt, input, referenceDirectory),
  searchWorkspace: (query) => ipcRenderer.invoke(IPC.agentSearchWorkspace, query),
  previewWorkspaceReference: (reference) =>
    ipcRenderer.invoke(IPC.agentPreviewWorkspaceReference, reference),
  agentAbort: () => ipcRenderer.invoke(IPC.agentAbort),
  clearQueue: () => ipcRenderer.invoke(IPC.agentClearQueue),
  sessionNew: () => ipcRenderer.invoke(IPC.sessionNew),
  sessionLoad: (id: string) => ipcRenderer.invoke(IPC.sessionLoad, id),
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
  sessionCopy: (id: string) => ipcRenderer.invoke(IPC.sessionCopy, id) as Promise<string>,
  sessionPersona: (id: string, persona: string | null) =>
    ipcRenderer.invoke(IPC.sessionPersona, id, persona),
  sessionFileDiff: (id, changeId) => ipcRenderer.invoke(IPC.sessionFileDiff, id, changeId),
  sessionUndoFileChange: (id, changeId) =>
    ipcRenderer.invoke(IPC.sessionUndoFileChange, id, changeId),
  settingsGet: () => ipcRenderer.invoke(IPC.settingsGet),
  settingsSave: (input: SettingsInput) => ipcRenderer.invoke(IPC.settingsSave, input),
  settingsSetLogLevel: (level) => ipcRenderer.invoke(IPC.settingsSetLogLevel, level),
  settingsSelectModel: (providerId, modelId) =>
    ipcRenderer.invoke(IPC.settingsSelectModel, providerId, modelId),
  settingsSetThinkingLevel: (level) => ipcRenderer.invoke(IPC.settingsSetThinkingLevel, level),
  mcpList: () => ipcRenderer.invoke(IPC.settingsMcpList),
  mcpSave: (input) => ipcRenderer.invoke(IPC.settingsMcpSave, input),
  mcpReconnect: (id) => ipcRenderer.invoke(IPC.settingsMcpReconnect, id),
  mcpRemove: (id) => ipcRenderer.invoke(IPC.settingsMcpRemove, id),
  pickImportDirectory: (locale) => ipcRenderer.invoke(IPC.settingsPickImportDirectory, locale),
  previewExternalImport: (kind, project) =>
    ipcRenderer.invoke(IPC.settingsPreviewExternalImport, kind, project),
  importExternal: (kind, project, selectedIds) =>
    ipcRenderer.invoke(IPC.settingsImportExternal, kind, project, selectedIds),
  importedPlugins: () => ipcRenderer.invoke(IPC.settingsImportedPlugins),
  toggleImportedPlugin: (id, enabled) =>
    ipcRenderer.invoke(IPC.settingsToggleImportedPlugin, id, enabled),
  pickWorkingDirectory: (locale: Locale) =>
    ipcRenderer.invoke(IPC.settingsPickWorkingDirectory, locale),
  skillsList: () => ipcRenderer.invoke(IPC.skillsList) as Promise<SkillMeta[]>,
  skillsImport: (locale: Locale) =>
    ipcRenderer.invoke(IPC.skillsImport, locale) as Promise<SkillMeta[] | null>,
  skillsToggle: (id: string, enabled: boolean) =>
    ipcRenderer.invoke(IPC.skillsToggle, id, enabled) as Promise<SkillMeta[]>,
  modelCatalog: (ref: string | ProviderInput) =>
    ipcRenderer.invoke(IPC.settingsModelCatalog, ref) as Promise<ModelCatalogEntry[]>,
  testProvider: (ref: string | ProviderInput) =>
    ipcRenderer.invoke(IPC.settingsTestProvider, ref) as Promise<ProviderTestResult>,
  permissionRespond: (requestId: string, decision: PermissionDecision) =>
    ipcRenderer.invoke(IPC.toolPermissionRespond, requestId, decision),
  onAgentEvent: (callback: (event: UiAgentEvent) => void) => {
    const listener = (_event: unknown, event: UiAgentEvent): void => callback(event);
    ipcRenderer.on(AGENT_EVENT_CHANNEL, listener);
    return () => ipcRenderer.removeListener(AGENT_EVENT_CHANNEL, listener);
  },
};

contextBridge.exposeInMainWorld("pi", api);
