// @env node
import { execFile, type ExecFileException } from "node:child_process";
import { promisify } from "node:util";
import type { ProjectGitHead } from "@shared/contract";
import { createToolPathResolver } from "./paths";

const run = promisify(execFile);

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await run("git", args, {
    cwd,
    windowsHide: true,
    timeout: 2500,
    maxBuffer: 16_384,
    env: {
      ...process.env,
      GIT_DIR: undefined,
      GIT_WORK_TREE: undefined,
      GIT_COMMON_DIR: undefined,
    },
  });
  return stdout.trim();
}

export async function readProjectGitHead(directory: string): Promise<ProjectGitHead | null> {
  try {
    const cwd = createToolPathResolver(directory)(".");
    try {
      // Symbolic HEAD also identifies the branch of a repository with no commits yet.
      const ref = await git(cwd, ["symbolic-ref", "--quiet", "HEAD"]);
      return { branch: ref.replace(/^refs\/heads\//, "") };
    } catch (error) {
      if ((error as ExecFileException).code !== 1) return null;
      return { detachedAt: await git(cwd, ["rev-parse", "--short", "HEAD"]) };
    }
  } catch {
    return null;
  }
}
