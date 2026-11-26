// @env node
import type { StreamFn } from "@earendil-works/pi-agent-core";
import {
  createAssistantMessageEventStream,
  getCurrentTools,
  normalizeContext,
  type AssistantMessage,
  type Message,
} from "@earendil-works/pi-ai";
import { expect, it, vi } from "vitest";

import { COMPACTION_SUMMARY_PROMPT } from "../src/main/agent-host/constants";
import {
  compactContext,
  compactedContext,
  contextSize,
  transcriptUsage,
} from "../src/main/agent-host/context-compaction";
import { resolveModel } from "../src/main/agent-host/models";
import { PLAN_TOOL_NAME } from "../src/main/agent-host/tools/constants";
import type { ReferencedUserMessage } from "../src/main/agent-host/types";

const model = {
  ...resolveModel(
    { id: "faux", name: "Test model", kind: "faux", modelId: "faux-default" },
    undefined,
  ).model,
  contextWindow: 4096,
};
const usage = {
  input: 25,
  output: 5,
  cacheRead: 3,
  cacheWrite: 2,
  totalTokens: 35,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0.01 },
};
const oldOutput = "First line\n" + "interior ".repeat(1800) + "\nLast line";

function assistant(
  content: AssistantMessage["content"],
  stopReason: AssistantMessage["stopReason"] = "stop",
): AssistantMessage {
  return {
    role: "assistant",
    api: model.api,
    provider: model.provider,
    model: model.id,
    content,
    stopReason,
    usage,
    timestamp: 2,
  };
}

function summaryStream() {
  return vi.fn<StreamFn>(() => {
    const stream = createAssistantMessageEventStream();
    stream.end(assistant([{ type: "text", text: "Outstanding: review the remaining tests." }]));
    return stream;
  });
}

function toolGroup(id: string, output: string, name = "read_file"): Message[] {
  return [
    assistant([{ type: "toolCall", id, name, arguments: { path: "src/index.ts" } }], "toolUse"),
    {
      role: "toolResult",
      toolCallId: id,
      toolName: name,
      content: [{ type: "text", text: output }],
      isError: false,
      timestamp: 3,
    },
  ];
}

it("shortens old tool output before requesting a summary and keeps recent calls paired", async () => {
  const messages: Message[] = [
    { role: "user", content: "Read earlier and current records", timestamp: 1 },
    ...toolGroup("older", oldOutput),
    ...toolGroup("current", "Current result"),
  ];
  const stream = summaryStream();
  const record = await compactContext({
    messages,
    original: messages,
    model,
    stream,
    force: false,
    focus: "",
  });
  expect(record).toMatchObject({ cutoff: 0, trimmedTools: 1, summary: "" });
  expect(stream).not.toHaveBeenCalled();
  const projected = compactedContext(messages, record);
  expect(contextSize(projected)).toBeLessThan(model.contextWindow * 0.8);
  expect(projected[2]).toMatchObject({
    toolCallId: "older",
    content: [
      { text: expect.stringMatching(/^First line[\s\S]+omitted from context[\s\S]+Last line$/) },
    ],
  });
  expect(messages[2]).toMatchObject({ content: [{ text: oldOutput }] });
  expect(projected.slice(-2)).toEqual(messages.slice(-2));
});

