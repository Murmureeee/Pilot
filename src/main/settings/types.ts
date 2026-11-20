// @env node
import type {
  ApprovalMode,
  CommandShell,
  LogLevel,
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
  logLevel?: LogLevel;
  persona?: string;
  skillsEnabled?: string[];
  mcpServers?: McpServerConfig[];
  importedPlugins?: ImportedPlugin[];
}
