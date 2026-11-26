// @env node
import type { StreamFn } from "@earendil-works/pi-agent-core";
import {
  createAssistantMessageEventStream,
  fauxAssistantMessage,
  fauxText,
  getCurrentSystemPrompt,
  type AssistantMessageEventStream,
} from "@earendil-works/pi-ai";

import { SESSION_TITLE_PROMPT } from "../src/main/agent-host/constants";

export function fixtureTitle(
  context: Parameters<StreamFn>[1],
): AssistantMessageEventStream | undefined {
  if (getCurrentSystemPrompt(context.messages) !== SESSION_TITLE_PROMPT) return;
  const stream = createAssistantMessageEventStream();
  stream.end(fauxAssistantMessage([fauxText("Fixture conversation")]));
  return stream;
}
