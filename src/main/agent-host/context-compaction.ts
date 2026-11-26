// @env node
import { randomUUID } from "node:crypto";

import type { AgentMessage, StreamFn } from "@earendil-works/pi-agent-core";
import {
  getCurrentSystemMessage,
  normalizeContext,
  type Api,
  type AssistantMessage,
  type Message,
  type Model,
  type Usage,
} from "@earendil-works/pi-ai";
import { estimateContextTokens, estimateMessageTokens } from "@earendil-works/pi-ai/utils/estimate";

import type { ContextCompaction, Snapshot } from "@shared/contract";

import {
  COMPACTION_REFERENCE_LIMIT,
  COMPACTION_SUMMARY_FAILURE,
  COMPACTION_SUMMARY_MAX_TOKENS,
  COMPACTION_SUMMARY_PROMPT,
  COMPACTION_TOOL_OUTPUT_MAX_CHARS,
  CONTEXT_COMPACTION_RATIO,
  CONTEXT_RETAIN_RATIO,
} from "./constants";
import { messageText } from "./session-store";
import { PLAN_TOOL_NAME } from "./tools/constants";
import { readPlanSteps } from "./tools/plan";
import type { ReferencedUserMessage, SavedCompaction, TextModelRequest } from "./types";

export function compactionMarker({
  id,
  position,
  summary,
  trimmedTools,
}: SavedCompaction): ContextCompaction {
  return { id, position, summary, trimmedTools };
}

function clip(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const side = Math.max(1, Math.floor((limit - 64) / 2));
  return `${text.slice(0, side)}\n[${text.length - side * 2} characters omitted from context]\n${text.slice(-side)}`;
}

