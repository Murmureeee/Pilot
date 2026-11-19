// @env all
// 渲染层可用的 API 形状。preload 实现它，renderer 通过 window.pi 消费。
import type {
  AgentSmokeResult,
  AppInfo,
  Locale,
  MenuAction,
  ModelCatalogEntry,
  OpenPathTarget,
  PermissionDecision,
  PingRequest,
  PingResponse,
  ProviderInput,
  ProviderTestResult,
  PublicSettings,
  SessionMeta,
  SettingsInput,
  SkillMeta,
  Snapshot,
  ThemeSetting,
  UiAgentEvent,
  UpdateStatus,
} from "./contract";
import type { McpServerInfo, McpServerInput } from "./mcp";
import type {
  ExternalImportKind,
  ExternalImportPreview,
  ImportedPluginInfo,
  ImportReport,
} from "./imports";

export interface PiApi {
  ping(request: PingRequest): Promise<PingResponse>;
  runAgentSmoke(): Promise<AgentSmokeResult>;
  getAppInfo(): Promise<AppInfo>;
  /** 窗口级菜单动作（编辑/缩放/重载/全屏/关闭/退出），主进程白名单校验 */
  menuAction(action: MenuAction): Promise<void>;
  /** 打开数据目录（设置/会话），主进程白名单校验 */
  openPath(target: OpenPathTarget): Promise<void>;
  /** 同步原生标题栏（窗控按钮）颜色到主题 */
  setTitlebarTheme(theme: ThemeSetting): Promise<void>;
  getUpdateStatus(): Promise<UpdateStatus>;
  checkForUpdates(): Promise<UpdateStatus>;
  installUpdate(): Promise<void>;
  onUpdateStatus(callback: (status: UpdateStatus) => void): () => void;
  getSnapshot(): Promise<Snapshot>;
  agentPrompt(text: string): Promise<void>;
  agentAbort(): Promise<void>;
  /** 清空排队中的插话（steer + followUp） */
  clearQueue(): Promise<void>;
  sessionNew(): Promise<Snapshot>;
  sessionLoad(id: string): Promise<Snapshot>;
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
  /** 会话全文文本（复制到剪贴板用） */
  sessionCopy(id: string): Promise<string>;
  /** 会话级人设覆盖（null = 清除，回落全局） */
  sessionPersona(id: string, persona: string | null): Promise<void>;
  settingsGet(): Promise<PublicSettings>;
  settingsSave(input: SettingsInput): Promise<PublicSettings>;
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
  skillsList(): Promise<SkillMeta[]>;
  /** 导入技能目录：主进程弹目录选择框，取消返回 null */
  skillsImport(locale: Locale): Promise<SkillMeta[] | null>;
  /** 启停技能（持久化 settings.skillsEnabled），返回刷新后的列表 */
  skillsToggle(id: string, enabled: boolean): Promise<SkillMeta[]>;
  /** 模型目录浏览（FR-5.2）：ref = 已保存 provider id 或未保存草稿（FR-5.7 向导） */
  modelCatalog(ref: string | ProviderInput): Promise<ModelCatalogEntry[]>;
  /** Provider 连通性测试（FR-5.1）：最小流式探测 */
  testProvider(ref: string | ProviderInput): Promise<ProviderTestResult>;
  /** 对权限确认弹窗应答；requestId 来自 permission_request 事件 */
  permissionRespond(requestId: string, decision: PermissionDecision): Promise<void>;
  /** 订阅主进程事件流；返回退订函数 */
  onAgentEvent(callback: (event: UiAgentEvent) => void): () => void;
}
