// @env node
import type { VerificationKind } from "@shared/contract";
import type {
  ProjectConfigIssue,
  ProjectMcpServerSummary,
  ProjectTrustRequest,
} from "@shared/project-config";

import type { ImportedMcpConnection } from "../external-import/types";

export interface ProjectMcpServer extends ProjectMcpServerSummary {
  connection: ImportedMcpConnection;
}

export type ProjectRuleEntry =
  | { tool: "bash"; command: string[] }
  | { tool: "write_file" | "edit_file"; path: string }
  | { tool: string; domain: string };

export interface ProjectConfig {
  directory: string;
  files: string[];
  servers: ProjectMcpServer[];
  rules: ProjectRuleEntry[];
  verification: Partial<Record<VerificationKind, string>>;
  afterTurn?: VerificationKind;
  issues: ProjectConfigIssue[];
  fingerprint: string;
}

export interface PendingProjectTrust {
  request: ProjectTrustRequest;
  config: ProjectConfig;
  resolve: (config?: ProjectConfig) => void;
}
