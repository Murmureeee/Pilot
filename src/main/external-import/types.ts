// @env node
import type { ExternalImportItem, ImportIssue, ImportSource } from "@shared/imports";
import type { McpTransportConfig } from "@shared/mcp";

export type ConfigObject = Record<string, unknown>;

export interface SourcePlugin {
  key: string;
  name: string;
  version?: string;
  directory: string;
  workspace?: string;
  skills: string[];
  servers: ConfigObject;
  configFiles: Set<string>;
  partial: boolean;
}

export interface DiscoveredImport {
  skills: string[];
  servers: Map<string, { definition: unknown; workspace?: string }>;
  plugins: SourcePlugin[];
  issues: ImportIssue[];
}

export interface ImportLocations {
  home: string;
  codexHome: string;
  claudeHome: string;
  claudeConfig: string;
  workspace?: string;
  settingsDir: string;
  skillsDir: string;
}

export interface ImportedMcpConnection {
  source: ImportSource;
  transport: McpTransportConfig;
  cwd?: string;
  variables?: Record<string, string>;
  env?: [string, string][];
  envNames?: string[];
  headers?: [string, string][];
  headerVariables?: [string, string][];
  bearerVariable?: string;
  includeTools?: string[];
  excludeTools?: string[];
}

export interface ImportMcpContext {
  source: ImportSource;
  workspace?: string;
  plugin?: { original: string; installed: string; data?: string };
}

export interface ResolvedImportedMcp {
  transport: McpTransportConfig;
  cwd?: string;
  env?: Record<string, string>;
  headers?: Record<string, string>;
}

export interface PluginAssets {
  original: string;
  installed: string;
  data?: string;
  configFiles: ReadonlySet<string>;
}

export interface SkillImport {
  kind: "skill";
  item: ExternalImportItem;
  storageId: string;
  root: string;
  configFiles?: ReadonlySet<string>;
}

export interface ServerImport {
  kind: "mcp";
  item: ExternalImportItem;
  storageKey: string;
  connection: ImportedMcpConnection;
  assets?: PluginAssets;
  requiresOriginalApp: boolean;
}

interface PluginImport {
  kind: "plugin";
  item: ExternalImportItem;
  storageId: string;
  source: ImportSource;
  version?: string;
  skills: SkillImport[];
  servers: ServerImport[];
  partial: boolean;
}

export type ImportCandidate = SkillImport | ServerImport | PluginImport;

export interface ImportCatalogGroup {
  source: ImportSource;
  candidates: ImportCandidate[];
  issues: ImportIssue[];
}