it("retains the plan, file reference, current task and tool declarations after summarizing", async () => {
  const source: ReferencedUserMessage = {
    role: "user",
    content: "Earlier task discussion ".repeat(800),
    timestamp: 1,
    pilotReference: {
      context: "",
      parts: [{ type: "mention", kind: "file", id: "src/index.ts", label: "index.ts" }],
    },
  };
  const plan: Message = {
    role: "toolResult",
    toolCallId: "plan",
    toolName: PLAN_TOOL_NAME,
    content: [{ type: "text", text: "Plan updated." }],
    isError: false,
    details: {
      steps: [
        { title: "Read the source", status: "completed" },
        { title: "Review the tests", status: "in_progress" },
      ],
    },
    timestamp: 3,
  };
  const current = { role: "user", content: "Continue the task", timestamp: 4 } as const;
  const messages: Message[] = [
    { role: "system", content: "Working instructions", timestamp: 0 },
    source,
    assistant([{ type: "toolCall", id: "plan", name: PLAN_TOOL_NAME, arguments: {} }], "toolUse"),
    plan,
    assistant([{ type: "text", text: "First step complete" }]),
    {
      role: "system",
      content: "",
      toolsAdded: [{ name: "fixture", description: "Test tool", parameters: { type: "object" } }],
      timestamp: 4,
    },
    current,
    ...toolGroup("current", "Saved result"),
  ];
  const stream = summaryStream();
  const record = await compactContext({
    messages,
    original: messages,
    model,
    stream,
    force: true,
    focus: "Keep regression cases",
  });
  expect(record?.summary).toBe("Outstanding: review the remaining tests.");
  expect(JSON.stringify(stream.mock.calls)).toContain("Keep regression cases");
  const projected = compactedContext(messages, record);
  expect(projected[1]).toMatchObject({
    role: "user",
    content: expect.stringMatching(
      /Outstanding:[\s\S]+\[in_progress\] Review the tests[\s\S]+src\/index\.ts/,
    ),
  });
  expect(projected).toContainEqual(current);
  expect(projected.slice(-2)).toEqual(messages.slice(-2));
  expect(getCurrentTools(projected)).toEqual(getCurrentTools(messages));
  expect(transcriptUsage(messages, record ? [record] : [])).toMatchObject({
    costTotal: expect.closeTo(0.01 * (stream.mock.calls.length + 3)),
    cacheWrite: 2 * (stream.mock.calls.length + 3),
  });
});

it.each([false, true])(
  "routes the summary to the auxiliary model, then falls back on failure (%s)",
  async (fails) => {
    const current = { role: "user", content: "Continue", timestamp: 4 } as const;
    const messages: Message[] = [
      { role: "user", content: "Earlier requirements and results. ".repeat(400), timestamp: 1 },
      assistant([{ type: "text", text: "Earlier reply" }]),
      current,
      assistant([{ type: "text", text: "Recent reply" }]),
    ];
    const auxiliary = { ...model, id: "small", contextWindow: 1024 };
    const stream = summaryStream();
    const summary = summaryStream();
    const unavailable: StreamFn = () => {
      throw new Error("Auxiliary offline");
    };
    summary.mockImplementationOnce(fails ? unavailable : summary.getMockImplementation()!);
    const record = await compactContext({
      messages,
      original: messages,
      model,
      stream,
      apiKey: "primary-key",
      auxiliaryModel: { model: auxiliary, stream: summary, apiKey: "auxiliary-key" },
      force: true,
      focus: "Retain the task details",
    });
    expect(summary).toHaveBeenCalledWith(
      auxiliary,
      expect.any(Object),
      expect.objectContaining({
        apiKey: "auxiliary-key",
        maxTokens: 102,
      }),
    );
    const fallback = new Set(
      stream.mock.calls.map(([selected, , options]) => selected.id + ":" + options?.apiKey),
    );
    expect(fallback).toEqual(new Set(fails ? [model.id + ":primary-key"] : []));
    expect(record?.summary).toBe("Outstanding: review the remaining tests.");
    expect(compactedContext(messages, record)).toContainEqual(current);
  },
);

it("can estimate loaded transcripts without assistant usage", () => {
  const olderMessage = assistant([{ type: "text", text: "Older answer" }]);
  const { usage: _usage, ...legacy } = olderMessage;
  expect(contextSize([legacy as AssistantMessage])).toBeGreaterThan(0);
  expect(transcriptUsage([legacy as AssistantMessage], [])).toMatchObject({ input: 0 });
});

it("summarizes demo history without triggering a tool demo", async () => {
  const demo = resolveModel(
    { id: "faux", name: "Test model", kind: "faux", modelId: "faux-default" },
    undefined,
  );
  const context = normalizeContext({
    systemPrompt: COMPACTION_SUMMARY_PROMPT,
    messages: [{ role: "user", timestamp: 0, content: "Conversation history\nuser\nStart a demo" }],
  });
  const stream = await demo.streamFn(demo.model, context);
  expect(await stream.result()).toMatchObject({
    stopReason: "stop",
    content: [{ type: "text", text: expect.stringContaining("Start a demo") }],
  });
});
