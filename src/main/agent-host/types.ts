// @env node
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { AssistantMessage, ToolResultMessage, UserMessage } from "@earendil-works/pi-ai";
import type {
  ActiveRun,
  GitChangesView,
  PermissionDecision,
  PermissionRequest,
  SessionInstructionSources,
  SessionMeta,
  UiUserPart,
  VerificationTask,
} from "@shared/contract";
import type {
  GitCheckpointBase,
  GitCommandObservation,
  GitSnapshot,
  GitTaskCheckpoint,
} from "../workspace/types";
import type { PermissionManager } from "./permissions";

export interface RunningTask {
  state: ActiveRun;
  preparation: AbortController;
  permissions: PermissionManager;
  checkpoint: RunCheckpoint;
  initialMessage?: ReferencedUserMessage;
  finishedTools: Map<string, ToolResultMessage>;
  previousActions: ReadonlySet<string>;
  resumed: boolean;
  gitBaseline: Promise<GitSnapshot>;
  gitFilesBefore?: GitCheckpointBase;
  commandObservations: GitCommandObservation[];
  gitChangesAtEnd?: Promise<GitChangesView | null>;
  persistError?: unknown;
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
}

export interface SavedGitChanges {
  type: "pilot_git_changes";
  workingDirectory: string | null;
  view: GitChangesView;
  checkpoint?: GitTaskCheckpoint;
}

export interface SessionRecord {
  messages: AgentMessage[];
  checkpoint?: RunCheckpoint;
  gitChanges?: SavedGitChanges;
}

export interface AgentInstructions {
  prompt: string;
  sources: Omit<SessionInstructionSources, "running">;
}

export interface PendingPermission {
  request: PermissionRequest;
  resolve: (decision: PermissionDecision) => void;
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
  skillInstructions: string[];
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
