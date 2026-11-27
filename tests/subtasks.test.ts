// @env node
import { existsSync, mkdirSync, mkdtempDisposableSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { StreamFn } from "@earendil-works/pi-agent-core";
import {
  createAssistantMessageEventStream,
  fauxAssistantMessage,
  fauxProvider,
  fauxToolCall,
  getCurrentSystemPrompt,
  getCurrentTools,
  type AssistantMessage,
  type AssistantMessageEventStream,
  type ToolResultMessage,
} from "@earendil-works/pi-ai";
import { afterEach, expect, it, vi } from "vitest";

import { MAX_SUBTASK_REQUESTS, SUBTASK_REQUESTS_EXHAUSTED } from "../src/main/agent-host/constants";
import { AgentHost } from "../src/main/agent-host/host";
import { McpManager } from "../src/main/agent-host/mcp";
import * as models from "../src/main/agent-host/models";
import { messageText, SessionStore } from "../src/main/agent-host/session-store";
import * as secrets from "../src/main/settings/secrets";
import type { Settings } from "../src/main/settings/types";
import { RUN_SUBTASK_TOOL_NAME } from "../src/shared/constants";
import type { Snapshot, UiAgentEvent } from "../src/shared/contract";
import { fixtureTitle } from "./model-fixture";

vi.mock("electron", () => ({ safeStorage: {} }));
afterEach(() => vi.restoreAllMocks());

function fixture(profile: string) {
  const project = join(realpathSync(profile), "project");
  mkdirSync(project);
  const provider = { id: "faux", kind: "faux", name: "Faux", modelId: "faux-default" } as const;
  const settings: Settings = { providers: [provider], activeProviderId: provider.id };
  const model = fauxProvider().getModel()!;
  const events: UiAgentEvent[] = [];
  const reopen = (): AgentHost =>
    new AgentHost({
      store: new SessionStore(join(profile, "sessions")),
      getSettings: () => settings,
      saveSettings: () => {},
      broadcast: (event) => events.push(event),
      skillsDir: join(profile, "skills"),
      mcp: new McpManager(() => settings, "0.0.0"),
    });
  return { project, model, events, reopen, host: reopen() };
}

function response(
  content: string | AssistantMessage["content"],
  input = 10,
  stopReason: AssistantMessage["stopReason"] = "stop",
): AssistantMessage {
  const message = fauxAssistantMessage(content, { stopReason });
  return {
    ...message,
    usage: {
      input,
      output: 2,
      cacheRead: 1,
      cacheWrite: 3,
      totalTokens: input + 6,
      cost: { input: 0.02, output: 0.01, cacheRead: 0, cacheWrite: 0, total: 0.03 },
    },
  };
}

function streamOf(message: AssistantMessage): AssistantMessageEventStream {
  const stream = createAssistantMessageEventStream();
  stream.end(message);
  return stream;
}

function subtasks(snapshot: Snapshot) {
  return snapshot.messages.flatMap(({ parts }) =>
    parts.filter((part) => part.type === "tool" && part.toolName === RUN_SUBTASK_TOOL_NAME),
  );
}

function asChild(context: Parameters<StreamFn>[1]): boolean {
  return getCurrentSystemPrompt(context.messages).startsWith(
    "You are a read-only research subtask",
  );
}

it("runs two isolated subtasks and persists their steps and usage with the parent task", async () => {
  using temp = mkdtempDisposableSync(join(tmpdir(), "pilot-subtasks-"));
  const { host, project, model, events, reopen } = fixture(temp.path);
  writeFileSync(join(project, "AGENTS.md"), "Use the fixture evidence only.");
  writeFileSync(join(project, "first.txt"), "Raw first evidence");
  writeFileSync(join(project, "second.txt"), "Raw second evidence");
  writeFileSync(join(temp.path, "outside.txt"), "Outside private file");
  const waiting = new Map<string, AssistantMessageEventStream>();
  const childResults = new Map<string, ToolResultMessage[]>();
  let parentResults: unknown;
  vi.spyOn(models, "resolveModel").mockReturnValue({
    model,
    streamFn: (_model, context) => {
      const title = fixtureTitle(context);
      if (title) return title;
      const { messages } = context;
      const results = messages.filter((message) => message.role === "toolResult");
      if (!asChild(context)) {
        if (!results.length)
          return streamOf(
            response(
              [
                fauxToolCall(
                  RUN_SUBTASK_TOOL_NAME,
                  { question: "First question" },
                  { id: "first" },
                ),
                fauxToolCall(
                  RUN_SUBTASK_TOOL_NAME,
                  { question: "Second question" },
                  { id: "second" },
                ),
              ],
              10,
              "toolUse",
            ),
          );
        parentResults = results.map(({ content, details }) => ({ content, details }));
        return streamOf(response("Combined conclusion"));
      }
      const user = messages.find(({ role }) => role === "user");
      const first = user && messageText(user) === "First question";
      expect(messages.filter(({ role }) => role === "user").map(messageText)).toEqual([
        first ? "First question" : "Second question",
      ]);
      expect(getCurrentSystemPrompt(messages)).toContain("Use the fixture evidence only.");
      expect(getCurrentTools(messages).map(({ name }) => name)).toEqual([
        "read_file",
        "glob",
        "grep",
      ]);
      if (!results.length) {
        const stream = createAssistantMessageEventStream();
        waiting.set(first ? "first" : "second", stream);
        return stream;
      }
      childResults.set(first ? "first" : "second", results);
      return streamOf(response(first ? "First finding" : "Second finding", first ? 30 : 40));
    },
  });
  const draft = host.openProject(project);
  const run = host.prompt("Parent conversation context");
  try {
    await vi.waitFor(() => expect(waiting.size).toBe(2));
    expect(host.getSnapshot().activeRuns).toHaveLength(1);
    expect(subtasks(host.getSnapshot())).toMatchObject([
      { callId: "first", subtask: { status: "running" } },
      { callId: "second", subtask: { status: "running" } },
    ]);
    waiting
      .get("second")!
      .end(
        response(
          [fauxToolCall("read_file", { path: "second.txt" }, { id: "second-read" })],
          40,
          "toolUse",
        ),
      );
    waiting
      .get("first")!
      .end(
        response(
          [
            fauxToolCall("read_file", { path: "first.txt" }, { id: "first-read" }),
            fauxToolCall("read_file", { path: "../outside.txt" }, { id: "outside" }),
            fauxToolCall(
              "write_file",
              { path: "should-not-exist.txt", content: "No" },
              { id: "write" },
            ),
            fauxToolCall(RUN_SUBTASK_TOOL_NAME, { question: "Nested" }, { id: "nest" }),
          ],
          30,
          "toolUse",
        ),
      );
    await run;
  } finally {
    if (host.hasActiveRun()) {
      for (const stream of waiting.values()) stream.end(response("", 0, "aborted"));
      await host.stopForExit();
    }
  }
  expect(existsSync(join(project, "should-not-exist.txt"))).toBe(false);
  expect(childResults.get("first")).toEqual([
    expect.objectContaining({
      content: [{ type: "text", text: expect.stringContaining("Raw first evidence") }],
    }),
    expect.objectContaining({ toolCallId: "outside", isError: true }),
    expect.objectContaining({ toolCallId: "write", isError: true }),
    expect.objectContaining({ toolCallId: "nest", isError: true }),
  ]);
  expect(childResults.get("second")?.[0].content).toContainEqual(
    expect.objectContaining({ text: expect.stringContaining("Raw second evidence") }),
  );
  expect(parentResults).toEqual([
    { content: [{ type: "text", text: "First finding" }], details: undefined },
    { content: [{ type: "text", text: "Second finding" }], details: undefined },
  ]);
  expect(events.filter(({ type }) => type === "permission_request")).toEqual([]);
  const finished = host.getSnapshot();
  expect(finished.usage).toMatchObject({ input: 160, output: 12, cacheRead: 6, cacheWrite: 18 });
  expect(finished.usage.costTotal).toBeCloseTo(0.18);
  expect(finished.contextTokens).toBe(16);
  const restored = reopen().loadSession(draft.composerId);
  expect(restored.usage).toEqual(finished.usage);
  expect(restored.contextTokens).toBe(finished.contextTokens);
  expect(subtasks(restored)).toMatchObject([
    {
      callId: "first",
      subtask: {
        status: "success",
        usage: { input: 60 },
        steps: [
          { id: "first-read", state: "success" },
          { id: "outside", state: "error" },
          { id: "write", state: "error" },
          { id: "nest", state: "error" },
        ],
      },
    },
    { callId: "second", subtask: { status: "success", usage: { input: 80 } } },
  ]);
});

it("restores a started subtask from a checkpoint and cancels its pending model request on exit", async () => {
  using temp = mkdtempDisposableSync(join(tmpdir(), "pilot-subtask-stop-"));
  const { host, project, model, reopen } = fixture(temp.path);
  writeFileSync(join(project, "evidence.txt"), "Saved evidence");
  const pending = Promise.withResolvers<AbortSignal>();
  vi.spyOn(models, "resolveModel").mockReturnValue({
    model,
    streamFn: (_model, context, options) => {
      if (!asChild(context))
        return streamOf(
          response(
            [
              fauxToolCall(
                RUN_SUBTASK_TOOL_NAME,
                { question: "Investigate" },
                { id: "stopped-child" },
              ),
            ],
            10,
            "toolUse",
          ),
        );
      if (!context.messages.some(({ role }) => role === "toolResult"))
        return streamOf(
          response(
            [fauxToolCall("read_file", { path: "evidence.txt" }, { id: "saved-read" })],
            30,
            "toolUse",
          ),
        );
      const stream = createAssistantMessageEventStream();
      const { signal } = options!;
      signal!.addEventListener("abort", () => stream.end(response("", 0, "aborted")), {
        once: true,
      });
      pending.resolve(signal!);
      return stream;
    },
  });
  const draft = host.openProject(project);
  const run = host.prompt("Save a stopped subtask");
  try {
    const signal = await pending.promise;
    expect(signal.aborted).toBe(false);
    const during = reopen().loadSession(draft.composerId);
    expect(during.usage.input).toBe(40);
    expect(subtasks(during)).toMatchObject([
      { subtask: { status: "interrupted", steps: [{ id: "saved-read", state: "success" }] } },
    ]);
    await host.stopForExit();
    expect(signal.aborted).toBe(true);
    await run;
    const after = reopen().loadSession(draft.composerId);
    expect(after.interruptedRun).toBeTruthy();
    expect(after.usage.input).toBe(40);
    expect(subtasks(after)).toMatchObject([
      { subtask: { status: "stopped", steps: [{ id: "saved-read", state: "success" }] } },
    ]);
  } finally {
    if (host.hasActiveRun()) await host.stopForExit();
  }
});

it("bounds a child loop and returns an actionable tool error to the parent", async () => {
  using temp = mkdtempDisposableSync(join(tmpdir(), "pilot-subtask-budget-"));
  const { host, project, model } = fixture(temp.path);
  writeFileSync(join(project, "test.txt"), "Fixture");
  let requests = 0;
  let failure: ToolResultMessage | undefined;
  vi.spyOn(models, "resolveModel").mockReturnValue({
    model,
    streamFn: (_model, context) => {
      const title = fixtureTitle(context);
      if (title) return title;
      if (asChild(context))
        return streamOf(
          response(
            [fauxToolCall("glob", { pattern: "*.txt" }, { id: "search-" + ++requests })],
            10,
            "toolUse",
          ),
        );
      const last = context.messages.at(-1);
      if (last?.role === "toolResult") {
        failure = last;
        return streamOf(response("Try a narrower question."));
      }
      return streamOf(
        response([fauxToolCall(RUN_SUBTASK_TOOL_NAME, { question: "Search" })], 10, "toolUse"),
      );
    },
  });
  host.openProject(project);
  await host.prompt("Delegate a search");
  expect(requests).toBe(MAX_SUBTASK_REQUESTS);
  expect(failure).toMatchObject({
    isError: true,
    content: [{ type: "text", text: SUBTASK_REQUESTS_EXHAUSTED }],
  });
  expect(subtasks(host.getSnapshot())).toMatchObject([
    { state: "error", error: SUBTASK_REQUESTS_EXHAUSTED, subtask: { status: "error" } },
  ]);
});

it("redacts model credentials from a subtask error before reporting or saving it", async () => {
  using temp = mkdtempDisposableSync(join(tmpdir(), "pilot-subtask-error-"));
  const { host, project, model, events, reopen } = fixture(temp.path);
  const apiKey = "fixture-model-secret";
  const detail = "Provider returned unauthorized for ••••";
  let childApiKey: string | undefined;
  let parentResult: string | undefined;
  vi.spyOn(secrets, "decryptSecret").mockReturnValue(apiKey);
  vi.spyOn(models, "resolveModel").mockReturnValue({
    model,
    streamFn: (_model, context, options) => {
      const title = fixtureTitle(context);
      if (title) return title;
      if (asChild(context)) {
        childApiKey = options?.apiKey;
        return streamOf({
          ...response("", 0, "error"),
          errorMessage: "Provider returned unauthorized for " + apiKey,
        });
      }
      const last = context.messages.at(-1);
      if (last?.role === "toolResult") {
        parentResult = messageText(last);
        return streamOf(response("Check the model credentials."));
      }
      return streamOf(
        response([fauxToolCall(RUN_SUBTASK_TOOL_NAME, { question: "Research" })], 10, "toolUse"),
      );
    },
  });
  const draft = host.openProject(project);
  await host.prompt("Delegate a task that receives a model error");
  expect(childApiKey).toBe(apiKey);
  expect(parentResult).toContain(detail);
  expect(parentResult).not.toContain(apiKey);
  const restored = subtasks(reopen().loadSession(draft.composerId));
  expect(restored).toMatchObject([{ state: "error", output: expect.stringContaining(detail) }]);
  expect(JSON.stringify([restored, events])).not.toContain(apiKey);
});
