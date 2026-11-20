// @env node
import type { AssistantMessage, UserMessage } from "@earendil-works/pi-ai";
import type { UiUserPart } from "@shared/contract";

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