function retainedDetails(messages: readonly AgentMessage[]): string {
  const planResult = messages.findLast(
    (message) =>
      message.role === "toolResult" && message.toolName === PLAN_TOOL_NAME && !message.isError,
  );
  const plan = planResult?.role === "toolResult" ? readPlanSteps(planResult.details) : undefined;
  const references = new Set<string>();
  for (
    let index = messages.length - 1;
    index >= 0 && references.size < COMPACTION_REFERENCE_LIMIT;
    index--
  ) {
    const message = messages[index];
    if (message.role !== "user") continue;
    for (const part of (message as ReferencedUserMessage).pilotReference?.parts ?? []) {
      if (part.type === "mention" && part.kind !== "skill") {
        references.add(part.workingDirectory ? `${part.id} (${part.workingDirectory})` : part.id);
        if (references.size >= COMPACTION_REFERENCE_LIMIT) break;
      }
    }
  }
  return [
    plan?.length
      ? "Current plan\n" + plan.map(({ status, title }) => `- [${status}] ${title}`).join("\n")
      : "",
    references.size
      ? "Recent workspace references\n" + [...references].map((path) => "- " + path).join("\n")
      : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export function compactedContext(
  messages: Message[],
  record?: SavedCompaction,
  original: readonly AgentMessage[] = messages,
): Message[] {
  if (!record) return messages;
  const system = getCurrentSystemMessage(messages);
  const tail = messages.slice(record.cutoff).flatMap((message, offset) => {
    if (message.role === "system") return [];
    if (message.role !== "toolResult" || record.cutoff + offset >= record.trimBefore)
      return [message];
    const content = message.content.map((part) =>
      part.type === "text" ? { ...part, text: clip(part.text, record.toolOutputLimit) } : part,
    );
    return [{ ...message, content }];
  });
  const context: Message[] = system ? [{ ...system, timestamp: record.timestamp }] : [];
  if (record.summary) {
    const details = retainedDetails(original);
    context.push({
      role: "user",
      timestamp: record.timestamp,
      content: [
        "Earlier conversation summary for the ongoing task. Use the last user request as the current instruction.",
        record.summary,
        details,
      ]
        .filter(Boolean)
        .join("\n\n"),
    });
    // A long tool chain can be cut within one user turn. Keep the request for that turn.
    if (!tail.some(({ role }) => role === "user")) {
      const user = messages.findLast(({ role }) => role === "user");
      if (user) context.push(user);
    }
  }
  return [...context, ...tail];
}

function countTokens(messages: readonly Message[]): number {
  return messages.reduce((tokens, message) => tokens + estimateMessageTokens(message), 0);
}

export function contextSize(messages: Message[]): number {
  // Transcripts from older versions may omit usage on assistant messages.
  return messages.some((message) => message.role === "assistant" && !message.usage)
    ? countTokens(messages)
    : estimateContextTokens(messages).tokens;
}

function cutoffFor(messages: Message[], start: number, budget: number): number {
  let cutoff = messages.length;
  let tokens = 0;
  for (let index = messages.length - 1; index >= start; index--) {
    const message = messages[index];
    tokens += estimateMessageTokens(message);
    if (message.role !== "user" && message.role !== "assistant") continue;
    // Keep the latest message group whole, including the assistant call before its tool results.
    if (tokens > budget && cutoff < messages.length) break;
    cutoff = index;
  }
  return cutoff;
}

function historyText(message: Message, toolOutputLimit: number): string {
  const calls =
    message.role === "assistant"
      ? message.content
          .filter((block) => block.type === "toolCall")
          .map(({ name, arguments: args }) => `${name} ${JSON.stringify(args)}`)
      : [];
  const label = message.role === "toolResult" ? `tool ${message.toolName}` : message.role;
  const text = messageText(message);
  const content = message.role === "toolResult" ? clip(text, toolOutputLimit) : text;
  return `${label}\n${[content, ...calls].filter(Boolean).join("\n")}`;
}

function addUsage(total: Snapshot["usage"], input: Snapshot["usage"]): void {
  total.input += input.input;
  total.output += input.output;
  total.cacheRead += input.cacheRead;
  total.cacheWrite += input.cacheWrite ?? 0;
  total.costTotal += input.costTotal;
}

export function assistantUsage(usage: Usage): Snapshot["usage"] {
  return {
    input: usage.input,
    output: usage.output,
    cacheRead: usage.cacheRead ?? 0,
    cacheWrite: usage.cacheWrite ?? 0,
    costTotal: usage.cost?.total ?? 0,
  };
}

export function transcriptUsage(
  messages: readonly AgentMessage[],
  compactions: readonly SavedCompaction[],
): Snapshot["usage"] {
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costTotal: 0 };
  for (const message of messages) {
    if (message.role === "assistant" && message.usage)
      addUsage(usage, assistantUsage(message.usage));
  }
  for (const record of compactions) {
    if (record.usage) addUsage(usage, record.usage);
  }
  return usage;
}

async function summarizeHistory({
  model,
  stream,
  messages,
  previousSummary,
  focus,
  toolOutputLimit,
  signal,
  apiKey,
}: {
  model: Model<Api>;
  stream: StreamFn;
  messages: Message[];
  previousSummary: string;
  focus: string;
  toolOutputLimit: number;
  signal?: AbortSignal;
  apiKey?: string;
}): Promise<{ summary: string; usage: Snapshot["usage"] }> {
  const chunkLimit = Math.max(128, Math.floor(model.contextWindow * 1.3));
  const maxTokens = Math.min(
    model.maxTokens,
    COMPACTION_SUMMARY_MAX_TOKENS,
    Math.max(16, Math.floor(model.contextWindow / 10)),
  );
  const summaryLimit = Math.max(64, maxTokens * 3);
  const chunks: string[] = [];
  let batch = "";
  for (const message of messages) {
    if (message.role === "system") continue;
    const row = clip(historyText(message, toolOutputLimit), chunkLimit);
    if (batch && batch.length + row.length + 2 > chunkLimit) {
      chunks.push(batch);
      batch = "";
    }
    batch = batch ? batch + "\n\n" + row : row;
  }
  if (batch) chunks.push(batch);
  const usage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costTotal: 0 };
  let summary = previousSummary;
  for (const history of chunks) {
    signal?.throwIfAborted();
    const request = normalizeContext({
      systemPrompt: COMPACTION_SUMMARY_PROMPT,
      messages: [
        {
          role: "user",
          timestamp: Date.now(),
          content: [
            focus &&
              `Focus to retain\n${clip(focus, Math.max(64, Math.floor(model.contextWindow / 4)))}`,
            summary && `Previous summary\n${clip(summary, summaryLimit)}`,
            `Conversation history\n${history}`,
          ]
            .filter(Boolean)
            .join("\n\n"),
        },
      ],
    });
    let result: AssistantMessage;
    try {
      const response = await stream(model, request, { maxTokens, maxRetries: 0, signal, apiKey });
      result = await response.result();
    } catch (error) {
      signal?.throwIfAborted();
      throw new Error(COMPACTION_SUMMARY_FAILURE, { cause: error });
    }
    signal?.throwIfAborted();
    if (
      result.stopReason === "error" ||
      result.stopReason === "aborted" ||
      result.stopReason === "toolUse"
    )
      throw new Error(COMPACTION_SUMMARY_FAILURE);
    const text = messageText(result).trim();
    if (!text) throw new Error("模型未返回上下文摘要。请重试或更换模型。");
    summary = clip(apiKey ? text.replaceAll(apiKey, "••••") : text, summaryLimit);
    if (result.usage) addUsage(usage, assistantUsage(result.usage));
  }
  return { summary, usage };
}

