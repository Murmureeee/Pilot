// @env node
import type {
  AfterTurnVerification,
  ApprovalMode,
  CommandShell,
  ExternalEditor,
  LogLevel,
  PromptTemplate,
  ProviderFields,
  SessionModelSelection,
  ThinkingLevel,
  ToolRule,
} from "../../shared/contract";
import type { PluginMarketplaceSource } from "../../shared/discovery";
import type { ImportedPluginFields, InstalledPluginPackage } from "../../shared/imports";
import type { McpOAuthClient, McpServerFields, McpTransportConfig } from "../../shared/mcp";
import type { ImportedMcpConnection } from "../external-import/types";

export interface ProviderConfig extends ProviderFields {
  apiKey?: string;
}

export interface McpServerConfig extends McpServerFields {
  transport: McpTransportConfig;
  encryptedEnv?: string;
  encryptedHeaders?: string;
  encryptedImport?: string;
  importKey?: string;
  oauthClient?: McpOAuthClient;
  /** 项目声明的服务只保存在内存中。 */
  project?: { directory: string; file: string; connection: ImportedMcpConnection };
}

interface McpOAuthCredential {
  binding: string;
  encryptedState: string;
  project?: string;
}

interface ProjectTrustRecord {
  fingerprint: string;
  trustedAt: number;
}

export interface ImportedPlugin extends ImportedPluginFields {
  skillIds: string[];
  serverIds: string[];
  managed?: InstalledPluginPackage;
}

export interface Settings {
  providers: ProviderConfig[];
  activeProviderId: string;
  auxiliaryModel?: SessionModelSelection;
  toolRules?: ToolRule[];
  approvalMode?: ApprovalMode;
  thinkingLevel?: ThinkingLevel;
  thinkingLevels?: ThinkingLevel[];
  workingDirectory?: string;
  commandShell?: CommandShell;
  externalEditor?: ExternalEditor;
  logLevel?: LogLevel;
  notificationsEnabled?: boolean;
  autoDownloadUpdates?: boolean;
  persona?: string;
  promptTemplates?: PromptTemplate[];
  afterTurnVerification?: Record<string, AfterTurnVerification | null>;
  projectTrust?: Record<string, ProjectTrustRecord>;
  skillsEnabled?: string[];
  mcpServers?: McpServerConfig[];
  mcpOAuth?: Record<string, McpOAuthCredential>;
  importedPlugins?: ImportedPlugin[];
  pluginMarketplaces?: PluginMarketplaceSource[];
  /** 用户在界面确认后清除。 */
  recoveredFrom?: string;
  /** 只在内存中保留，供用户修复文件访问后重试。 */
  recoveryBlocked?: string;
}
