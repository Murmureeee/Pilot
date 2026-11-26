// @env all
import type { PromptTemplate } from "./contract";

export type ImportSource = "codex" | "claude-code";
export type PluginFormat = ImportSource | "pi" | "skill";
export type ExternalImportKind = "skill" | "plugin" | "mcp";

export interface GitPluginSource {
  kind: "git";
  location: string;
  path?: string;
  ref?: string;
  sha?: string;
}

export type PluginPackageSource = GitPluginSource | { kind: "directory" | "zip"; location: string };

export interface PluginPackageFile {
  path: string;
  digest: string;
}

export interface PluginPackageChange {
  path: string;
  kind: "added" | "modified" | "removed";
  before?: string;
  after?: string;
}

export interface PluginPackagePreview {
  token: string;
  name: string;
  format: PluginFormat;
  version?: string;
  revision?: string;
  source: PluginPackageSource;
  skills: string[];
  templates: { name: string; path: string; text: string }[];
  scripts: string[];
  servers: { name: string; command: string; args: string[] }[];
  unsupported: string[];
  previous?: { version?: string; revision?: string; changes: PluginPackageChange[] };
  current: boolean;
}

export interface InstalledPluginPackage {
  source: PluginPackageSource;
  revision?: string;
  contentId: string;
  files: PluginPackageFile[];
  templates: PromptTemplate[];
  enabled: boolean;
}

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
  source: PluginFormat;
  name: string;
  version?: string;
  partial: boolean;
}

export interface ImportedPluginInfo extends ImportedPluginFields {
  skills: number;
  servers: number;
  templates?: number;
  packageSource?: PluginPackageSource;
  revision?: string;
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
