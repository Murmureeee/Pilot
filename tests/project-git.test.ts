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

import { expect, it } from "vitest";

import { readProjectGitHead } from "../src/main/workspace/git";
import { captureGitSnapshot, compareGitSnapshots } from "../src/main/workspace/git-changes";

it("reads Git HEAD in a project and its worktrees, including unborn and detached HEAD", async () => {
  using fixture = mkdtempDisposableSync(join(tmpdir(), "pilot-project-git-"));
  const root = realpathSync(fixture.path);
  const project = join(root, "project folder");
  const nested = join(project, "nested");
  const worktree = join(root, "linked worktree");
  mkdirSync(nested, { recursive: true });
  const git = (...args: string[]): string =>
    execFileSync("git", args, { cwd: project, windowsHide: true, encoding: "utf8" }).trim();

  expect(await readProjectGitHead(project)).toBeNull();
  git("init", "-q", "--initial-branch=feature/initial");
  expect(await readProjectGitHead(nested)).toEqual({ branch: "feature/initial" });
  git(
    "-c",
    "user.name=Pilot Test",
    "-c",
    "user.email=pilot@example.invalid",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "--allow-empty",
    "-qm",
    "Git HEAD test fixture",
  );
  git("worktree", "add", "-q", "-b", "another-branch", worktree);
  expect(await readProjectGitHead(realpathSync(worktree))).toEqual({ branch: "another-branch" });

  git("switch", "-q", "--detach");
  expect(await readProjectGitHead(project)).toEqual({
    detachedAt: git("rev-parse", "--short", "HEAD"),
  });
  expect(await readProjectGitHead(join(root, "unavailable"))).toBeNull();
});

it("tracks staged renames, moved worktree edits and same-length untracked content", async () => {
  using fixture = mkdtempDisposableSync(join(tmpdir(), "pilot-git-snapshots-"));
  const project = realpathSync(fixture.path);
  const nested = join(project, "a folder");
  mkdirSync(nested);
  const git = (...args: string[]): string =>
    execFileSync("git", ["--no-optional-locks", ...args], {
      cwd: project,
      encoding: "utf8",
      windowsHide: true,
    }).trimEnd();
  git("init", "-q");
  git("config", "core.autocrlf", "false");
  writeFileSync(join(project, "staged.txt"), "a staged rename\n");
  writeFileSync(join(project, "dirty move.txt"), "original\n");
  writeFileSync(join(project, "restore.txt"), "restore base\n");
  writeFileSync(join(project, ".gitignore"), "*.ignored\n");
  git("add", ".");
  git(
    "-c",
    "user.name=Pilot",
    "-c",
    "user.email=pilot@example.invalid",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-qm",
    "Git snapshot fixture",
  );
  git("mv", "staged.txt", "a folder/staged  renamed.txt");
  writeFileSync(join(project, "dirty move.txt"), "existing unstaged edit\n");
  writeFileSync(join(project, "restore.txt"), "user edit\n");
  writeFileSync(join(nested, "测试.bin"), Buffer.from([0, 1, 2]));
  writeFileSync(join(nested, "asset.ignored"), "ignored");
  const index = join(project, ".git", "index");
  const oldIndex = readFileSync(index);
  const baseline = await captureGitSnapshot(nested);

  renameSync(join(project, "dirty move.txt"), join(nested, "moved.txt"));
  writeFileSync(join(nested, "测试.bin"), Buffer.from([0, 3, 4]));
  writeFileSync(join(project, "restore.txt"), "restore base\n");
  const current = await captureGitSnapshot(project);
  const changes = compareGitSnapshots(baseline, current, "finished")?.changes;
  expect(changes).toHaveLength(4);
  expect(changes).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        path: "a folder/moved.txt",
        previousPath: "dirty move.txt",
        area: "unstaged",
        kind: "renamed",
        origin: "mixed",
      }),
      expect.objectContaining({
        path: "a folder/staged  renamed.txt",
        previousPath: "staged.txt",
        area: "staged",
        kind: "renamed",
        origin: "existing",
      }),
      expect.objectContaining({
        path: "a folder/测试.bin",
        area: "untracked",
        kind: "added",
        origin: "mixed",
      }),
      expect.objectContaining({
        path: "restore.txt",
        area: "unstaged",
        origin: "mixed",
        resolved: true,
      }),
    ]),
  );
  expect(readFileSync(index)).toEqual(oldIndex);
  expect(git("show", ":a folder/staged  renamed.txt")).toBe("a staged rename");
  expect(readFileSync(join(nested, "moved.txt"), "utf8")).toBe("existing unstaged edit\n");
});

it("keeps a deletion and identical additions separate when a rename is ambiguous", async () => {
  using fixture = mkdtempDisposableSync(join(tmpdir(), "pilot-git-rename-"));
  const project = realpathSync(fixture.path);
  const git = (...args: string[]): void => {
    execFileSync("git", args, { cwd: project, windowsHide: true });
  };
  git("init", "-q");
  git("config", "core.autocrlf", "false");
  writeFileSync(join(project, "source.txt"), "identical\n");
  git("add", "source.txt");
  const baseline = await captureGitSnapshot(project);
  unlinkSync(join(project, "source.txt"));
  writeFileSync(join(project, "first.txt"), "identical\n");
  writeFileSync(join(project, "second.txt"), "identical\n");
  const current = await captureGitSnapshot(project);
  expect(compareGitSnapshots(baseline, current, "finished")?.changes).toMatchObject([
    { path: "first.txt", area: "untracked", kind: "added" },
    { path: "second.txt", area: "untracked", kind: "added" },
    { path: "source.txt", area: "staged", kind: "added", origin: "existing" },
    { path: "source.txt", area: "unstaged", kind: "deleted", origin: "mixed" },
  ]);
});
