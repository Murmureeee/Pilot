// @env node
import type { Agent, AgentMessage, AgentTool, StreamFn } from "@earendil-works/pi-agent-core";
import type {
  Api,
  AssistantMessage,
  Model,
  ToolResultMessage,
  UserMessage,
} from "@earendil-works/pi-ai";

import type {
  ApprovalMode,
  AssistantTiming,
  ComposerDraft,
  GitChangesView,
  ContextCompaction,
  MessageRollbackPreview,
  ManagedWorktree,
  ModelFailure,
  ModelRetryProgress,
  PermissionDecision,
  PermissionFilePreview,
  PermissionRequest,
  ProjectInstructionSource,
  SessionInstructionSources,
  ScopedProjectInstructionSource,
  SkillMeta,
  SessionMeta,
  SessionSettings,
  SessionRunResult,
  Snapshot,
  SubtaskTrace,
  ToolRule,
  ToolApproval,
  UiAgentEvent,
  UiMessage,
  UiPart,
  UiUserPart,
  VerificationTask,
} from "@shared/contract";

import type { ProviderConfig, Settings } from "../settings/types";
import type { TerminalManager } from "../terminal";
import type { WebRequests } from "../web/types";
import type {
  GitBranchState,
  GitCheckpointFile,
  GitCommitPlan,
  GitFileState,
  GitPullRequestPlan,
  GitPushPlan,
  GitSnapshot,
  GitTaskCheckpoint,
  GitWorktree,
} from "../workspace/types";
import type { McpManager } from "./mcp";
import type { AgentRun } from "./run";
import type { SessionStore } from "./session-store";
import type { ToolEnvironment } from "./tools/types";

export interface NewChatDraft {
  id: string;
  draft: ComposerDraft;
  settings: SessionSettings;
  workingDirectory?: string;
}

export interface HostDeps {
  store: SessionStore;
  getSettings: () => Settings;
  saveSettings: (settings: Settings) => void;
  broadcast: (event: UiAgentEvent) => void;
  onActivityChanged?: () => void;
  onTurnCompleted?: (
    sessionId: string,
    directory: string,
    task: VerificationTask,
    projectFingerprint?: string,
  ) => void;
  skillsDir: string;
  mcp: McpManager;
  terminal?: TerminalManager;
  worktreesDir?: string;
  hasWorkspaceProcesses?: (directory: string) => boolean;
  request?: typeof globalThis.fetch;
  webRequests?: WebRequests;
}

export interface AgentSessionView {
  messages: UiMessage[];
  nextId: number;
  error: string | null;
  usage: Snapshot["usage"];
  contextWindow: number | null;
  contextTokens: number;
}

export interface SessionAgent {
  sessionId: string;
  agent: Agent;
  provider: ProviderConfig;
  instructions: AgentInstructions;
  environment: ToolEnvironment;
  tools: AgentTool[];
  view: AgentSessionView;
}

export interface RunningSession {
  run: AgentRun;
  agent: SessionAgent;
  workspace: string;
}

export interface WorktreeOperationPreview {
  composerId: string;
  token: string;
  worktree: ManagedWorktree;
  signature: string;
}

export interface TextModelRequest {
  model: Model<Api>;
  stream: StreamFn;
  apiKey?: string;
}

export interface AgentRunOptions extends Pick<
  HostDeps,
  | "store"
  | "mcp"
  | "terminal"
  | "broadcast"
  | "getSettings"
  | "saveSettings"
  | "request"
  | "webRequests"
> {
  agent: Agent;
  auxiliaryModel?: TextModelRequest;
  sessionId: string;
  environment: ToolEnvironment;
  tools: AgentTool[];
  instructions: AgentInstructions;
  view: AgentSessionView;
  sessionRules: ToolRule[];
  initialMessage?: ReferencedUserMessage;
  clearDraftFor?: string;
  compaction?: CompactionRequest;
  planning: boolean;
  approvedPlanMode?: ApprovalMode;
  settingsOnStart?: SessionSettings;
  onStarted: () => void;
  onSessionUpdated: () => void;
  onFinished: (completedTask?: VerificationTask) => void;
}

type CompactionRequest = { mode: "manual"; focus: string } | { mode: "retry" };

export interface SessionRunSettlement {
  task?: VerificationTask;
  result: Exclude<SessionRunResult, "interrupted">;
  messageRange?: Pick<SavedMessageTask, "startIndex" | "workingDirectory" | "workspace">;
  settings?: SessionSettings;
}

type MessageTaskWorkspace =
  | { kind: "git"; snapshot: Pick<GitWorktree, "root" | "head">; files: GitCheckpointFile[] }
  | { kind: "folder" }
  | { kind: "unknown" };

