// @env node
import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { normalizeContext, type AssistantMessage } from "@earendil-works/pi-ai";

import {
  SESSION_TITLE_INPUT_CHARS,
  SESSION_TITLE_MAX_CHARS,
  SESSION_TITLE_MAX_TOKENS,
  SESSION_TITLE_PROMPT,
  SESSION_TITLE_TIMEOUT,
} from "./constants";
import { messageText } from "./session-store";
import type { TextModelRequest } from "./types";

function hasCompletedText(reply: AssistantMessage): boolean {
  return (
    reply.stopReason !== "error" &&
    reply.stopReason !== "aborted" &&
    reply.stopReason !== "toolUse" &&
    Boolean(messageText(reply).trim())
  );
}

export function firstCompletedReply(
  messages: readonly AgentMessage[],
): AssistantMessage | undefined {
  return messages.find(
    (message): message is AssistantMessage =>
      message.role === "assistant" && hasCompletedText(message),
  );
}

export async function requestSessionTitle(
  { model, stream, apiKey }: TextModelRequest,
  user: string,
  reply: AssistantMessage,
): Promise<string | undefined> {
  const signal = AbortSignal.timeout(SESSION_TITLE_TIMEOUT);
  const inputLimit = Math.min(SESSION_TITLE_INPUT_CHARS, Math.floor(model.contextWindow / 2));
  const maxTokens = Math.min(model.maxTokens, SESSION_TITLE_MAX_TOKENS);
  const response = await stream(
    model,
    normalizeContext({
      systemPrompt: SESSION_TITLE_PROMPT,
      messages: [
        {
          role: "user",
          timestamp: Date.now(),
          content: JSON.stringify({
            user: user.trim().slice(0, inputLimit),
            reply: messageText(reply).trim().slice(0, inputLimit),
          }),
        },
      ],
    }),
    { apiKey, signal, maxTokens, maxRetries: 0 },
  );
  const result = await response.result();
  if (signal.aborted || !hasCompletedText(result)) return;
  const line = messageText(result)
    .split(/\r?\n/)
    .find((part) => part.trim());
  const cleaned = line
    ?.trim()
    .replace(/^#+\s+|^[\x60"'“‘]+|[\x60"'”’]+$/gu, "")
    .trim();
  if (!cleaned) return;
  const redacted = apiKey ? cleaned.replaceAll(apiKey, "••••") : cleaned;
  return [...redacted].slice(0, SESSION_TITLE_MAX_CHARS).join("").trim();
}
