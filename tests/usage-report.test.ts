import { mkdtempDisposableSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import type { ToolResultMessage } from "@earendil-works/pi-ai";
import { describe, expect, it } from "vitest";

import { SessionStore } from "../src/main/agent-host/session-store";
import type { SavedCompaction, TimedAssistantMessage } from "../src/main/agent-host/types";
import { readUsageReport } from "../src/main/agent-host/usage-report";

describe("saved usage statistics", () => {
  it("counts copied transcripts once and keeps recorded dates, projects and models", async () => {
    using temporary = mkdtempDisposableSync(join(tmpdir(), "pilot-usage-"));
    const store = new SessionStore(temporary.path);
    const original = join(temporary.path, "project");
    const subtask = "subtask-call";
    const modelUsage = {
      input: 10,
      output: 2,
      cacheRead: 3,
      cacheWrite: 1,
      totalTokens: 16,
      cost: { input: 0.1, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.1 },
    };
    const first: TimedAssistantMessage = {
      ...fauxAssistantMessage([fauxToolCall("run_subtask", { question: "Read" }, { id: subtask })]),
      model: "main-model",
      provider: "first-provider",
      usage: modelUsage,
      timestamp: new Date(2026, 8, 17, 23, 40).getTime(),
      pilotUsageProject: original,
    };
    const second: TimedAssistantMessage = {
      ...fauxAssistantMessage([fauxText("Result")]),
      model: "other-model",
      provider: "second-provider",
      usage: modelUsage,
      timestamp: new Date(2026, 8, 18, 10).getTime(),
      pilotUsageProject: null,
      pilotUsageId: "second",
    };
    const result: ToolResultMessage = {
      role: "toolResult",
      toolCallId: subtask,
      toolName: "run_subtask",
      content: [],
      isError: false,
      timestamp: first.timestamp,
      details: {
        pilotSubtask: {
          question: "Read",
          status: "success",
          steps: [],
          usage: { input: 4, output: 1, cacheRead: 0, cacheWrite: 0, costTotal: 0.05 },
        },
      },
    };
    const compaction: SavedCompaction = {
      id: "summary",
      type: "pilot_context_compaction",
      position: 1,
      timestamp: second.timestamp,
      cutoff: 1,
      trimBefore: 1,
      trimmedTools: 0,
      toolOutputLimit: 80,
      summary: "Summary",
      usage: { input: 2, output: 1, cacheRead: 0, cacheWrite: 0, costTotal: 0.025 },
      usageProject: original,
      usageModel: { provider: "second-provider", model: "summary-model" },
    };
    const { id } = store.create(join(temporary.path, "new-location"));
    store.save(id, [first, result, second], undefined, undefined, undefined, [compaction]);
    store.fork(id);

    const report = await readUsageReport(new SessionStore(temporary.path));
    expect(report.total).toMatchObject({ input: 26, output: 6, cacheRead: 6, cacheWrite: 2 });
    expect(report.total.costTotal).toBeCloseTo(0.275);
    expect(report.days.map(({ key, usage }) => [key, usage.input])).toEqual([
      ["2026-09-18", 12],
      ["2026-09-17", 14],
    ]);
    expect(report.projects.map(({ label, usage }) => [label, usage.input])).toEqual([
      [null, 10],
      ["project", 16],
    ]);
    expect(report.models.map(({ label, usage }) => [label, usage.input])).toEqual([
      ["main-model", 14],
      ["other-model", 10],
      ["summary-model", 2],
    ]);
  });

  it("leaves unsupported transcripts in place and identifies skipped sessions", async () => {
    using temporary = mkdtempDisposableSync(join(tmpdir(), "pilot-usage-"));
    const store = new SessionStore(temporary.path);
    const { id } = store.create();
    const path = join(temporary.path, id + ".jsonl");
    writeFileSync(path, '{"type":"pilot_transcript","formatVersion":500}\n');
    const report = await readUsageReport(store);
    expect(report).toMatchObject({ unreadableSessions: 1, days: [] });
  });
});
