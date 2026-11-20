// @env all
export type ImportSource = "codex" | "claude-code";
export type ExternalImportKind = "skill" | "plugin" | "mcp";

export interface ExternalImportItem {
  id: string;
  name: string;
  imported: boolean;
  plugin?: string;
  description?: string;
  transport?: "stdio" | "http";
  contents?: { skills: string[]; servers: string[]; partial: boolean };
}

export interface ExternalImportPreview {
  groups: { source: ImportSource; items: ExternalImportItem[]; issues: ImportIssue[] }[];
}

export interface ImportedPluginFields {
  id: string;
  source: ImportSource;
  name: string;
  version?: string;
  partial: boolean;
}

export interface ImportedPluginInfo extends ImportedPluginFields {
  skills: number;
  servers: number;
  enabled: "none" | "some" | "all";
}

export interface ImportIssue {
  name: string;
  reason: "read" | "copy" | "transport" | "connection" | "native" | "encryption";
}

export interface ImportReport {
  skills: number;
  plugins: number;
  servers: number;
  existing: number;
  issues: ImportIssue[];
  installedPlugins: ImportedPluginInfo[];
}
