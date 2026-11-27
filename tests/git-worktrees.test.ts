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

import { expect, it, vi } from "vitest";

import { AgentHost } from "../src/main/agent-host/host";
import { McpManager } from "../src/main/agent-host/mcp";
import { SessionStore } from "../src/main/agent-host/session-store";
import type { Settings } from "../src/main/settings/types";
import type { Snapshot } from "../src/shared/contract";

vi.mock("electron", () => ({ safeStorage: {} }));

function git(directory: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd: directory,
    encoding: "utf8",
    windowsHide: true,
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function fixture(directory: string) {
  const root = realpathSync.native(directory);
  const project = join(root, "original project");
  const sessions = join(root, "sessions");
  const processes = new Set<string>();
  mkdirSync(project);
  git(project, "init", "-q", "--template=", "--initial-branch=main");
  git(project, "config", "user.name", "Pilot Test");
  git(project, "config", "user.email", "pilot@example.invalid");
  git(project, "config", "commit.gpgsign", "false");
  git(project, "config", "core.autocrlf", "false");
  writeFileSync(join(project, "tracked.txt"), "original\n");
  writeFileSync(join(project, ".gitignore"), "scratch/\n");
  git(project, "add", ".");
  git(project, "commit", "-qm", "Baseline");
  const settings: Settings = { providers: [], activeProviderId: "" };
  const reopen = () => {
    const store = new SessionStore(sessions);
    const host = new AgentHost({
      store,
      getSettings: () => settings,
      saveSettings: () => {},
      broadcast: () => {},
      skillsDir: join(root, "skills"),
      worktreesDir: join(root, "worktrees"),
      hasWorkspaceProcesses: (path) => processes.has(path),
      mcp: new McpManager(() => settings, "0.0.0"),
    });
    return { host, store };
  };
  const { host, store } = reopen();
  const create = async (branch: string, baseBranch = "main"): Promise<Snapshot> => {
    const { composerId } = host.openProject(project);
    const options = await host.gitWorktrees(composerId);
    const base = options.branches.find(({ name }) => name === baseBranch)!;
    return host.createWorktree(composerId, { branch, baseBranch, baseCommit: base.commit });
  };
  return { project, host, store, reopen, create, processes };
}

it("keeps the original index and draft isolated, groups chats under the original project, and merges the reviewed commit", async () => {
  using temp = mkdtempDisposableSync(join(tmpdir(), "pilot-worktrees-"));
  const { project, host, store, create, reopen } = fixture(temp.path);
  const baseline = git(project, "rev-parse", "HEAD");
  git(project, "branch", "another-base");
  writeFileSync(join(project, "tracked.txt"), "staged in the original\n");
  git(project, "add", "tracked.txt");
  const draft = await create("codex/first");
  const first = draft.worktree!;
  const second = (await create("codex/second", "another-base")).worktree!;
  expect(draft.sessionId).toBeNull();
  expect(draft.sessions).toEqual([]);
  expect(first).toMatchObject({ baseBranch: "main", baseCommit: baseline });
  expect(second).toMatchObject({ baseBranch: "another-base", baseCommit: baseline });
  expect(readFileSync(join(first.directory, "tracked.txt"), "utf8")).toBe("original\n");
  expect(git(project, "show", ":tracked.txt")).toBe("staged in the original");
  expect(git(first.directory, "branch", "--show-current")).toBe("codex/first");
  expect(git(second.directory, "branch", "--show-current")).toBe("codex/second");
  const initial = host.getSnapshot().composerId;
  const opened = await host.openWorktree(initial, first.id);
  expect(opened.composerId).toBe(draft.composerId);
  host.saveSessionDraft(opened.composerId, ["First worktree draft"]);
  expect(reopen().host.getSnapshot()).toMatchObject({
    composerId: opened.composerId,
    composerDraft: ["First worktree draft"],
    worktree: first,
  });
  store.create(first.directory, opened.composerId);
  host.loadSession(opened.composerId);
  expect(host.getSnapshot()).toMatchObject({
    recentProjects: [project],
    sessions: [{ worktree: first }],
    worktree: first,
  });
  writeFileSync(join(first.directory, "task.txt"), "Task change\n");
  git(first.directory, "add", "task.txt");
  git(first.directory, "commit", "-qm", "Task commit");

  const blocked = await host.previewWorktree(opened.composerId, first.id);
  expect(blocked.mergeBlock).toContain("原项目的未提交改动");
  await expect(host.applyGitWorktree(opened.composerId, blocked.token, "merge")).rejects.toThrow(
    "未提交改动",
  );
  expect(git(project, "rev-parse", "HEAD")).toBe(baseline);
  git(project, "commit", "-qm", "Original change");
  const reviewed = await host.previewWorktree(opened.composerId, first.id);
  expect(reviewed.mergeBlock).toBeUndefined();
  expect(reviewed.patch).toContain("+Task change");
  expect(reviewed.commits).toBe(1);
  await host.applyGitWorktree(opened.composerId, reviewed.token, "merge");
  expect(git(project, "show", "HEAD:tracked.txt")).toBe("staged in the original");
  expect(git(project, "show", "HEAD:task.txt")).toBe("Task change");
  expect(existsSync(join(second.directory, "task.txt"))).toBe(false);
}, 20_000);

it("refreshes a moved base and rejects a conflicting merge before changing the original checkout", async () => {
  using temp = mkdtempDisposableSync(join(tmpdir(), "pilot-worktree-conflict-"));
  const { project, host, create } = fixture(temp.path);
  const draft = await create("codex/conflict");
  const worktree = draft.worktree!;
  const id = draft.composerId;
  writeFileSync(join(worktree.directory, "tracked.txt"), "task version\n");
  git(worktree.directory, "commit", "-qam", "Conflicting task");
  const preview = await host.previewWorktree(id, worktree.id);
  writeFileSync(join(project, "tracked.txt"), "original project version\n");
  git(project, "commit", "-qam", "Conflicting original");
  const originalHead = git(project, "rev-parse", "HEAD");
  await expect(host.applyGitWorktree(id, preview.token, "merge")).rejects.toThrow("重新预览");
  const fresh = await host.previewWorktree(id, worktree.id);
  await expect(host.applyGitWorktree(id, fresh.token, "merge")).rejects.toThrow("合并冲突");
  expect(git(project, "rev-parse", "HEAD")).toBe(originalHead);
  expect(git(project, "status", "--porcelain")).toBe("");
  expect(git(project, "show", "HEAD:tracked.txt")).toBe("original project version");
  const options = await host.gitWorktrees(id);
  expect(options.branches.find(({ name }) => name === "main")?.commit).toBe(originalHead);
  await expect(
    host.createWorktree(id, {
      branch: "codex/stale",
      baseBranch: "main",
      baseCommit: worktree.baseCommit,
    }),
  ).rejects.toThrow("基准分支已变更");
});

it("warns before archiving and removes only the reviewed managed checkout while preserving its ref and chat", async () => {
  using temp = mkdtempDisposableSync(join(tmpdir(), "pilot-worktree-remove-"));
  const { project, host, store, create, processes, reopen } = fixture(temp.path);
  const draft = await create("codex/discard");
  const worktree = draft.worktree!;
  const id = draft.composerId;
  store.create(worktree.directory, id);
  host.loadSession(id);
  writeFileSync(join(worktree.directory, "local.txt"), "abc");
  mkdirSync(join(worktree.directory, "scratch"));
  writeFileSync(join(worktree.directory, "scratch", "generated.txt"), "ignored");
  expect((await host.previewWorktreeArchive(id)).changes).toEqual(
    expect.arrayContaining([
      { path: "local.txt", status: "??" },
      { path: "scratch/", status: "!!" },
    ]),
  );
  await host.archiveSession(id, true);
  expect(existsSync(join(worktree.directory, "local.txt"))).toBe(true);
  const { composerId } = host.openProject(project);
  const reviewed = await host.previewWorktree(composerId, worktree.id);
  processes.add(worktree.directory);
  await expect(host.applyGitWorktree(composerId, reviewed.token, "remove")).rejects.toThrow(
    "先停止",
  );
  processes.clear();
  writeFileSync(join(worktree.directory, "local.txt"), "def");
  await expect(host.applyGitWorktree(composerId, reviewed.token, "remove")).rejects.toThrow(
    "重新预览",
  );
  expect(readFileSync(join(worktree.directory, "local.txt"), "utf8")).toBe("def");
  const approved = await host.previewWorktree(composerId, worktree.id);
  await host.applyGitWorktree(composerId, approved.token, "remove");
  expect(existsSync(worktree.directory)).toBe(false);
  expect(git(project, "rev-parse", worktree.branch)).toBe(worktree.baseCommit);
  expect((await host.gitWorktrees(composerId)).worktrees).toEqual([]);
  expect(reopen().host.loadSession(id)).toMatchObject({
    sessionId: id,
    worktree: { id: worktree.id, removed: true },
    sessions: [{ archived: true }],
  });
});
