// @env node
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempDisposableSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxToolCall,
} from "@earendil-works/pi-ai";
import { expect, it, vi, type MockInstance } from "vitest";

import { AgentHost } from "../src/main/agent-host/host";
import { McpManager } from "../src/main/agent-host/mcp";
import { prepareMessageRollback } from "../src/main/agent-host/message-rollback";
import * as models from "../src/main/agent-host/models";
import { SessionStore } from "../src/main/agent-host/session-store";
import type { Settings } from "../src/main/settings/types";
import { mentionToken } from "../src/shared/mentions";
import { fixtureTitle } from "./model-fixture";

vi.mock("electron", () => ({ safeStorage: {} }));

const provider = { id: "faux", kind: "faux", name: "Faux", modelId: "faux-default" } as const;
const settings: Settings = {
  providers: [provider],
  activeProviderId: provider.id,
  approvalMode: "full-access",
};

function hostFor(root: string): AgentHost {
  return new AgentHost({
    store: new SessionStore(join(root, "sessions")),
    getSettings: () => settings,
    saveSettings: () => {},
    broadcast: () => {},
    skillsDir: join(root, "skills"),
    mcp: new McpManager(() => settings, "0.0.0"),
  });
}

function useFixtureModel(
  responses: ReturnType<typeof fauxAssistantMessage>[],
): MockInstance<typeof models.resolveModel> {
  const fake = fauxProvider({ tokensPerSecond: 100_000 });
  fake.appendResponses(responses);
  const catalog = createModels();
  catalog.setProvider(fake.provider);
  return vi.spyOn(models, "resolveModel").mockReturnValue({
    model: fake.getModel()!,
    streamFn: (model, context, options) =>
      fixtureTitle(context) ?? catalog.streamSimple(model, context, options),
  });
}

it("uses the chosen message boundary for branch, edit, and retry while preserving the original chat", async () => {
  using fixture = mkdtempDisposableSync(join(tmpdir(), "pilot-message-branch-"));
  const root = realpathSync(fixture.path);
  const directory = join(root, "project");
  mkdirSync(directory);
  writeFileSync(join(directory, "notes.txt"), "Notes\n");
  using model = useFixtureModel([
    fauxAssistantMessage([fauxText("First reply")]),
    fauxAssistantMessage([fauxText("Original second reply")]),
    fauxAssistantMessage([fauxText("Retried reply")]),
  ]);
  const host = hostFor(root);
  host.openProject(directory);
  await host.prompt("First message");
  const mention = {
    type: "file",
    id: "notes.txt",
    label: "Notes",
    meta: { workingDirectory: directory },
  } as const;
  await host.prompt({ text: "Read " + mentionToken(mention), mentions: [mention] });
  const original = host.getSnapshot();
  const id = original.sessionId!;
  const branch = host.branchMessage(id, original.messages[2].id, "fork");
  expect(branch.sessionId).not.toBe(id);
  expect(branch.messages).toEqual(original.messages.slice(0, 3));
  expect(branch.composerDraft).toEqual([]);

  host.loadSession(id);
  const edit = host.branchMessage(id, original.messages[2].id, "edit");
  expect(edit.messages).toEqual(original.messages.slice(0, 2));
  expect(edit.composerDraft).toEqual(["Read ", mention]);
  host.loadSession(id);
  host.branchMessage(id, original.messages[3].id, "retry");
  await vi.waitFor(() => {
    expect(host.getSnapshot().activeRuns).toEqual([]);
    expect(host.getSnapshot().messages.at(-1)?.parts).toContainEqual({
      type: "text",
      text: "Retried reply",
    });
  });
  expect(host.getSnapshot().messages[2].parts).toEqual(original.messages[2].parts);
  expect(host.getSnapshot().composerDraft).toEqual([]);
  expect(host.loadSession(id).messages).toEqual(original.messages);
  expect(model).toHaveBeenCalled();
});

