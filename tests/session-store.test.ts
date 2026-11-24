import * as fs from "node:fs";
import { existsSync, mkdtempDisposableSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, onTestFinished, vi } from "vitest";
import {
  messageParts,
  messageText,
  SessionStore,
  toUiMessages,
} from "../src/main/agent-host/session-store";
import type { AgentMessage } from "@earendil-works/pi-agent-core";

vi.mock("node:fs", { spy: true });

function makeStore(): { store: SessionStore; dir: string } {
  const temp = mkdtempDisposableSync(join(tmpdir(), "pi-session-"));
  onTestFinished(() => temp.remove());
  return { store: new SessionStore(temp.path), dir: temp.path };
}

describe("SessionStore", () => {
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
    });
    expect(recovered.at(-1)).toEqual(queued);
    restarted.save(session.id, recovered);
    expect(new SessionStore(dir).checkpoint(session.id)).toBeUndefined();
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
