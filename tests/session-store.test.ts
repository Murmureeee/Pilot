import * as fs from "node:fs";
import { existsSync, mkdtempDisposableSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import { fauxAssistantMessage, fauxText, fauxToolCall } from "@earendil-works/pi-ai";
import type { AssistantMessage, ToolResultMessage } from "@earendil-works/pi-ai";
import { describe, expect, it, onTestFinished, vi } from "vitest";

import {
  messageParts,
  messageText,
  SessionStore,
  toUiMessages,
} from "../src/main/agent-host/session-store";
import type { CheckpointAppend, RunCheckpoint } from "../src/main/agent-host/types";

vi.mock("node:fs", { spy: true });

function makeStore(): { store: SessionStore; dir: string } {
  const temp = mkdtempDisposableSync(join(tmpdir(), "pi-session-"));
  onTestFinished(() => temp.remove());
  return { store: new SessionStore(temp.path), dir: temp.path };
}

function runningCheckpoint(dir: string, changes: Partial<RunCheckpoint> = {}): RunCheckpoint {
  return {
    type: "pilot_run_checkpoint",
    runId: "in-flight",
    workingDirectory: dir,
    startIndex: 0,
    pending: [],
    actions: [],
    ...changes,
  };
}

describe("SessionStore", () => {
  it("indexes project transcripts by visible message, file, and command, and refreshes changed records", () => {
    const { store, dir } = makeStore();
    const project = join(dir, "project");
    const first = store.create(project);
    const second = store.create(join(dir, "another"));
    const unlinked = store.create();
    store.save(second.id, [{ role: "user", content: "共同标记 approved.txt", timestamp: 1 }]);
    store.save(unlinked.id, [{ role: "user", content: "共同标记 unlinked", timestamp: 1 }]);
    const messages: AgentMessage[] = [
      { role: "user", content: "共同标记 draft", timestamp: 1 },
      fauxAssistantMessage(
        [
          fauxToolCall("write_file", { path: "src/approved.txt" }, { id: "write" }),
          fauxToolCall(
            "bash",
            { command: 'Write-Output "[hello]"', timeoutSec: 1 },
            { id: "shell" },
          ),
        ],
        { timestamp: 2 },
      ),
    ];
    store.save(first.id, messages);
    store.setArchived(first.id, true);
    expect(store.searchTranscripts("共同标记").hits).toHaveLength(3);
    expect(store.searchTranscripts("共同标记", null).hits).toMatchObject([
      { sessionId: unlinked.id },
    ]);
    expect(store.searchTranscripts("APPROVED.TXT", project).hits).toMatchObject([
      {
        sessionId: first.id,
        location: { messageId: "s-1", partIndex: 0, field: "input" },
        snippet: { match: "approved.txt" },
      },
    ]);
    expect(store.searchTranscripts('write-output "[hello]"', project).hits).toMatchObject([
      { location: { messageId: "s-1", partIndex: 1, field: "input" } },
    ]);
    expect(new SessionStore(dir).searchTranscripts("[hello]", project)).toEqual(
      store.searchTranscripts("[hello]", project),
    );

    const checkpoint = runningCheckpoint(project, { startIndex: messages.length });
    store.startCheckpoint(first.id, messages, checkpoint);
    store.appendCheckpoint(
      first.id,
      [{ role: "user", content: "Late marker", timestamp: 3 }],
      checkpoint,
    );
    expect(store.searchTranscripts("Late marker", project).hits).toMatchObject([
      { location: { messageId: "s-2" } },
    ]);
    store.save(first.id, messages.slice(0, 1));
    expect(store.searchTranscripts("[hello]", project).hits).toEqual([]);
    expect(store.searchTranscripts("Late marker", project).hits).toEqual([]);
    store.remove(second.id);
    expect(store.searchTranscripts("approved.txt").hits).toEqual([]);
  });

  it("exports user-visible Markdown and preserves tool output containing Markdown fences", () => {
    const { store } = makeStore();
    const id = store.create().id;
    const fence = String.fromCharCode(96).repeat(3);
    const messages: AgentMessage[] = [
      { role: "system", content: "Private prompt instructions", timestamp: 0 },
      {
        role: "user",
        content: "Private serialized prompt",
        timestamp: 1,
        pilotReference: {
          context: "Private added context",
          parts: [
            { type: "text", text: "查看 " },
            { type: "mention", kind: "file", id: "docs/案例.md", label: "案例.md" },
          ],
        },
      } as AgentMessage,
      fauxAssistantMessage(
        [
          fauxText("**已完成**"),
          fauxToolCall("bash", { command: "Write-Output fixture" }, { id: "fixture" }),
        ],
        { timestamp: 2 },
      ),
      {
        role: "toolResult",
        toolCallId: "fixture",
        toolName: "bash",
        content: [{ type: "text", text: fence + "\nfixture\n" + fence }],
        isError: false,
        timestamp: 3,
      },
    ];
    store.save(id, messages);
    store.rename(id, "CON");
    const { filename, markdown } = store.exportMarkdown(id, "zh");
    expect(filename).toBe("_CON.md");
    for (const expected of [
      "# CON",
      "## 用户",
      "@docs/案例.md",
      "## 助手",
      "**已完成**",
      "Write-Output fixture",
    ])
      expect(markdown).toContain(expected);
    expect(markdown).toContain(fence + "\x60text\n" + fence + "\nfixture\n" + fence);
    expect(markdown).not.toContain("Private");
  });

  it("backs up a partially damaged index and recovers chats and drafts", () => {
    const { store, dir } = makeStore();
    const project = join(dir, "project");
    const pinned = store.create(project);
    store.rename(pinned.id, "Kept title");
    store.setPinned(pinned.id, true);
    const chat = store.create();
    const messages: AgentMessage[] = [{ role: "user", content: "Recovered chat", timestamp: 1 }];
    store.save(chat.id, messages);
    const draft = store.create();
    store.saveDraft(draft.id, ["Unsent draft"]);

    const indexPath = join(dir, "index.json");
    const original = JSON.stringify({
      sessions: [store.getMeta(pinned.id), null],
      recentProjects: [project, null],
    });
    writeFileSync(indexPath, original);

    const restored = new SessionStore(dir);
    expect(restored.list()).toHaveLength(3);
    expect(restored.getMeta(pinned.id)).toMatchObject({ title: "Kept title", pinned: true });
    expect(restored.getMeta(chat.id)).toMatchObject({ title: "Recovered chat", createdAt: 1 });
    expect(restored.load(chat.id)).toEqual(messages);
    expect(restored.loadDraft(draft.id)).toEqual(["Unsent draft"]);
    expect(restored.listRecentProjects()).toEqual([project]);
    const backup = fs.readdirSync(dir).find((name) => name.startsWith("index.corrupt-"))!;
    expect(fs.readFileSync(join(dir, backup), "utf8")).toBe(original);
    expect(new SessionStore(dir).list()).toEqual(restored.list());
  });

  it("keeps the damaged index while its backup is blocked and retries on the next write", () => {
    const { store, dir } = makeStore();
    const chat = store.create();
    store.save(chat.id, [{ role: "user", content: "Available chat", timestamp: 1 }]);
    const indexPath = join(dir, "index.json");
    writeFileSync(indexPath, "{invalid-index");
    const backup = vi.mocked(fs.copyFileSync).mockImplementation(() => {
      throw new Error("Simulated index backup failure");
    });
    const project = join(dir, "project");
    let restored: SessionStore;
    try {
      restored = new SessionStore(dir);
      expect(restored.getMeta(chat.id)?.title).toBe("Available chat");
      expect(() => restored.rememberProject(project)).toThrow(/无法备份原会话索引/);
      expect(fs.readFileSync(indexPath, "utf8")).toBe("{invalid-index");
    } finally {
      backup.mockReset();
    }
    restored.rememberProject(project);
    expect(new SessionStore(dir).listRecentProjects()).toEqual([project]);
    expect(fs.readdirSync(dir).filter((name) => name.startsWith("index.corrupt-"))).toHaveLength(1);
  });

  it("restores recent folders without chats and includes projects from old session indexes", () => {
    const { dir } = makeStore();
    const linked = join(dir, "older project");
    const recent = join(dir, "recent project");
    writeFileSync(
      join(dir, "index.json"),
      JSON.stringify({
        sessions: [
          {
            id: "old-linked",
            title: "Linked",
            createdAt: 1,
            updatedAt: 2,
            workingDirectory: linked,
          },
          { id: "old-unlinked", title: "Unlinked", createdAt: 1, updatedAt: 3 },
        ],
      }),
    );
    const store = new SessionStore(dir);
    expect(store.listRecentProjects()).toEqual([linked]);
    store.rememberProject(recent);
    store.rememberProject(recent);
    const restarted = new SessionStore(dir);
    expect(restarted.listRecentProjects()).toEqual([recent, linked]);
    expect(restarted.list()).toHaveLength(2);
    restarted.rememberProject(linked);
    expect(new SessionStore(dir).listRecentProjects()).toEqual([linked, recent]);
  });

  it("creates sessions and lists them newest-first", async () => {
    const { store } = makeStore();
    const first = store.create();
    await new Promise((r) => setTimeout(r, 5));
    const second = store.create();
    const list = store.list();
    expect(list).toHaveLength(2);
    expect(list[0].id).toBe(second.id);
    expect(list[1].id).toBe(first.id);
  });

  it("keeps a removed legacy project out of recents across restart while retaining its chat", () => {
    const { dir } = makeStore();
    const project = join(dir, "project");
    const linked = {
      id: "linked",
      title: "Linked",
      createdAt: 1,
      updatedAt: 2,
      workingDirectory: project,
    };
    writeFileSync(join(dir, "index.json"), JSON.stringify({ sessions: [linked] }));
    const store = new SessionStore(dir);
    expect(store.listRecentProjects()).toEqual([project]);
    store.removeRecentProject(project);
    store.removeRecentProject(project);
    const restarted = new SessionStore(dir);
    expect(restarted.listRecentProjects()).toEqual([]);
    expect(restarted.hasProject(project)).toBe(true);
    expect(restarted.getMeta(linked.id)).toEqual(linked);
    expect(store.list()).toEqual([linked]);
    restarted.rememberProject(project);
    expect(new SessionStore(dir).listRecentProjects()).toEqual([project]);
  });

  it("restores legacy failures and reconciles an unfinished result against its checkpoint", () => {
    const { store, dir } = makeStore();
    const legacy = store.create();
    const active = store.create();
    const messages: AgentMessage[] = [{ role: "user", content: "Run", timestamp: 1 }];
    store.save(
      legacy.id,
      messages,
      runningCheckpoint(dir, { failure: { kind: "credentials", detail: "Unauthorized" } }),
    );
    store.startCheckpoint(active.id, messages, runningCheckpoint(dir));
    const restarted = new SessionStore(dir);
    expect(restarted.getMeta(legacy.id)?.lastRunResult).toBe("failed");
    expect(restarted.getMeta(active.id)?.lastRunResult).toBe("interrupted");

    // If the transcript settled but the index update was lost, the saved checkpoint determines recovery.
    store.writeTranscript(active.id, messages);
    expect(new SessionStore(dir).getMeta(active.id)?.lastRunResult).toBeUndefined();
  });

  it("round-trips an agent transcript through JSONL", () => {
    const { store } = makeStore();
    const session = store.create();
    const messages: AgentMessage[] = [
      { role: "user", content: "hello world", timestamp: 1 },
      { role: "assistant", content: [{ type: "text", text: "hi there" }], timestamp: 2 },
    ] as AgentMessage[];
    store.save(session.id, messages);
    const loaded = store.load(session.id);
    expect(loaded).toHaveLength(2);
    expect(messageText(loaded[0])).toBe("hello world");
    expect(messageText(loaded[1])).toBe("hi there");
  });

  it("recovers a checkpoint with completed tool results, missing results, and accepted input", () => {
    const { store, dir } = makeStore();
    const session = store.create(dir);
    const messages = [
      { role: "user", content: "Run the checks", timestamp: 1 },
      {
        role: "assistant",
        content: [
          { type: "toolCall", id: "saved", name: "bash", arguments: { command: "check" } },
          { type: "toolCall", id: "unknown", name: "write_file", arguments: { path: "output" } },
        ],
        timestamp: 2,
      },
      {
        role: "toolResult",
        toolName: "bash",
        toolCallId: "saved",
        content: [{ type: "text", text: "checked" }],
        isError: false,
        timestamp: 3,
      },
    ] as AgentMessage[];
    const queued = { role: "user", content: "Include the results", timestamp: 4 } as const;
    store.save(session.id, messages, {
      type: "pilot_run_checkpoint",
      runId: "interrupted",
      workingDirectory: dir,
      startIndex: 0,
      actions: ["recorded-action"],
      approvals: [{ callId: "unknown", approval: { decision: "once" } }],
      pending: [queued],
    });
    const restarted = new SessionStore(dir);
    const recovered = restarted.load(session.id);
    expect(restarted.checkpoint(session.id)?.workingDirectory).toBe(dir);
    expect(recovered.slice(0, 3)).toEqual(messages);
    expect(recovered[3]).toMatchObject({
      role: "toolResult",
      toolCallId: "unknown",
      isError: true,
      pilotApproval: { decision: "once" },
    });
    expect(recovered.at(-1)).toEqual(queued);
    restarted.save(session.id, recovered);
    expect(new SessionStore(dir).checkpoint(session.id)).toBeUndefined();
  });

  it("appends only new messages and the checkpoint to a saved transcript", () => {
    const { store, dir } = makeStore();
    const { id } = store.create(dir);
    const before = [{ role: "user", content: "Earlier chat", timestamp: 1 }] as const;
    const next = { role: "user", content: "Follow-up", timestamp: 2 } as const;
    const pending = { role: "user", content: "Queued", timestamp: 3 } as const;
    const active = runningCheckpoint(dir, { pending: [next] });
    const queued = runningCheckpoint(dir, { pending: [pending] });
    const path = join(dir, id + ".jsonl");
    store.save(id, [...before]);
    const snapshot = fs.readFileSync(path, "utf8");

    store.startCheckpoint(id, [...before], active);
    store.appendCheckpoint(id, [next], queued);

    const contents = fs.readFileSync(path, "utf8");
    expect(contents.slice(0, snapshot.length)).toBe(snapshot);
    expect(
      contents
        .slice(snapshot.length)
        .trimEnd()
        .split("\n")
        .map((line) => JSON.parse(line)),
    ).toEqual([
      { type: "pilot_checkpoint_append", checkpoint: active, messages: [] },
      { type: "pilot_checkpoint_append", checkpoint: queued, messages: [next] },
    ]);
    const restored = new SessionStore(dir);
    expect(restored.checkpoint(id)).toEqual(queued);
    expect(restored.load(id)).toEqual([...before, next, pending]);

    store.save(id, [...before, next, pending]);
    expect(fs.readFileSync(path, "utf8")).not.toContain("pilot_checkpoint_append");
    expect(new SessionStore(dir).read(id)).toEqual({
      messages: [...before, next, pending],
      checkpoint: undefined,
      gitChanges: undefined,
      compactions: [],
      messageHistory: { tasks: [] },
    });
  });

  it("preserves individual parallel results and accepts their final transcript order once", () => {
    const { store, dir } = makeStore();
    const { id } = store.create(dir);
    const call = (toolCallId: string) => ({
      type: "toolCall" as const,
      id: toolCallId,
      name: "read_file",
      arguments: { path: "test.txt" },
    });
    const request: AssistantMessage = {
      role: "assistant",
      api: "faux",
      provider: "faux",
      model: "fixture",
      content: [call("first"), call("second")],
      stopReason: "toolUse",
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      timestamp: 1,
    };
    const toolResult = (toolCallId: string, timestamp: number): ToolResultMessage => ({
      role: "toolResult",
      toolCallId,
      toolName: "read_file",
      content: [{ type: "text", text: "Content for " + toolCallId }],
      isError: false,
      timestamp,
    });
    const active = runningCheckpoint(dir, { actions: ["started-before-crash"] });
    const second = toolResult("second", 2);
    const first = toolResult("first", 3);
    store.startCheckpoint(id, [request], active);
    store.appendCheckpoint(id, [], active, second);

    const interrupted = new SessionStore(dir);
    expect(interrupted.load(id)).toMatchObject([
      request,
      second,
      { role: "toolResult", toolCallId: "first", isError: true },
    ]);
    expect(interrupted.checkpoint(id)).toEqual(active);

    store.appendCheckpoint(id, [], active, first);
    const finalFirst = { ...first, timestamp: 4 };
    const finalSecond = { ...second, timestamp: 5 };
    store.appendCheckpoint(id, [finalFirst, finalSecond], active);
    expect(new SessionStore(dir).load(id)).toEqual([request, finalFirst, finalSecond]);
  });

  it("skips damaged appends and recovers the latest complete transaction", () => {
    const { store, dir } = makeStore();
    const { id } = store.create(dir);
    const before = { role: "user", content: "Earlier", timestamp: 1 } as const;
    const accepted = { role: "user", content: "Accepted", timestamp: 2 } as const;
    const incomplete = { role: "user", content: "Uncommitted", timestamp: 3 } as const;
    const path = join(dir, id + ".jsonl");
    const active = runningCheckpoint(dir, { actions: ["saved-action"] });
    const good: CheckpointAppend = {
      type: "pilot_checkpoint_append",
      checkpoint: active,
      messages: [accepted],
    };
    const torn: CheckpointAppend = {
      ...good,
      checkpoint: { ...active, actions: ["uncommitted-action"] },
      messages: [incomplete],
    };
    store.save(id, [before]);
    fs.appendFileSync(
      path,
      `{broken\n${JSON.stringify({ ...good, messages: [null, incomplete] })}\n${JSON.stringify(good)}\n${JSON.stringify(torn)}`,
    );
    const restored = new SessionStore(dir);
    expect(restored.load(id)).toEqual([before, accepted]);
    expect(restored.checkpoint(id)).toEqual(active);

    const resumed = { ...active, runId: "retry" };
    restored.startCheckpoint(id, restored.load(id), resumed);
    restored.appendCheckpoint(id, [{ ...incomplete, content: "After restart" }], resumed);
    expect(new SessionStore(dir).load(id).map(messageText)).toEqual([
      "Earlier",
      "Accepted",
      "After restart",
    ]);
  });

  it("keeps the prior checkpoint if a write fails after appending part of a record", () => {
    const { store, dir } = makeStore();
    const { id } = store.create(dir);
    const before = { role: "user", content: "Saved", timestamp: 1 } as const;
    const next = { role: "user", content: "Accepted after retry", timestamp: 2 } as const;
    const active = runningCheckpoint(dir, { pending: [next] });
    const accepted = { ...active, pending: [] };
    const path = join(dir, id + ".jsonl");
    store.startCheckpoint(id, [before], active);
    vi.mocked(fs.appendFileSync).mockImplementationOnce(() => {
      writeFileSync(path, '{"type":"pilot_checkpoint_append",', { flag: "a" });
      throw new Error("Simulated interrupted write");
    });
    expect(() => store.appendCheckpoint(id, [next], accepted)).toThrow(
      "Simulated interrupted write",
    );
    expect(store.checkpoint(id)).toEqual(active);
    expect(new SessionStore(dir).load(id)).toEqual([before, next]);

    store.startCheckpoint(id, [before, next], accepted);
    store.save(id, [before, next]);
    expect(new SessionStore(dir).load(id)).toEqual([before, next]);
    expect(new SessionStore(dir).checkpoint(id)).toBeUndefined();
  });

  it("derives session title from the first user message", () => {
    const { store } = makeStore();
    const session = store.create();
    const messages: AgentMessage[] = [
      { role: "user", content: "帮我把这个目录整理成周报", timestamp: 1 },
    ] as AgentMessage[];
    store.save(session.id, messages);
    const meta = store.list().find((s) => s.id === session.id);
    expect(meta?.title).toBe("帮我把这个目录整理成周报");
  });

  it("converts transcripts to UI messages with positional ids", () => {
    const messages: AgentMessage[] = [
      { role: "user", content: "q", timestamp: 1 },
      { role: "assistant", content: [{ type: "text", text: "a" }], timestamp: 2 },
    ] as AgentMessage[];
    const ui = toUiMessages(messages, "s");
    expect(ui.map((m) => m.id)).toEqual(["s-0", "s-1"]);
    expect(ui[1].parts[0]).toEqual({ type: "text", text: "a" });
  });

  it("restores the latest successful plan from JSONL", () => {
    const { store } = makeStore();
    const session = store.create();
    const firstPlan = [{ title: "Check inputs", status: "in_progress" }];
    const finalPlan = [{ title: "Check inputs", status: "completed" }];
    store.save(session.id, [
      { role: "user", content: "Make a plan", timestamp: 1 },
      { role: "assistant", content: [], timestamp: 2 },
      { role: "toolResult", toolName: "update_plan", details: { steps: firstPlan }, timestamp: 3 },
      { role: "assistant", content: [{ type: "text", text: "Done" }], timestamp: 4 },
      { role: "toolResult", toolName: "update_plan", details: { steps: finalPlan }, timestamp: 5 },
      {
        role: "toolResult",
        toolName: "update_plan",
        isError: true,
        details: { steps: firstPlan },
        timestamp: 6,
      },
      {
        role: "toolResult",
        toolName: "update_plan",
        details: { steps: [{ title: "Bad", status: "invalid" }] },
        timestamp: 7,
      },
    ] as AgentMessage[]);

    expect(toUiMessages(store.load(session.id), "s").map((message) => message.parts)).toEqual([
      [{ type: "text", text: "Make a plan" }],
      [{ type: "plan", steps: finalPlan }],
      [{ type: "text", text: "Done" }],
    ]);
  });

  it("restores a completed external tool card from JSONL", () => {
    const { store } = makeStore();
    const session = store.create();
    const toolName = "mcp_fixture_echo";
    store.save(session.id, [
      {
        role: "assistant",
        content: [
          { type: "toolCall", id: "echo-call", name: toolName, arguments: { text: "hello" } },
        ],
        timestamp: 1,
      },
      {
        role: "toolResult",
        toolName,
        toolCallId: "echo-call",
        details: { toolLabel: "Fixture / Echo" },
        content: [{ type: "text", text: "echo hello" }],
        isError: false,
        timestamp: 2,
      },
    ] as AgentMessage[]);

    expect(toUiMessages(store.load(session.id), "s")[0].parts).toEqual([
      {
        type: "tool",
        callId: "echo-call",
        toolName,
        label: "Fixture / Echo",
        state: "success",
        inputSummary: '{"text":"hello"}',
        output: "echo hello",
        error: undefined,
      },
    ]);
  });

  it("skips corrupted JSONL lines instead of throwing", () => {
    const { store, dir } = makeStore();
    const session = store.create();
    const valid = JSON.stringify({ role: "user", content: "ok", timestamp: 1 });
    writeFileSync(join(dir, `${session.id}.jsonl`), `${valid}\n{broken json\n`, "utf-8");
    const loaded = store.load(session.id);
    expect(loaded).toHaveLength(1);
    expect(messageText(loaded[0])).toBe("ok");
  });

  it("extracts thinking blocks into dedicated UI parts", () => {
    const message: AgentMessage = {
      role: "assistant",
      content: [
        { type: "thinking", thinking: "reasoning trace" },
        { type: "text", text: "visible answer" },
      ],
      timestamp: 1,
    } as AgentMessage;
    expect(messageParts(message)).toEqual([
      { type: "thinking", blockIndex: 0, text: "reasoning trace" },
      { type: "text", text: "visible answer" },
    ]);
    // 恢复的转录同样保留思考块（toUiMessages 走 messageParts）
    expect(toUiMessages([message], "s")[0].parts).toEqual(messageParts(message));
  });

  it("renames a session and protects the custom title from auto-title overwrite", () => {
    const { store } = makeStore();
    const session = store.create();
    expect(store.rename(session.id, "我的研究计划")).toMatchObject({
      title: "我的研究计划",
      titleCustom: true,
    });
    // 后续落盘自动标题不得覆盖手动命名
    store.save(session.id, [
      { role: "user", content: "全新第一条消息", timestamp: 1 },
    ] as AgentMessage[]);
    const meta = store.list().find((s) => s.id === session.id);
    expect(meta?.title).toBe("我的研究计划");

    // 未重命名的会话仍随首条用户消息更新
    const other = store.create();
    store.save(other.id, [
      { role: "user", content: "自动标题来源", timestamp: 1 },
    ] as AgentMessage[]);
    expect(store.list().find((s) => s.id === other.id)?.title).toBe("自动标题来源");
  });

  it("rename returns null for unknown sessions", () => {
    const { store } = makeStore();
    expect(store.rename("nope", "x")).toBeNull();
  });

  it("removes the transcript file and the index entry", () => {
    const { store, dir } = makeStore();
    const session = store.create();
    store.save(session.id, [{ role: "user", content: "bye", timestamp: 1 }] as AgentMessage[]);
    store.remove(session.id);
    expect(existsSync(join(dir, `${session.id}.jsonl`))).toBe(false);
    expect(store.list().find((s) => s.id === session.id)).toBeUndefined();
    // 重复删除（文件已不存在）不抛错
    expect(() => store.remove(session.id)).not.toThrow();
  });

  it("pins and archives sessions via metadata flags", () => {
    const { store } = makeStore();
    const session = store.create();
    expect(store.setPinned(session.id, true)).toMatchObject({ pinned: true });
    expect(store.setArchived(session.id, true)).toMatchObject({ archived: true });
    expect(store.list().find((s) => s.id === session.id)).toMatchObject({
      pinned: true,
      archived: true,
    });
    // 取消归档恢复；未知会话返回 null
    expect(store.setArchived(session.id, false)).toMatchObject({ archived: false });
    expect(store.setPinned("nope", true)).toBeNull();
  });

  it("sets and clears per-session persona override", () => {
    const { store } = makeStore();
    const session = store.create();
    expect(store.getMeta(session.id)?.personaOverride).toBeUndefined();
    expect(store.setPersonaOverride(session.id, "用英文回复")).toMatchObject({
      personaOverride: "用英文回复",
    });
    // 空白/null = 清除回落全局；未知会话返回 null
    expect(store.setPersonaOverride(session.id, "   ")).toMatchObject({});
    expect(store.getMeta(session.id)?.personaOverride).toBeUndefined();
    expect(store.setPersonaOverride(session.id, null)).toMatchObject({});
    expect(store.setPersonaOverride("nope", "x")).toBeNull();
  });

  it("marks unread and clears it", () => {
    const { store } = makeStore();
    const session = store.create();
    expect(store.setUnread(session.id, true)).toMatchObject({ unread: true });
    expect(store.setUnread(session.id, false)).toMatchObject({ unread: false });
    expect(store.setUnread("nope", true)).toBeNull();
  });

  it("forks a session into a copy with its own transcript and title", () => {
    const { store } = makeStore();
    const session = store.create();
    store.save(session.id, [{ role: "user", content: "原始对话", timestamp: 1 }] as AgentMessage[]);
    const fork = store.fork(session.id);
    // 原会话标题已被 save() 自动更新为首条用户消息 → 分叉标题跟随原标题（titleCustom 保护）
    expect(fork).toMatchObject({ title: "分叉：原始对话", titleCustom: true });
    expect(fork?.id).not.toBe(session.id);
    // 分叉副本带完整转录，且与原会话互相独立
    expect(store.load(fork?.id ?? "").map((m) => m.role)).toEqual(["user"]);
    store.save(session.id, [
      { role: "user", content: "第二条只影响原会话", timestamp: 2 },
    ] as AgentMessage[]);
    expect(store.load(fork?.id ?? "")).toHaveLength(1);
    expect(store.list()).toHaveLength(2);
    expect(store.fork("nope")).toBeNull();
  });

  it("exports transcript text with role labels", () => {
    const { store } = makeStore();
    const session = store.create();
    store.save(session.id, [
      { role: "user", content: "你好", timestamp: 1 },
      { role: "assistant", content: "你好！有什么可以帮你？", timestamp: 2 },
      { role: "toolResult", content: "tool noise", timestamp: 3 },
    ] as AgentMessage[]);
    expect(store.transcriptText(session.id)).toBe("【用户】你好\n\n【助手】你好！有什么可以帮你？");
    expect(store.transcriptText("nope")).toBeNull();
  });
});