it("rewinds multiple Git task checkpoints and rejects later edits or index changes", async () => {
  using fixture = mkdtempDisposableSync(join(tmpdir(), "pilot-message-rewind-"));
  const root = realpathSync(fixture.path);
  const directory = join(root, "project");
  mkdirSync(directory);
  const git = (...args: string[]): string =>
    execFileSync("git", args, { cwd: directory, encoding: "utf8", windowsHide: true });
  git("init", "-q");
  git("config", "user.name", "Pilot fixture");
  git("config", "user.email", "pilot-fixture@example.invalid");
  git("config", "core.autocrlf", "false");
  const shared = join(directory, "tracked.txt");
  const unrelated = join(directory, "user.txt");
  const generated = join(directory, "generated.txt");
  writeFileSync(shared, "baseline\r\n");
  writeFileSync(unrelated, "base\n");
  git("add", ".");
  git("commit", "-qm", "fixture baseline");
  writeFileSync(unrelated, "staged edit\n");
  git("add", "user.txt");
  writeFileSync(unrelated, "unstaged edit\n");
  const indexBefore = git("ls-files", "--stage");
  using model = useFixtureModel([
    fauxAssistantMessage([fauxText("Anchor reply")]),
    fauxAssistantMessage([
      fauxToolCall("edit_file", { path: "tracked.txt", oldText: "baseline", newText: "second" }),
    ]),
    fauxAssistantMessage([fauxText("Second reply")]),
    fauxAssistantMessage([
      fauxToolCall("edit_file", { path: "tracked.txt", oldText: "second", newText: "third" }),
      fauxToolCall("write_file", { path: "generated.txt", content: "generated\n" }),
    ]),
    fauxAssistantMessage([fauxText("Third reply")]),
  ]);
  const first = hostFor(root);
  first.openProject(directory);
  await first.prompt("Keep this reply");
  const id = first.getSnapshot().sessionId!;
  const anchor = first.getSnapshot().messages.at(-1)!.id;
  await first.prompt("Second task");
  await first.prompt("Third task");
  const host = hostFor(root);
  const original = host.loadSession(id);
  const preview = await host.previewMessageRollback(id, anchor);
  expect(preview.conflicts).toEqual([]);
  expect(preview.removedMessages).toBe(6);
  expect(preview.files).toEqual(
    expect.arrayContaining([
      expect.objectContaining({ path: "generated.txt", operation: "delete" }),
      expect.objectContaining({
        path: "tracked.txt",
        diff: {
          hunks: [
            [
              expect.objectContaining({ text: "third" }),
              expect.objectContaining({ text: "baseline" }),
            ],
          ],
          truncated: false,
        },
      }),
    ]),
  );
  expect(readFileSync(shared, "utf8")).toBe("third\r\n");
  writeFileSync(shared, "external edit\r\n");
  await expect(host.applyMessageRollback(id, preview.token!)).rejects.toThrow("文件已有后续改动");
  expect(readFileSync(shared, "utf8")).toBe("external edit\r\n");
  expect(existsSync(generated)).toBe(true);
  expect(host.getSnapshot().messages).toEqual(original.messages);

  writeFileSync(shared, "third\r\n");
  git("add", "tracked.txt");
  const withStaging = await host.previewMessageRollback(id, anchor);
  expect(withStaging.conflicts).toEqual([{ reason: "文件的暂存内容已变更，无法撤销。" }]);
  expect(withStaging.token).toBeUndefined();
  git("restore", "--staged", "--", "tracked.txt");

  const again = await host.previewMessageRollback(id, anchor);
  expect(again.conflicts).toEqual([]);
  const rewind = await host.applyMessageRollback(id, again.token!);
  expect(rewind.messages).toEqual(original.messages.slice(0, 2));
  expect(readFileSync(shared, "utf8")).toBe("baseline\r\n");
  expect(existsSync(generated)).toBe(false);
  expect(readFileSync(unrelated, "utf8")).toBe("unstaged edit\n");
  expect(git("ls-files", "--stage")).toBe(indexBefore);
  expect(hostFor(root).loadSession(id).messages).toEqual(rewind.messages);
  expect(model).toHaveBeenCalled();
});

