// @env node
import type { AssistantMessage, UserMessage } from "@earendil-works/pi-ai";
import type {
  ActiveRun,
  PermissionDecision,
  PermissionRequest,
  SessionMeta,
  UiUserPart,
} from "@shared/contract";
import type { PermissionManager } from "./permissions";

export interface RunningTask {
  state: ActiveRun;
  preparation: AbortController;
  permissions: PermissionManager;
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
