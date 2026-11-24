// @env node
import { createHash } from "node:crypto";
import { homedir } from "node:os";
import { resolve } from "node:path";

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ToolResultMessage } from "@earendil-works/pi-ai";

import type { FailedRun, InterruptedRun } from "@shared/contract";

import type { RunCheckpoint } from "./types";

export function interruptedRunOf(
  sessionId: string,
  checkpoint: RunCheckpoint | undefined,
): InterruptedRun | undefined {
  if (checkpoint && !checkpoint.failure) {
    return { sessionId, runId: checkpoint.runId, workingDirectory: checkpoint.workingDirectory };
  }
}

export function failedRunOf(
  sessionId: string,
  checkpoint: RunCheckpoint | undefined,
): FailedRun | undefined {
  if (checkpoint?.failure) {
    return {
      sessionId,
      runId: checkpoint.runId,
      workingDirectory: checkpoint.workingDirectory,
      failure: checkpoint.failure,
    };
  }
}

export function completeToolResults(messages: AgentMessage[]): AgentMessage[] {
  const assistantIndex = messages.findLastIndex((message) => message.role === "assistant");
  const assistant = messages[assistantIndex];
  if (assistant?.role !== "assistant" || !Array.isArray(assistant.content)) return messages;

  const results = new Map<string, ToolResultMessage>();
  let end = assistantIndex + 1;
  for (; end < messages.length; end++) {
    const message = messages[end];
    if (message.role !== "toolResult") break;
    results.set(message.toolCallId, message);
  }
  const missing: ToolResultMessage[] = [];
  for (const call of assistant.content) {
    if (call.type !== "toolCall" || results.has(call.id)) continue;
    missing.push({
      role: "toolResult",
      toolCallId: call.id,
      toolName: call.name,
      content: [
        {
          type: "text",
          text: "Pilot was interrupted before this result was recorded. Its effects are unknown. Verify the current state before repeating the operation.",
        },
      ],
      isError: true,
      timestamp: assistant.timestamp,
    });
  }
  return missing.length
    ? [...messages.slice(0, end), ...missing, ...messages.slice(end)]
    : messages;
}

export function actionFingerprint(
  toolName: string,
  args: unknown,
  workingDirectory: string | undefined,
): string | undefined {
  if (!args || typeof args !== "object") return undefined;
  let parts: unknown[];
  if (toolName === "bash" && "command" in args && typeof args.command === "string") {
    parts = [args.command.trim()];
  } else {
    if (!("path" in args) || typeof args.path !== "string") return undefined;
    const absolute = resolve(workingDirectory ?? homedir(), args.path);
    const path = process.platform === "win32" ? absolute.toLowerCase() : absolute;
    if (toolName === "write_file" && "content" in args) {
      parts = [path, args.content];
    } else if (toolName === "edit_file" && "oldText" in args && "newText" in args) {
      parts = [path, args.oldText, args.newText, "replaceAll" in args && args.replaceAll === true];
    } else {
      return undefined;
    }
  }
  return createHash("sha256")
    .update(JSON.stringify([toolName, ...parts]))
    .digest("hex");
}
