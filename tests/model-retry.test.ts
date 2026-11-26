// @env node
import { mkdirSync, mkdtempDisposableSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as wait } from "node:timers/promises";

import type {
  AssistantMessage,
  AssistantMessageEventStream,
  TranscriptContext,
} from "@earendil-works/pi-ai";
import { beforeEach, expect, it, vi } from "vitest";

import { COMPACTION_SUMMARY_PROMPT, SESSION_TITLE_PROMPT } from "../src/main/agent-host/constants";
import { AgentHost } from "../src/main/agent-host/host";
import { McpManager } from "../src/main/agent-host/mcp";
import { withModelRetry } from "../src/main/agent-host/model-retry";
import { resolveModel } from "../src/main/agent-host/models";
import { SessionStore } from "../src/main/agent-host/session-store";
import type { ProviderConfig, Settings } from "../src/main/settings/types";
import type { ModelFailure, ModelRetryProgress, UiAgentEvent } from "../src/shared/contract";

vi.mock("electron", () => ({ safeStorage: {} }));
vi.mock("node:timers/promises", async (original) => ({
  ...(await original<typeof import("node:timers/promises")>()),
  setTimeout: vi.fn<typeof wait>(),
}));

const provider: ProviderConfig = {
  id: "local-test",
  kind: "openai-compatible",
  name: "Fixture",
  baseUrl: "http://127.0.0.1:9999/v1",
  modelId: "fixture-model",
};
const context = {
  messages: [{ role: "user", content: "ping", timestamp: 0 }],
} as TranscriptContext;

function errorResponse(
  status: number,
  message: string,
  code?: string,
  headers?: Record<string, string>,
): Response {
  return Response.json({ error: { message, code } }, { status, headers });
}

function chatResponse(delta: object, finishReason?: string): Response {
  const chunk = (data: object, finish_reason?: string): string =>
    `data: ${JSON.stringify({
      id: "fixture",
      object: "chat.completion.chunk",
      created: 1,
      model: provider.modelId,
      choices: [{ index: 0, delta: data, finish_reason: finish_reason ?? null }],
    })}\n\n`;
  return new Response(
    chunk({ role: "assistant", ...delta }) +
      (finishReason ? chunk({}, finishReason) : "") +
      "data: [DONE]\n\n",
    { headers: { "Content-Type": "text/event-stream" } },
  );
}

async function readResult(stream: AssistantMessageEventStream): Promise<AssistantMessage> {
  await Array.fromAsync(stream);
  return stream.result();
}

beforeEach(() => {
  vi.mocked(wait).mockReset().mockResolvedValue(undefined);
});

it("retries rate limit, network loss and server errors with one backoff per request", async () => {
  const { model, streamFn } = resolveModel(provider, undefined);
  const fetch = vi
    .fn<typeof globalThis.fetch>()
    .mockResolvedValueOnce(errorResponse(429, "Busy", "rate_limit_error", { "Retry-After": "5" }))
    .mockRejectedValueOnce(new TypeError("fetch failed"))
    .mockResolvedValueOnce(errorResponse(507, "Server busy"))
    .mockResolvedValueOnce(chatResponse({ content: "Restored" }, "stop"));
  const onRetry = vi.fn<(progress: ModelRetryProgress | null) => void>();
  const onFailure = vi.fn<(failure: ModelFailure) => void>();
  const stream = await withModelRetry(streamFn, { onRetry, onFailure })(model, context, { fetch });
  expect(await readResult(stream)).toMatchObject({
    stopReason: "stop",
    content: [{ text: "Restored" }],
  });
  expect(fetch).toHaveBeenCalledTimes(4);
  expect(vi.mocked(wait).mock.calls.map(([delay]) => delay)).toEqual([5000, 2000, 4000]);
  expect(onRetry.mock.calls.map(([progress]) => progress?.attempt)).toEqual([
    1,
    1,
    2,
    2,
    3,
    3,
    undefined,
  ]);
  expect(onFailure).not.toHaveBeenCalled();
});

it.each([
  [401, "invalid_api_key", "credentials"],
  [429, "insufficient_quota", "quota"],
  [404, "model_not_found", "capability"],
  [400, "unsupported_parameter", "capability"],
  [503, "try_later", "server"],
] as const)(
  "returns HTTP %i (%s) directly when it requires action or a long wait",
  async (status, code, kind) => {
    const key = "secret-test-key";
    const { model, streamFn } = resolveModel(provider, key);
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(
        errorResponse(
          status,
          `Provider rejected ${key}`,
          code,
          status === 503 ? { "Retry-After": "120" } : undefined,
        ),
      );
    const onRetry = vi.fn<(progress: ModelRetryProgress | null) => void>();
    const onFailure = vi.fn<(failure: ModelFailure) => void>();
    const stream = await withModelRetry(streamFn, { onRetry, onFailure })(model, context, {
      fetch,
      apiKey: key,
    });
    const result = await readResult(stream);
    expect(result.stopReason).toBe("error");
    expect(result.errorMessage).toContain("Provider rejected ••••");
    expect(result.errorMessage).not.toContain(key);
    expect(onFailure).toHaveBeenCalledExactlyOnceWith({ kind, detail: result.errorMessage });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(onRetry).not.toHaveBeenCalled();
  },
);

