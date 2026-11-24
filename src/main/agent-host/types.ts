// @env node
import type { Agent, AgentMessage, AgentTool } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, UserMessage } from "@earendil-works/pi-ai";

import type {
  GitChangesView,
  ContextCompaction,
  ModelFailure,
  ModelRetryProgress,
  PermissionDecision,
  PermissionRequest,
  SessionInstructionSources,
  SkillMeta,
  SessionMeta,
  Snapshot,
  ToolRule,
  UiAgentEvent,
  UiMessage,
  UiUserPart,
  VerificationTask,
} from "@shared/contract";

import type { Settings } from "../settings/types";
import type { GitCommitPlan, GitSnapshot, GitTaskCheckpoint } from "../workspace/types";
import type { McpManager } from "./mcp";
import type { SessionStore } from "./session-store";
import type { ToolEnvironment } from "./tools/types";

export interface HostDeps {
  store: SessionStore;
  getSettings: () => Settings;
  saveSettings: (settings: Settings) => void;
  broadcast: (event: UiAgentEvent) => void;
  onActivityChanged?: () => void;
  skillsDir: string;
  mcp: McpManager;
}

export interface AgentSessionView {
  messages: UiMessage[];
  nextId: number;
  error: string | null;
  usage: Snapshot["usage"];
  contextWindow: number | null;
  contextTokens: number;
}

export interface AgentRunOptions extends Pick<
  HostDeps,
  "store" | "mcp" | "broadcast" | "getSettings" | "saveSettings"
> {
  agent: Agent;
  sessionId: string;
  environment: ToolEnvironment;
  tools: AgentTool[];
  skills: readonly SkillMeta[];
  systemPrompt: string;
  view: AgentSessionView;
  sessionRules: ToolRule[];
  initialMessage?: ReferencedUserMessage;
  clearDraftFor?: string;
  compaction?: CompactionRequest;
  onStarted: () => void;
  onSessionUpdated: () => void;
  onFinished: () => void;
}

export type CompactionRequest = { mode: "manual"; focus: string } | { mode: "retry" };

export interface SavedCompaction extends ContextCompaction {
  type: "pilot_context_compaction";
  timestamp: number;
  cutoff: number;
  trimBefore: number;
  toolOutputLimit: number;
  usage?: Snapshot["usage"];
}

export interface RunCheckpoint {
  type: "pilot_run_checkpoint";
  runId: string;
  workingDirectory: string | null;
  startIndex: number;
  pending: ReferencedUserMessage[];
  actions: string[];
  gitBaseline?: GitSnapshot;
  task?: VerificationTask;
  failure?: ModelFailure;
}

export interface ModelRetryCallbacks {
  onRetry(progress: ModelRetryProgress | null): void;
  onFailure(failure: ModelFailure): void;
}

export interface SavedGitChanges {
  type: "pilot_git_changes";
  workingDirectory: string | null;
  view: GitChangesView;
  checkpoint?: GitTaskCheckpoint;
  snapshot?: GitSnapshot;
}

export interface GitCommitOperation {
  composerId: string;
  directory: string;
  token: string;
  plan: GitCommitPlan;
}

export interface SessionRecord {
  messages: AgentMessage[];
  checkpoint?: RunCheckpoint;
  gitChanges?: SavedGitChanges;
  compactions: SavedCompaction[];
}

export interface AgentInstructions {
  prompt: string;
  sources: Omit<SessionInstructionSources, "running">;
  skills: readonly SkillMeta[];
}

export interface PendingPermission {
  request: PermissionRequest;
  resolve: (decision: PermissionDecision) => void;
}

/** null 代表替换结果，其值不能用于匹配前缀。 */
export type ShellArgument = string | null;

export interface ShellCommand {
  args: ShellArgument[];
  pipeline: ShellPipeline;
}

export interface ShellPipeline {
  output?: ShellPipeline;
}

export interface SessionIndex {
  sessions: SessionMeta[];
  recentProjects?: string[];
}

export type TimedAssistantMessage = AssistantMessage & {
  pilotThinkingDurations?: Record<number, number>;
};

export interface PreparedPrompt {
  text: string;
  reference?: PromptReference;
}

interface PromptReference {
  context: string;
  parts: UiUserPart[];
}

export type ReferencedUserMessage = UserMessage & { pilotReference?: PromptReference };

export interface DisplayMention {
  offset: number;
  token: string;
  part: Extract<UiUserPart, { type: "mention" }>;
}