export interface SavedMessageTask {
  type: "pilot_message_task";
  task: VerificationTask;
  result: SessionRunSettlement["result"];
  startIndex: number;
  endIndex: number;
  workingDirectory: string | null;
  workspace: MessageTaskWorkspace;
}

export interface MessageRollbackFile {
  path: string;
  current: GitFileState;
  target: GitFileState;
  index?: string;
}

export interface MessageRollbackJournal {
  type: "pilot_message_rollback";
  directory: string;
  root: string;
  head?: string;
  files: MessageRollbackFile[];
}

export interface MessageHistory {
  tasks: SavedMessageTask[];
  rollback?: MessageRollbackJournal;
}

export interface MessageRollbackOperation {
  sessionId: string;
  token: string;
  messageId: string;
  revision: string;
}

export interface PreparedMessageRollback {
  endIndex: number;
  revision: string;
  preview: MessageRollbackPreview;
  journal?: MessageRollbackJournal;
}

export interface SavedCompaction extends ContextCompaction {
  type: "pilot_context_compaction";
  timestamp: number;
  usageModel?: { provider: string; model: string };
  usageProject?: string | null;
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
  approvals?: RecordedApproval[];
  gitBaseline?: GitSnapshot;
  task?: VerificationTask;
  failure?: ModelFailure;
  planApprovalMode?: "plan" | ApprovalMode;
}

export interface RecordedApproval {
  callId: string;
  approval: ToolApproval;
}

export type ApprovedToolResult = ToolResultMessage & { pilotApproval?: ToolApproval };

export interface SubtaskProgress {
  trace: SubtaskTrace;
  text?: string;
  usageDelta?: Snapshot["usage"];
}

export interface SubtaskToolOptions {
  parent: Agent;
  stream: StreamFn;
  tools: AgentTool[];
  projectDirectory?: string;
  signal: AbortSignal;
  report(callId: string, progress: SubtaskProgress): void;
}

export type ToolAccess =
  | { kind: "allow" }
  | { kind: "block" }
  | ({ kind: "ask" } & Pick<PermissionRequest, "command" | "commandDanger" | "rule" | "web">);

export type PermissionDetails = Pick<PermissionRequest, "file" | "position">;

export interface FileApprovalBaseline {
  path: string;
  before: string | null;
}

export interface FileApprovalReview {
  file: PermissionFilePreview;
  baseline?: FileApprovalBaseline;
}

export interface CheckpointAppend {
  type: "pilot_checkpoint_append";
  checkpoint: RunCheckpoint;
  messages: AgentMessage[];
  completedTool?: ToolResultMessage;
}

export interface TranscriptWriteState {
  messageCount: number;
  appendable: boolean;
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

export type GitBranchAction =
  | { kind: "branch"; plan: GitBranchState }
  | { kind: "push"; plan: GitPushPlan }
  | { kind: "pull-request"; plan: GitPullRequestPlan };

export type GitBranchOperation = Pick<GitCommitOperation, "composerId" | "directory" | "token"> &
  GitBranchAction;

export interface SessionRecord {
  messages: AgentMessage[];
  checkpoint?: RunCheckpoint;
  gitChanges?: SavedGitChanges;
  compactions: SavedCompaction[];
  messageHistory: MessageHistory;
}

export interface AgentInstructions {
  appPrompt: string;
  contextPrompt: string;
  projectDirectory?: string;
  sources: Omit<SessionInstructionSources, "running">;
  skills: readonly SkillMeta[];
}

export interface ProjectInstruction {
  source: ProjectInstructionSource;
  body?: string;
}

export type MemoryChange = { composerId: string; token: string } & (
  | { scope: "global"; before: string | undefined; after: string }
  | {
      scope: "project";
      directory: string;
      filename: string;
      before: GitFileState;
      after: NonNullable<GitFileState>;
    }
);

export interface ScopedProjectInstruction extends ScopedProjectInstructionSource {
  body?: string;
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
  worktrees?: ManagedWorktree[];
  sessions: SessionMeta[];
  recentProjects?: string[];
}

export interface TranscriptUsageSource {
  project: string | null;
  model: string | null;
  provider: string | null;
}

export type TimedAssistantMessage = AssistantMessage & {
  pilotHooks?: Extract<UiPart, { type: "tool" }>[];
  pilotThinkingDurations?: Record<number, number>;
  pilotTiming?: Required<AssistantTiming>;
  pilotUsageProject?: string | null;
  pilotUsageId?: string;
};

export interface PreparedPrompt {
  text: string;
  reference?: PromptReference;
}

interface PromptReference {
  context: string;
  parts: UiUserPart[];
}

export type ReferencedUserMessage = UserMessage & {
  pilotReference?: PromptReference;
  pilotImageNames?: string[];
  pilotPlanning?: true;
};

export interface DisplayMention {
  offset: number;
  token: string;
  part: Extract<UiUserPart, { type: "mention" }>;
}