it("keeps messages when a built-in edit has no captured Git checkpoint", async () => {
  using fixture = mkdtempDisposableSync(join(tmpdir(), "pilot-message-ignored-"));
  const root = realpathSync(fixture.path);
  const directory = join(root, "project");
  mkdirSync(directory);
  writeFileSync(join(directory, ".gitignore"), "ignored.txt\n");
  const git = (...args: string[]): string =>
    execFileSync("git", args, { cwd: directory, encoding: "utf8", windowsHide: true });
  git("init", "-q");
  git(
    "-c",
    "user.name=Pilot fixture",
    "-c",
    "user.email=pilot-fixture@example.invalid",
    "commit",
    "-qm",
    "fixture baseline",
    "--allow-empty",
  );
  using model = useFixtureModel([
    fauxAssistantMessage([fauxText("Anchor")]),
    fauxAssistantMessage([
      fauxToolCall("write_file", { path: "ignored.txt", content: "Created\n" }),
    ]),
    fauxAssistantMessage([fauxText("Wrote an ignored file")]),
  ]);
  const host = hostFor(root);
  host.openProject(directory);
  await host.prompt("Keep");
  const { sessionId, messages } = host.getSnapshot();
  await host.prompt("Write");
  const original = host.getSnapshot().messages;
  const preview = await host.previewMessageRollback(sessionId!, messages.at(-1)!.id);
  expect(preview.token).toBeUndefined();
  expect(preview.conflicts).toContainEqual({
    path: "ignored.txt",
    reason: "文件缺少 Git 检查点。请先在审查面板核对后续改动。",
  });
  expect(host.getSnapshot().messages).toEqual(original);
  expect(readFileSync(join(directory, "ignored.txt"), "utf8")).toBe("Created\n");
  expect(model).toHaveBeenCalled();
});

it("recovers a partially applied plain folder rewind after restarting", async () => {
  using fixture = mkdtempDisposableSync(join(tmpdir(), "pilot-message-recovery-"));
  const root = realpathSync(fixture.path);
  const directory = join(root, "project");
  mkdirSync(directory);
  const file = join(directory, "notes.txt");
  const created = join(directory, "new.txt");
  writeFileSync(file, "Old\n");
  using model = useFixtureModel([
    fauxAssistantMessage([fauxText("Anchor")]),
    fauxAssistantMessage([
      fauxToolCall("edit_file", { path: "notes.txt", oldText: "Old", newText: "New" }),
      fauxToolCall("write_file", { path: "new.txt", content: "Created\n" }),
    ]),
    fauxAssistantMessage([fauxText("Wrote two files")]),
  ]);
  const original = hostFor(root);
  original.openProject(directory);
  await original.prompt("Keep");
  const { sessionId, messages: anchorMessages } = original.getSnapshot();
  await original.prompt("Write");
  const id = sessionId!;
  const anchor = anchorMessages.at(-1)!.id;
  const store = new SessionStore(join(root, "sessions"));
  const record = store.read(id);
  const { journal, preview: prepared } = await prepareMessageRollback(record, anchor, directory);
  expect(prepared.conflicts).toEqual([]);
  expect(journal?.files).toHaveLength(2);
  store.writeTranscript(id, record.messages, undefined, null, record.compactions, {
    ...record.messageHistory,
    rollback: journal,
  });
  writeFileSync(file, "Old\n");

  const restarted = hostFor(root);
  expect(restarted.loadSession(id).messages).toEqual(original.getSnapshot().messages);
  const preview = await restarted.previewMessageRollback(id, anchor);
  expect(preview.conflicts).toEqual([]);
  expect(readFileSync(file, "utf8")).toBe("New\n");
  expect(readFileSync(created, "utf8")).toBe("Created\n");
  expect(new SessionStore(join(root, "sessions")).read(id).messageHistory.rollback).toBeUndefined();
  expect((await restarted.applyMessageRollback(id, preview.token!)).messages).toEqual(
    anchorMessages,
  );
  expect(readFileSync(file, "utf8")).toBe("Old\n");
  expect(existsSync(created)).toBe(false);
  expect(model).toHaveBeenCalled();
});
