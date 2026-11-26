// @env node
import type {
  AfterTurnVerification,
  ApprovalMode,
  CommandShell,
  ExternalEditor,
  LogLevel,
  PromptTemplate,
  ProviderFields,
  ThinkingLevel,
  ToolRule,
} from "../../shared/contract";
import type { ImportedPluginFields } from "../../shared/imports";
import type { McpServerFields, McpTransportConfig } from "../../shared/mcp";

export interface ProviderConfig extends ProviderFields {
  apiKey?: string;
}

export interface McpServerConfig extends McpServerFields {
  transport: McpTransportConfig;
  encryptedEnv?: string;
  encryptedHeaders?: string;
  encryptedImport?: string;
  importKey?: string;
}

interface ImportedPlugin extends ImportedPluginFields {
  skillIds: string[];
  serverIds: string[];
}

export interface Settings {
  providers: ProviderConfig[];
  activeProviderId: string;
  toolRules?: ToolRule[];
  approvalMode?: ApprovalMode;
  thinkingLevel?: ThinkingLevel;
  thinkingLevels?: ThinkingLevel[];
  workingDirectory?: string;
  commandShell?: CommandShell;
  externalEditor?: ExternalEditor;
  logLevel?: LogLevel;
  notificationsEnabled?: boolean;
  persona?: string;
  promptTemplates?: PromptTemplate[];
  afterTurnVerification?: Record<string, AfterTurnVerification>;
  skillsEnabled?: string[];
  mcpServers?: McpServerConfig[];
  importedPlugins?: ImportedPlugin[];
  /** 用户在界面确认后清除。 */
  recoveredFrom?: string;
  /** 只在内存中保留，供用户修复文件访问后重试。 */
  recoveryBlocked?: string;
}