it("aborts the scheduled backoff without another request", async () => {
  const { model, streamFn } = resolveModel(provider, undefined);
  const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(errorResponse(503, "Busy"));
  const abort = new AbortController();
  const onRetry = vi.fn<(progress: ModelRetryProgress | null) => void>((progress) => {
    if (progress) abort.abort();
  });
  const onFailure = vi.fn<(failure: ModelFailure) => void>();
  const stream = await withModelRetry(streamFn, { onRetry, onFailure })(model, context, {
    fetch,
    signal: abort.signal,
  });
  expect(await readResult(stream)).toMatchObject({ stopReason: "aborted" });
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(onRetry).toHaveBeenLastCalledWith(null);
  expect(onFailure).not.toHaveBeenCalled();
});

it("reopens an exhausted task and continues from its saved tool result", async () => {
  using fixture = mkdtempDisposableSync(join(tmpdir(), "pilot-model-retry-"));
  const directory = join(fixture.path, "project");
  mkdirSync(directory);
  const sessions = join(fixture.path, "sessions");
  const settings: Settings = {
    providers: [provider],
    activeProviderId: provider.id,
    approvalMode: "full-access",
  };
  const events: UiAgentEvent[] = [];
  const makeHost = (): AgentHost =>
    new AgentHost({
      store: new SessionStore(sessions),
      getSettings: () => settings,
      saveSettings: vi.fn<(settings: Settings) => void>(),
      broadcast: (event) => events.push(event),
      skillsDir: join(fixture.path, "skills"),
      mcp: new McpManager(() => settings, "0.0.0"),
    });
  const requests: { messages: { role: string; content?: unknown }[] }[] = [];
  let recovered = false;
  using fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (...args) => {
    requests.push((await new Request(...args).json()) as (typeof requests)[number]);
    if (requests.length === 1) {
      return chatResponse(
        {
          tool_calls: [
            {
              index: 0,
              id: "write_once",
              type: "function",
              function: {
                name: "write_file",
                arguments: JSON.stringify({ path: "marker.txt", content: "written" }),
              },
            },
          ],
        },
        "tool_calls",
      );
    }
    if (recovered) return chatResponse({ content: "Continued" }, "stop");
    if (requests.length === 2) return chatResponse({ content: "Incomplete response" });
    return errorResponse(503, "Temporarily unavailable");
  });

  const host = makeHost();
  host.openProject(directory);
  await host.prompt("Write one file and continue");
  const failed = host.getSnapshot().failedRun!;
  expect(failed).toMatchObject({ workingDirectory: directory, failure: { kind: "server" } });
  expect(host.getSnapshot().interruptedRun).toBeNull();
  expect(events).toContainEqual(
    expect.objectContaining({ type: "model_retry", resetReplyId: expect.any(String) }),
  );
  expect(fetch).toHaveBeenCalledTimes(5);
  expect(
    requests.slice(1).every((request) => JSON.stringify(request) === JSON.stringify(requests[1])),
  ).toBe(true);
  const marker = join(directory, "marker.txt");
  expect(readFileSync(marker, "utf8")).toBe("written");
  const written = statSync(marker).mtimeMs;
  const originalTask = host
    .getSnapshot()
    .sessions.find(({ id }) => id === failed.sessionId)?.lastTask;
  host.saveSessionDraft(failed.sessionId, ["Draft to keep"]);

  const reopened = makeHost();
  expect(reopened.loadSession(failed.sessionId).failedRun).toEqual(failed);
  recovered = true;
  await reopened.resume(failed);
  const result = reopened.getSnapshot();
  expect(result.failedRun).toBeNull();
  expect(result.messages.filter(({ role }) => role === "user")).toHaveLength(1);
  expect(JSON.stringify(result.messages)).toContain("Continued");
  expect(JSON.stringify(result.messages)).not.toContain("Incomplete response");
  expect(result.composerDraft).toEqual(["Draft to keep"]);
  const task = result.sessions.find(({ id }) => id === failed.sessionId)?.lastTask;
  expect(task?.taskId).toBe(originalTask?.taskId);
  expect(task?.agentRunId).not.toBe(failed.runId);
  expect(requests.at(-1)?.messages).toEqual(requests[1].messages);
  expect(requests.at(-1)?.messages.at(-1)).toMatchObject({
    role: "tool",
    content: expect.stringContaining("marker.txt"),
  });
  expect(statSync(marker).mtimeMs).toBe(written);
  expect(() => reopened.resume(failed)).toThrow("该任务已更新");
});

