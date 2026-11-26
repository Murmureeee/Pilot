// @env node
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempDisposableSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, expect, it, vi } from "vitest";

import { AgentHost } from "../src/main/agent-host/host";
import { McpManager } from "../src/main/agent-host/mcp";
import { SessionStore } from "../src/main/agent-host/session-store";
import type { Settings } from "../src/main/settings/types";
import * as gh from "../src/main/workspace/gh";
import type { UiAgentEvent } from "../src/shared/contract";

vi.mock("electron", () => ({ safeStorage: {} }));
afterEach(() => vi.restoreAllMocks());

function runGit(project: string, ...args: string[]): string {
  return execFileSync("git", args, {
    cwd: project,
    windowsHide: true,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function fixture(
  root: string,
  initialCommit = true,
): {
  project: string;
  remote: string;
  host: AgentHost;
  composerId: string;
  git(...args: string[]): string;
  write(path: string, contents: string): void;
} {
  const project = join(root, "project");
  const remote = join(root, "remote.git");
  mkdirSync(project);
  runGit(root, "init", "-q", "--bare", "--initial-branch=main", remote);
  const git = (...args: string[]): string => runGit(project, ...args);
  git("init", "-q", "--initial-branch=main");
  git("config", "user.name", "Pilot Test");
  git("config", "user.email", "pilot@example.invalid");
  git("config", "commit.gpgsign", "false");
  git("config", "core.autocrlf", "false");
  git("config", "core.hooksPath", join(root, "no-hooks"));
  const write = (path: string, contents: string): void =>
    writeFileSync(join(project, path), contents);
  if (initialCommit) {
    write("readme.txt", "initial\n");
    git("add", ".");
    git("commit", "-qm", "Initial commit");
  }
  git("remote", "add", "origin", remote);
  if (initialCommit) git("push", "-qu", "origin", "main");
  const settings: Settings = { providers: [], activeProviderId: "" };
  const host = new AgentHost({
    store: new SessionStore(join(root, "sessions")),
    getSettings: () => settings,
    saveSettings: vi.fn<(settings: Settings) => void>(),
    broadcast: vi.fn<(event: UiAgentEvent) => void>(),
    skillsDir: join(root, "skills"),
    mcp: new McpManager(() => settings, "0.0.0"),
  });
  const { composerId } = host.openProject(project);
  return { project, remote, host, composerId, git, write };
}

it("switches local branches and lets Git preserve changes or reject overwriting them", async () => {
  using temp = mkdtempDisposableSync(join(tmpdir(), "pilot-branches-"));
  const { project, host, composerId, git, write } = fixture(temp.path);
  const create = await host.gitBranches(composerId);
  expect(create).toMatchObject({ head: { branch: "main" }, branches: ["main"] });
  await host.switchGitBranch(composerId, create.token, { kind: "create", branch: "topic/readme" });
  expect(git("branch", "--show-current")).toBe("topic/readme");
  write("readme.txt", "topic version\n");
  git("commit", "-qam", "Change readme");
  write("readme.txt", "uncommitted user version\n");
  const blocked = await host.gitBranches(composerId);
  await expect(
    host.switchGitBranch(composerId, blocked.token, { kind: "switch", branch: "main" }),
  ).rejects.toThrow(/overwritten|local changes/i);
  expect(git("branch", "--show-current")).toBe("topic/readme");
  expect(readFileSync(join(project, "readme.txt"), "utf8")).toBe("uncommitted user version\n");
  write("readme.txt", "topic version\n");
  write("local.txt", "keep untracked\n");
  const retry = await host.gitBranches(composerId);
  await host.switchGitBranch(composerId, retry.token, { kind: "switch", branch: "main" });
  expect(git("branch", "--show-current")).toBe("main");
  expect(readFileSync(join(project, "local.txt"), "utf8")).toBe("keep untracked\n");
}, 20_000);

it("renames the unborn checkout via branch creation and requires a new preview after HEAD moves", async () => {
  using temp = mkdtempDisposableSync(join(tmpdir(), "pilot-branches-"));
  const { host, composerId, git, write } = fixture(temp.path, false);
  write("staged.txt", "first file");
  git("add", ".");
  const options = await host.gitBranches(composerId);
  await host.switchGitBranch(composerId, options.token, { kind: "create", branch: "first" });
  expect(git("symbolic-ref", "HEAD")).toBe("refs/heads/first");
  expect(git("diff", "--cached", "--name-only")).toBe("staged.txt");
  const stale = await host.gitBranches(composerId);
  git("commit", "-qm", "First commit");
  await expect(
    host.switchGitBranch(composerId, stale.token, { kind: "create", branch: "stale" }),
  ).rejects.toThrow("当前分支已变更");
});

it("previews only new commits and pushes a single ref to the actual push URL", async () => {
  using temp = mkdtempDisposableSync(join(tmpdir(), "pilot-branches-"));
  const { remote, host, composerId, git } = fixture(temp.path);
  const publishRemote = join(temp.path, "publish.git");
  runGit(temp.path, "clone", "-q", "--bare", remote, publishRemote);
  git("remote", "set-url", "--push", "origin", publishRemote);
  git("switch", "-qc", "feature");
  git("commit", "--allow-empty", "-qm", "Feature one");
  const first = git("rev-parse", "HEAD");
  git("commit", "--allow-empty", "-qm", "功能二");
  const last = git("rev-parse", "HEAD");
  git("tag", "-am", "unreviewed tag", "local-only-tag");
  git("config", "push.followTags", "true");
  git("config", "remote.origin.mirror", "true");
  git("config", "remote.origin.push", "+refs/heads/*:refs/heads/*");
  const preview = await host.previewGitPush(composerId);
  expect(preview).toMatchObject({
    remote: "origin",
    destination: publishRemote,
    targetBranch: "feature",
    newBranch: true,
  });
  expect(preview.commits).toEqual([
    { hash: last, subject: "功能二" },
    { hash: first, subject: "Feature one" },
  ]);
  expect(runGit(publishRemote, "for-each-ref", "--format=%(refname)")).toBe("refs/heads/main");
  const result = await host.pushGit(composerId, preview.token);
  expect(result).toEqual({});
  expect(runGit(publishRemote, "rev-parse", "refs/heads/feature")).toBe(last);
  expect(runGit(publishRemote, "for-each-ref", "--format=%(refname)")).toBe(
    "refs/heads/feature\nrefs/heads/main",
  );
  expect(runGit(remote, "for-each-ref", "--format=%(refname)")).toBe("refs/heads/main");
  expect(git("rev-parse", "--abbrev-ref", "@{upstream}")).toBe("origin/feature");
  const upToDate = await host.previewGitPush(composerId);
  expect(upToDate).toMatchObject({ newBranch: false, commits: [] });
});

it("rejects changed local HEAD, changed remote refs, and non-fast-forward previews", async () => {
  using temp = mkdtempDisposableSync(join(tmpdir(), "pilot-branches-"));
  const { remote, host, composerId, git } = fixture(temp.path);
  const initial = git("rev-parse", "HEAD");
  git("commit", "--allow-empty", "-qm", "First change");
  const local = await host.previewGitPush(composerId);
  git("commit", "--allow-empty", "-qm", "Second change");
  await expect(host.pushGit(composerId, local.token)).rejects.toThrow("本地分支或远端已变更");
  expect(runGit(remote, "rev-parse", "HEAD")).toBe(initial);
  const beforeExternalPush = await host.previewGitPush(composerId);
  git("push", "-q", "origin", "HEAD^:refs/heads/main");
  await expect(host.pushGit(composerId, beforeExternalPush.token)).rejects.toThrow(
    "本地分支或远端已变更",
  );
  git("reset", "--hard", initial);
  git("commit", "--allow-empty", "-qm", "Divergent local change");
  await expect(host.previewGitPush(composerId)).rejects.toThrow("整合远端改动");
});

it("rejects a push token after the selected chat changes", async () => {
  using temp = mkdtempDisposableSync(join(tmpdir(), "pilot-branches-"));
  const { host, composerId, git } = fixture(temp.path);
  git("commit", "--allow-empty", "-qm", "Ready");
  const preview = await host.previewGitPush(composerId);
  host.newSession();
  const current = host.getSnapshot().composerId;
  await expect(host.pushGit(current, preview.token)).rejects.toThrow("Git 操作预览已失效");
});

it("prefills a fork PR, checks its published head, sends edits through gh and removes the body file", async () => {
  using temp = mkdtempDisposableSync(join(tmpdir(), "pilot-branches-"));
  const { host, composerId, git, project } = fixture(temp.path);
  const base = git("rev-parse", "HEAD");
  git("switch", "-qc", "topic/readme");
  git("commit", "--allow-empty", "-qm", "Adjust the readme");
  const head = git("rev-parse", "HEAD");
  git("remote", "set-url", "--push", "origin", "git@github.com:fixture/fork.git");
  let published = head;
  let bodyFile: string | undefined;
  const fixtureCli = vi.spyOn(gh, "runGitHubCli").mockImplementation(async (_cwd, args) => {
    if (args[0] === "repo") {
      return args[2] === "github.com/fixture/fork"
        ? JSON.stringify({
            nameWithOwner: "fixture/fork",
            defaultBranchRef: { name: "main" },
            parent: { nameWithOwner: "upstream/repo" },
          })
        : JSON.stringify({ nameWithOwner: "upstream/repo", defaultBranchRef: { name: "main" } });
    }
    if (args[0] === "api") return args[3]?.endsWith("/topic/readme") ? published : base;
    expect(args.slice(0, 10)).toEqual([
      "pr",
      "create",
      "--repo",
      "github.com/upstream/repo",
      "--head",
      "fixture:topic/readme",
      "--base",
      "release/next",
      "--title",
      "Reviewed title",
    ]);
    expect(args[10]).toBe("--body-file");
    bodyFile = args[11];
    expect(readFileSync(bodyFile!, "utf8")).toBe("Edited.\n\nSecond line.");
    return "https://github.com/upstream/repo/pull/7";
  });
  const stored = await host.previewGitPullRequest(composerId);
  expect(stored).toMatchObject({
    repository: "upstream/repo",
    head: "fixture:topic/readme",
    base: "main",
    title: "Adjust the readme",
    body: "- Adjust the readme",
  });
  const realDir = git("rev-parse", "--show-toplevel").replaceAll("\\", "/");
  expect(String(fixtureCli.mock.calls[0]?.[0]).replaceAll("\\", "/").toLowerCase()).toBe(
    realDir.toLowerCase(),
  );
  expect(existsSync(project)).toBe(true);
  const draft = { base: "release/next", title: "Reviewed title", body: "Edited.\n\nSecond line." };
  published = base;
  await expect(host.createGitPullRequest(composerId, stored.token, draft)).rejects.toThrow(
    "PR 来源已变更",
  );
  expect(bodyFile).toBeUndefined();
  published = head;
  const retry = await host.previewGitPullRequest(composerId);
  expect(await host.createGitPullRequest(composerId, retry.token, draft)).toBe(
    "https://github.com/upstream/repo/pull/7",
  );
  expect(bodyFile).toBeDefined();
  expect(existsSync(bodyFile!)).toBe(false);
});
