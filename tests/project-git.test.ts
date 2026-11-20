// @env node
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempDisposableSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it } from "vitest";
import { readProjectGitHead } from "../src/main/workspace/git";

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
