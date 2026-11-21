// @env node
import { execFileSync } from "node:child_process";
import {
  mkdirSync,
  mkdtempDisposableSync,
  readFileSync,
  realpathSync,
  renameSync,
  unlinkSync,
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
import { expect, it, vi } from "vitest";
import { AgentHost } from "../src/main/agent-host/host";
import { McpManager } from "../src/main/agent-host/mcp";
import * as models from "../src/main/agent-host/models";
import { SessionStore } from "../src/main/agent-host/session-store";
import type { Settings } from "../src/main/settings/types";
import type { GitDiffRequest, UiAgentEvent } from "../src/shared/contract";

vi.mock("electron", () => ({ safeStorage: {} }));

function fixture(root: string): {
  project: string;
  index: string;
  host: AgentHost;
  composerId: string;
  git(...args: string[]): string;
  write(path: string, content: string | Buffer): void;
  selection(
    path: string,
    area: GitDiffRequest["area"],
    hunks?: number[],
  ): Promise<{ path: string; revision: string; hunks?: number[] }>;
} {
  const project = join(realpathSync(root), "Project");
  mkdirSync(project);
  const git = (...args: string[]): string =>
    execFileSync("git", ["--no-optional-locks", ...args], {
      cwd: project,
      windowsHide: true,
      encoding: "utf8",
    }).replace(/\n$/, "");
  git("init", "-q", "--initial-branch=review");
  git("config", "user.name", "Pilot Test");
  git("config", "user.email", "pilot@example.invalid");
  git("config", "commit.gpgsign", "false");
  git("config", "core.autocrlf", "false");
  git("config", "core.safecrlf", "false");
  const provider = { id: "faux", kind: "faux", name: "Faux", modelId: "faux-default" } as const;
  const settings: Settings = {
    providers: [provider],
    activeProviderId: provider.id,
    approvalMode: "full-access",
  };
  const host = new AgentHost({
    store: new SessionStore(join(root, "sessions")),
    getSettings: () => settings,
    saveSettings: vi.fn<(settings: Settings) => void>(),
    broadcast: vi.fn<(event: UiAgentEvent) => void>(),
    skillsDir: join(root, "skills"),
    mcp: new McpManager(() => settings, "0.0.0"),
  });
  const { composerId } = host.openProject(project);
  return {
    project,
    index: join(project, ".git", "index"),
    host,
    composerId,
    git,
    write(path, content) {
      writeFileSync(join(project, path), content);
    },
    async selection(path, area, hunks) {
      const detail = await host.getGitFileDiff(composerId, { path, area, live: true });
      expect(detail.revision).toBeDefined();
      expect(!hunks || detail.selectableHunks).toBe(true);
      return { path, revision: detail.revision!, hunks };
    },
  };
}

it("commits only the selected task hunk and preserves the other staged and worktree edits in the same file", async () => {
  using temp = mkdtempDisposableSync(join(tmpdir(), "pilot-git-select-"));
  const { project, index, host, composerId, git, write, selection } = fixture(temp.path);
  const path = "mixed # file.txt";
  const file = join(project, path);
  const source = Array.from({ length: 100 }, (_, offset) => "source " + (offset + 1)).join("\r\n");
  const staged = source.replace("source 5\r\n", "user staged one\r\nuser staged two\r\n");
  const user = staged.replace("source 27\r\n", "user worktree one\r\nuser worktree two\r\n");
  const task = user
    .replace("source 54\r\n", "task to commit\r\n")
    .replace("source 83\r\n", "task kept\r\n");
  git("config", "core.autocrlf", "true");
  write(path, source);
  write("other.txt", "original\n");
  git("add", ".");
  git("commit", "-qm", "Fixture");
  write(path, staged);
  write("other.txt", "unrelated staged\n");
  git("add", "--", path, "other.txt");
  write(path, user);
  write("untracked.txt", "unrelated untracked\n");

  const faux = fauxProvider({ tokensPerSecond: 100_000 });
  faux.appendResponses([
    fauxAssistantMessage([fauxToolCall("write_file", { path, content: task })], {
      stopReason: "toolUse",
    }),
    fauxAssistantMessage([fauxText("Edited the shared file.")]),
  ]);
  const catalog = createModels();
  catalog.setProvider(faux.provider);
  const resolve = vi.spyOn(models, "resolveModel").mockReturnValue({
    model: faux.getModel()!,
    streamFn: catalog.streamSimple.bind(catalog),
  });
  try {
    await host.prompt("Edit the shared file", composerId);
    const history = await host.getGitChanges(composerId);
    expect(history?.changes).toContainEqual(
      expect.objectContaining({ path, area: "unstaged", origin: "mixed" }),
    );
    expect(await host.getGitChanges(composerId, true)).toMatchObject({
      hasHistory: true,
      checkpoint: { id: history?.checkpoint?.id },
    });

    await host.stageGit(composerId, {
      ...(await selection(path, "unstaged", [1])),
      area: "unstaged",
    });
    const stagedWithTask = staged
      .replace("source 54\r\n", "task to commit\r\n")
      .replaceAll("\r\n", "\n");
    expect(git("show", ":" + path)).toBe(stagedWithTask);
    const reviewed = await host.previewGitCommit(composerId, [
      await selection(path, "staged", [1]),
    ]);
    expect(reviewed.branch).toBe("review");
    expect(reviewed.patch).toContain("+task to commit");
    expect(reviewed.patch).not.toMatch(/user staged|user worktree|task kept|other\.txt/);

    const indexBeforeCommit = readFileSync(index);
    const result = await host.commitGit(
      composerId,
      reviewed.token,
      "feat: select a task hunk\n\nReview body",
    );
    expect(result).toEqual({ commit: git("rev-parse", "HEAD"), branch: "review" });
    expect(
      git("show", "--format=", "--full-index", "--binary", "--find-renames", "HEAD") + "\n",
    ).toBe(reviewed.patch);
    expect(git("log", "-1", "--format=%B").trimEnd()).toBe(
      "feat: select a task hunk\n\nReview body",
    );
    expect(git("show", "HEAD:" + path)).toBe(
      source.replace("source 54\r\n", "task to commit\r\n").replaceAll("\r\n", "\n"),
    );
    expect(readFileSync(file, "utf8")).toBe(task);
    expect(readFileSync(index)).toEqual(indexBeforeCommit);
    expect(git("diff", "--cached")).toContain("+user staged one");
    expect(git("diff", "--cached")).toContain("+unrelated staged");
    expect(git("diff", "--cached")).not.toContain("+task to commit");
    expect(git("diff")).toContain("+user worktree one");
    expect(git("diff")).toContain("+task kept");
    expect(readFileSync(join(project, "untracked.txt"), "utf8")).toBe("unrelated untracked\n");
    expect(await host.getGitChanges(composerId)).toEqual(history);
    expect(
      (await host.getGitChanges(composerId, true))?.changes
        ?.filter((change) => change.path === path)
        .map((change) => change.area),
    ).toEqual(["staged", "unstaged"]);
  } finally {
    resolve.mockRestore();
  }
}, 20_000);

it("stages and commits whole files including binary additions, deletions, and renames", async () => {
  using temp = mkdtempDisposableSync(join(tmpdir(), "pilot-git-whole-"));
  const { project, index, host, composerId, git, write, selection } = fixture(temp.path);
  const binary = "asset # copy.bin";
  const from = "old name.txt";
  const to = "new name.txt";
  const deleted = "removed.txt";
  const unrelated = "keep.txt";
  const bytes = Buffer.from([0, 1, 2, 255]);
  write(from, "renamed content\n");
  write(deleted, "deleted content\n");
  write(unrelated, "base\n");
  git("add", ".");
  git("commit", "-qm", "Fixture");
  renameSync(join(project, from), join(project, to));
  unlinkSync(join(project, deleted));
  write(binary, bytes);
  write(unrelated, "staged locally\n");
  git("add", unrelated);

  for (const [path, area] of [
    [to, "unstaged"],
    [deleted, "unstaged"],
    [binary, "untracked"],
  ] as const) {
    await host.stageGit(composerId, { ...(await selection(path, area)), area });
  }
  const reviewed = await host.previewGitCommit(
    composerId,
    await Promise.all([to, deleted, binary].map((path) => selection(path, "staged"))),
  );
  expect(reviewed.patch).toContain("rename from " + from);
  expect(reviewed.patch).toContain("deleted file mode");
  expect(reviewed.patch).toContain("GIT binary patch");
  const saved = readFileSync(index);
  await host.commitGit(composerId, reviewed.token, "Selected files");
  expect(
    git("show", "--format=", "--full-index", "--binary", "--find-renames", "HEAD") + "\n",
  ).toBe(reviewed.patch);
  expect(git("diff", "--cached", "--name-only")).toBe(unrelated);
  expect(readFileSync(index)).toEqual(saved);
  expect(readFileSync(join(project, binary))).toEqual(bytes);
}, 15_000);

it("rejects stale worktree, index, and branch selections without changing the current state", async () => {
  using temp = mkdtempDisposableSync(join(tmpdir(), "pilot-git-stale-"));
  const { index, host, composerId, git, write, selection } = fixture(temp.path);
  const path = "tracked.txt";
  write(path, "base\n");
  write("other.txt", "base\n");
  git("add", ".");
  git("commit", "-qm", "Fixture");
  const head = git("rev-parse", "HEAD");
  write(path, "first\n");
  const stale = await selection(path, "unstaged", [0]);
  write(path, "second\n");
  const saved = readFileSync(index);
  await expect(host.stageGit(composerId, { ...stale, area: "unstaged" })).rejects.toThrow(
    "重新查看差异",
  );
  expect(readFileSync(index)).toEqual(saved);

  const stage = await selection(path, "unstaged");
  await host.stageGit(composerId, { ...stage, area: "unstaged" });
  const commitSelection = await selection(path, "staged");
  const oldIndex = await host.previewGitCommit(composerId, [commitSelection]);
  write("other.txt", "unrelated stage after preview\n");
  git("add", "other.txt");
  const changed = readFileSync(index);
  await expect(host.commitGit(composerId, oldIndex.token, "Wrong index")).rejects.toThrow(
    "重新预览提交",
  );
  expect(git("rev-parse", "HEAD")).toBe(head);
  expect(readFileSync(index)).toEqual(changed);

  const oldBranch = await host.previewGitCommit(composerId, [commitSelection]);
  git("switch", "-qc", "switched");
  await expect(host.commitGit(composerId, oldBranch.token, "Wrong branch")).rejects.toThrow(
    "重新预览提交",
  );
  expect(git("rev-parse", "HEAD")).toBe(head);
  expect(git("rev-parse", "review")).toBe(head);
}, 15_000);

it("previews the initial commit and honors a commit hook that rejects it", async () => {
  using temp = mkdtempDisposableSync(join(tmpdir(), "pilot-git-initial-"));
  const { project, index, host, composerId, git, write, selection } = fixture(temp.path);
  write("first.txt", "first\n");
  write("remaining.txt", "remaining\n");
  git("add", ".");
  const hookDir = join(project, ".git", "test-hooks");
  mkdirSync(hookDir);
  git("config", "core.hooksPath", hookDir);
  const hook = join(hookDir, "commit-msg");
  writeFileSync(hook, "#!/bin/sh\nprintf 'Fixture hook rejected the message\\n' >&2\nexit 1\n", {
    mode: 0o755,
  });

  const selected = await selection("first.txt", "staged");
  const preview = await host.previewGitCommit(composerId, [selected]);
  expect(preview.patch).toContain("+first");
  expect(preview.patch).not.toContain("remaining");
  const original = readFileSync(index);
  await expect(host.commitGit(composerId, preview.token, "Rejected")).rejects.toThrow(
    "Fixture hook rejected the message",
  );
  expect(git("status", "--porcelain=v2", "--branch")).toContain("# branch.oid (initial)");
  expect(readFileSync(index)).toEqual(original);

  unlinkSync(hook);
  const again = await host.previewGitCommit(composerId, [selected]);
  const result = await host.commitGit(composerId, again.token, "First commit");
  expect(result.branch).toBe("review");
  expect(git("diff", "--cached", "--name-only")).toBe("remaining.txt");
  expect(readFileSync(index)).toEqual(original);
}, 15_000);
