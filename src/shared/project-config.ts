// @env all
import type { AfterTurnVerification, ToolRule, VerificationKind } from "./contract";
import type { McpTransportConfig } from "./mcp";

export const PROJECT_CONFIG_FILE = ".pilot/config.json";

export type ProjectConfigIssueReason =
  | "unreadable"
  | "too-large"
  | "invalid-json"
  | "invalid-field"
  | "unsupported-server"
  | "unsupported-rule";

export interface ProjectConfigIssue {
  file: string;
  reason: ProjectConfigIssueReason;
  name?: string;
}

export interface ProjectMcpServerSummary {
  name: string;
  file: string;
  transport: McpTransportConfig;
  cwd?: string;
  envNames: string[];
  policy: "inherit" | "confirm";
}

export interface ProjectConfigSummary {
  directory: string;
  files: string[];
  mcpServers: ProjectMcpServerSummary[];
  toolRules: ToolRule[];
  verification: Partial<Record<VerificationKind, string>>;
  afterTurn?: AfterTurnVerification;
  issues: ProjectConfigIssue[];
}

export interface ProjectTrustRequest extends ProjectConfigSummary {
  type: "project_trust_request";
  requestId: string;
  trust: "untrusted" | "changed";
}

export type ProjectTrustDecision = "trust" | "skip";

export type ProjectTrustState = "not-needed" | "trusted" | "changed" | "untrusted";

export interface ProjectConfigInfo extends ProjectConfigSummary {
  trust: ProjectTrustState;
  hasSavedTrust: boolean;
  revision: string;
}
