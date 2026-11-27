// @env node
import { createHash } from "node:crypto";
import { basename } from "node:path";
import { setImmediate } from "node:timers/promises";

import { RUN_SUBTASK_TOOL_NAME } from "../../shared/constants";
import type { Snapshot } from "../../shared/contract";
import type { UsageBreakdown, UsageReport } from "../../shared/usage";
import { accumulateUsage, assistantUsage } from "./context-compaction";
import type { SessionStore } from "./session-store";
import { readSubtaskTrace } from "./subtask-record";
import type { TimedAssistantMessage, TranscriptUsageSource } from "./types";

function emptyUsage(): Snapshot["usage"] {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costTotal: 0 };
}

function localDay(timestamp: number): string | null {
  const day = new Date(timestamp);
  if (!Number.isFinite(day.getTime())) return null;
  return [
    String(day.getFullYear()).padStart(4, "0"),
    String(day.getMonth() + 1).padStart(2, "0"),
    String(day.getDate()).padStart(2, "0"),
  ].join("-");
}

function add(
  rows: Map<string, UsageBreakdown>,
  key: string,
  label: string | null,
  usage: Snapshot["usage"],
  description?: string,
): void {
  let row = rows.get(key);
  if (!row) {
    row = { key, label, description, usage: emptyUsage() };
    rows.set(key, row);
  }
  accumulateUsage(row.usage, usage);
}

function assistantKey(message: TimedAssistantMessage): string {
  // Old forks already share these transcript fields, including PI's message timestamp.
  return (
    message.pilotUsageId ??
    createHash("sha256")
      .update(
        JSON.stringify([
          message.pilotTiming,
          message.timestamp,
          message.provider,
          message.model,
          message.content,
          message.usage,
        ]),
      )
      .digest("hex")
  );
}

export async function readUsageReport(store: SessionStore): Promise<UsageReport> {
  const total = emptyUsage();
  const days = new Map<string, UsageBreakdown>();
  const projects = new Map<string, UsageBreakdown>();
  const models = new Map<string, UsageBreakdown>();
  const seen = new Set<string>();
  let unreadableSessions = 0;

  const record = (
    id: string,
    timestamp: number,
    { project, model, provider }: TranscriptUsageSource,
    usage: Snapshot["usage"],
  ): void => {
    if (seen.has(id) || !Object.values(usage).some((value) => value > 0)) return;
    if (Object.values(usage).some((value) => !Number.isFinite(value) || value < 0)) return;
    seen.add(id);
    const day = localDay(timestamp);
    accumulateUsage(total, usage);
    add(days, day ?? "", day, usage);
    add(
      projects,
      project ?? "",
      project ? basename(project) || project : null,
      usage,
      project ?? undefined,
    );
    add(models, JSON.stringify([provider, model]), model, usage, provider ?? undefined);
  };

  for (const session of store.list().toSorted((a, b) => a.createdAt - b.createdAt)) {
    // Yield between transcripts so a large profile does not block Agent events.
    await setImmediate();
    const current = store.getMeta(session.id);
    if (!current) continue;
    let saved: ReturnType<SessionStore["read"]>;
    try {
      saved = store.read(current.id);
    } catch {
      unreadableSessions++;
      continue;
    }
    const project = store.projectOf(current.workingDirectory) ?? null;
    const callers = new Map<string, TranscriptUsageSource>();
    for (const message of saved.messages) {
      if (message.role === "assistant") {
        const assistant: TimedAssistantMessage = message;
        const source = {
          project:
            assistant.pilotUsageProject === undefined ? project : assistant.pilotUsageProject,
          provider: assistant.provider || null,
          model: assistant.model || null,
        };
        for (const block of assistant.content ?? []) {
          if (block.type === "toolCall") callers.set(block.id, source);
        }
        if (assistant.usage)
          record(
            "assistant:" + assistantKey(assistant),
            assistant.pilotTiming?.endedAt ?? assistant.timestamp,
            source,
            assistantUsage(assistant.usage),
          );
      } else if (message.role === "toolResult" && message.toolName === RUN_SUBTASK_TOOL_NAME) {
        const trace = readSubtaskTrace(message.details);
        if (trace) {
          const source = callers.get(message.toolCallId) ?? {
            project,
            provider: null,
            model: null,
          };
          record("subtask:" + message.toolCallId, message.timestamp, source, trace.usage);
        }
      }
    }
    for (const item of saved.compactions) {
      if (!item.usage) continue;
      record(
        "compaction:" + item.id,
        item.timestamp,
        {
          project: item.usageProject === undefined ? project : item.usageProject,
          provider: item.usageModel?.provider ?? null,
          model: item.usageModel?.model ?? null,
        },
        item.usage,
      );
    }
  }

  return {
    total,
    days: [...days.values()].sort((a, b) => b.key.localeCompare(a.key)),
    projects: [...projects.values()].sort((a, b) => a.key.localeCompare(b.key)),
    models: [...models.values()].sort((a, b) => (a.label ?? "").localeCompare(b.label ?? "")),
    unreadableSessions,
  };
}