it("compacts and retries overflow from its checkpoint without repeating a completed write", async () => {
  using fixture = mkdtempDisposableSync(join(tmpdir(), "pilot-overflow-retry-"));
  const project = join(fixture.path, "project");
  mkdirSync(project);
  const sessions = join(fixture.path, "sessions");
  const settings: Settings = {
    providers: [provider],
    activeProviderId: provider.id,
    approvalMode: "full-access",
  };
  let cancelCompaction = false;
  const makeHost = (): AgentHost => {
    const host = new AgentHost({
      store: new SessionStore(sessions),
      getSettings: () => settings,
      saveSettings: vi.fn<(settings: Settings) => void>(),
      broadcast: (event) => {
        if (cancelCompaction && event.type === "context_compacting" && event.compacting) {
          host.abort(event.run);
        }
      },
      skillsDir: join(fixture.path, "skills"),
      mcp: new McpManager(() => settings, "0.0.0"),
    });
    return host;
  };
  const host = makeHost();
  const { sessionId } = host.openProject(project);
  const earlier = "Earlier discussion " + "archive ".repeat(800);
  const queued = "Review the pending check";
  const write = (id: string): Response =>
    chatResponse(
      {
        tool_calls: [
          {
            index: 0,
            id,
            type: "function",
            function: {
              name: "write_file",
              arguments: JSON.stringify({ path: "marker.txt", content: "written once" }),
            },
          },
        ],
      },
      "tool_calls",
    );
  const requests: { role: string; content: string }[][] = [];
  using fetch = vi.spyOn(globalThis, "fetch").mockImplementation(async (...args) => {
    const body = (await new Request(...args).json()) as {
      messages: { role: string; content: string }[];
    };
    if (body.messages[0]?.content === COMPACTION_SUMMARY_PROMPT)
      return chatResponse({ content: "Keep the pending check and use the saved write." }, "stop");
    if (body.messages[0]?.content === SESSION_TITLE_PROMPT)
      return chatResponse({ content: "Earlier discussion" }, "stop");
    requests.push(body.messages);
    if (requests.length === 1) return chatResponse({ content: "Earlier reply" }, "stop");
    if (requests.length === 2) return write("initial_write");
    if (requests.length === 3) {
      await host.prompt(queued);
      return errorResponse(400, "Request exceeds the context window", "context_length_exceeded");
    }
    if (requests.length === 4) return write("attempted_repeat");
    return chatResponse({ content: "Continued without writing again" }, "stop");
  });

  await host.prompt(earlier);
  await host.prompt("Write the marker and continue");
  const failed = host.getSnapshot().failedRun!;
  expect(failed?.failure.kind).toBe("context-limit");
  const marker = join(project, "marker.txt");
  const written = statSync(marker).mtimeMs;
  const before = new SessionStore(sessions).read(failed.sessionId);
  expect(before.checkpoint?.pending.map(({ content }) => content)).toEqual([queued]);

  const resumed = makeHost();
  resumed.loadSession(sessionId ?? failed.sessionId);
  cancelCompaction = true;
  await resumed.resume(failed, true);
  expect(new SessionStore(sessions).read(failed.sessionId)).toEqual(before);
  expect(resumed.getSnapshot().failedRun).toEqual(failed);
  cancelCompaction = false;

  await resumed.resume(failed, true);
  expect(resumed.getSnapshot().failedRun).toBeNull();
  const reopened = makeHost().loadSession(failed.sessionId);
  const serialized = JSON.stringify(reopened.messages);
  expect(serialized).toContain(earlier);
  expect(serialized).toContain("Continued without writing again");
  expect(reopened.messages.filter(({ role }) => role === "system")).toHaveLength(1);
  expect(serialized.match(new RegExp(queued, "g"))).toHaveLength(1);
  expect(statSync(marker).mtimeMs).toBe(written);
  expect(readFileSync(marker, "utf8")).toBe("written once");
  expect(requests).toHaveLength(5);
  expect(fetch.mock.calls.length).toBeGreaterThan(requests.length);
  expect(JSON.stringify(requests[3]).length).toBeLessThan(JSON.stringify(requests[2]).length);
  expect(requests[3]).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ role: "tool", content: expect.stringContaining("marker.txt") }),
      expect.objectContaining({ role: "user", content: queued }),
    ]),
  );
  expect(requests[4].at(-1)?.content).toContain("This operation was already started");
});