export async function compactContext({
  messages,
  original,
  previous,
  model,
  stream,
  auxiliaryModel,
  force,
  focus,
  signal,
  apiKey,
}: {
  messages: Message[];
  original: AgentMessage[];
  previous?: SavedCompaction;
  model: Model<Api>;
  stream: StreamFn;
  auxiliaryModel?: TextModelRequest;
  force: boolean;
  focus: string;
  signal?: AbortSignal;
  apiKey?: string;
}): Promise<SavedCompaction | undefined> {
  const current = compactedContext(messages, previous, original);
  const threshold = model.contextWindow * CONTEXT_COMPACTION_RATIO;
  const currentTokens = countTokens(current);
  const start = previous?.cutoff ?? 0;
  const toolOutputLimit = Math.min(
    previous?.toolOutputLimit ?? COMPACTION_TOOL_OUTPUT_MAX_CHARS,
    Math.max(96, Math.floor(model.contextWindow * 0.3)),
  );
  const keepToolGroup = messages.findLastIndex(({ role }) => role === "assistant");
  const record: SavedCompaction = {
    type: "pilot_context_compaction",
    id: randomUUID(),
    position: messages.filter(({ role }) => role === "user" || role === "assistant").length,
    timestamp: Date.now(),
    cutoff: start,
    trimBefore: Math.max(previous?.trimBefore ?? 0, Math.max(0, keepToolGroup)),
    toolOutputLimit,
    summary: previous?.summary ?? "",
    trimmedTools: 0,
  };
  const clippedTokens = countTokens(compactedContext(messages, record, original));
  if (force || clippedTokens >= threshold || clippedTokens >= currentTokens) {
    const latestUser = messages.findLastIndex(({ role }) => role === "user");
    const boundary = cutoffFor(messages, start, model.contextWindow * CONTEXT_RETAIN_RATIO);
    const keep = force ? Math.max(latestUser, boundary) : boundary;
    const history = messages.slice(start, keep);
    if (keep < messages.length && history.some(({ role }) => role !== "system")) {
      const request = {
        messages: history,
        previousSummary: record.summary,
        focus,
        toolOutputLimit,
        signal,
      };
      const currentModel = { model, stream, apiKey };
      const result = await summarizeHistory({
        ...request,
        ...(auxiliaryModel ?? currentModel),
      }).catch((error: unknown) => {
        signal?.throwIfAborted();
        if (!auxiliaryModel) throw error;
        return summarizeHistory({ ...request, ...currentModel });
      });
      record.cutoff = keep;
      record.summary = result.summary;
      record.usage = result.usage;
    }
  }
  if (
    force &&
    countTokens(compactedContext(messages, record, original)) >= Math.min(threshold, currentTokens)
  ) {
    // An oversized current tool result can also be shortened while keeping its call intact.
    record.trimBefore = messages.length;
  }
  if (countTokens(compactedContext(messages, record, original)) >= currentTokens) return undefined;
  record.trimmedTools = messages
    .slice(record.cutoff, record.trimBefore)
    .filter(
      (message) =>
        message.role === "toolResult" &&
        message.content.some((part) => part.type === "text" && part.text.length > toolOutputLimit),
    ).length;
  return record;
}
