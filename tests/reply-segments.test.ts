// @env browser
import { describe, expect, it } from "vitest";

import { replyInProgress, replySegments, stepCounts } from "../src/renderer/src/lib/reply-segments";
import type { ReplyEntry } from "../src/renderer/src/lib/types";
import { HOOK_TRACE_TOOL, TURN_HOOK_TRACE_TOOL } from "../src/shared/constants";
import type { UiPart } from "../src/shared/contract";

type ToolPart = Extract<UiPart, { type: "tool" }>;

let calls = 0;

function tool(toolName: string, input: object = {}, extra: Partial<ToolPart> = {}): ToolPart {
  calls += 1;
  return {
    type: "tool",
    callId: "call-" + calls,
    toolName,
    label: toolName,
    inputSummary: JSON.stringify(input),
    state: "success",
    ...extra,
  };
}

function entries(parts: UiPart[], streaming = false): ReplyEntry[] {
  return parts.map((part, index) => ({
    key: "m/" + index,
    location: "m:" + index,
    part,
    streaming: streaming && index === parts.length - 1,
  }));
}

describe("reply segments", () => {
  it("keeps every text in order and groups the steps between them", () => {
    const parts: UiPart[] = [
      { type: "text", text: "先看一下配置。" },
      { type: "thinking", text: "需要读两个文件" },
      tool("read_file", { path: "a.ts" }),
      { type: "text", text: "\n" },
      tool("read_file", { path: "b.ts" }),
      { type: "plan", steps: [] },
      { type: "text", text: "问题在 b.ts。" },
      tool("edit_file", { path: "b.ts" }),
      tool(TURN_HOOK_TRACE_TOOL),
      { type: "text", text: "已修复。" },
    ];
    const segments = replySegments(entries(parts));
    expect(
      segments.map((segment) =>
        segment.kind === "text"
          ? segment.entry.location
          : segment.entries.map(({ location }) => location),
      ),
    ).toEqual(["m:0", ["m:1", "m:2", "m:4"], "m:6", ["m:7"], "m:9"]);
  });

  it("counts steps by kind in first-seen order and merges repeated files", () => {
    const parts: UiPart[] = [
      { type: "thinking", text: "…" },
      tool("grep", { pattern: "TODO" }),
      tool("read_file", { path: "a.ts" }),
      tool("read_file", { path: "a.ts" }),
      tool("read_file", { path: "b.ts" }),
      tool("glob", { pattern: "**/*.ts" }),
      tool(HOOK_TRACE_TOOL),
      tool(
        "edit_file",
        { path: "src/a.ts" },
        { fileChange: { id: "1", path: "a.ts", kind: "modified" } },
      ),
      tool(
        "write_file",
        { path: "a.ts" },
        { fileChange: { id: "2", path: "a.ts", kind: "modified" } },
      ),
      tool("bash", { command: "pnpm test" }),
      tool("bash", { command: "pnpm test" }),
      tool("mcp__docs__lookup", { query: "x" }),
    ];
    expect(stepCounts(parts)).toEqual([
      { kind: "search", count: 2 },
      { kind: "read", count: 2 },
      { kind: "hook", count: 1 },
      { kind: "edit", count: 1 },
      { kind: "command", count: 2 },
      { kind: "other", count: 1 },
    ]);
    expect(stepCounts([tool("toString")])).toEqual([{ kind: "other", count: 1 }]);
  });

  it("reports progress only while text, thinking or a tool is active", () => {
    expect(replyInProgress([])).toBe(false);
    expect(replyInProgress(entries([{ type: "text", text: "" }], true))).toBe(false);
    expect(replyInProgress(entries([{ type: "text", text: "好" }], true))).toBe(true);
    expect(replyInProgress(entries([{ type: "text", text: "好" }]))).toBe(false);
    expect(replyInProgress(entries([{ type: "thinking", text: "", streaming: true }]))).toBe(true);
    expect(replyInProgress(entries([tool("bash", {}, { state: "pending" })]))).toBe(true);
    expect(replyInProgress(entries([tool("bash", {}, { state: "running" })]))).toBe(true);
    expect(replyInProgress(entries([tool("bash"), tool("bash", {}, { state: "error" })]))).toBe(
      false,
    );
  });
});
