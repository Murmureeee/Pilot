// @env node
import { execFile, type ExecFileException } from "node:child_process";
import { promisify } from "node:util";
import type { ProjectGitHead } from "@shared/contract";
import { GIT_STATUS_MAX_BYTES, GIT_STATUS_TIMEOUT_MS } from "./constants";
import { createToolPathResolver } from "./paths";

const run = promisify(execFile);

export async function readGit(cwd: string, args: string[]): Promise<string> {
  return (await readGitBuffer(cwd, args)).toString("utf8");
}

export async function readGitBuffer(cwd: string, args: string[]): Promise<Buffer> {
  const { stdout } = await run(
    "git",
    ["--no-optional-locks", "-c", "core.fsmonitor=false", ...args],
    {
      cwd,
      windowsHide: true,
      timeout: GIT_STATUS_TIMEOUT_MS,
      maxBuffer: GIT_STATUS_MAX_BYTES,
      encoding: "buffer",
      env: {
        ...process.env,
        LC_ALL: "C",
        GIT_DIR: undefined,
        GIT_WORK_TREE: undefined,
        GIT_COMMON_DIR: undefined,
        GIT_INDEX_FILE: undefined,
        GIT_OBJECT_DIRECTORY: undefined,
        GIT_ALTERNATE_OBJECT_DIRECTORIES: undefined,
        GIT_NO_LAZY_FETCH: "1",
      },
    },
  );
  return stdout;
}

export async function readProjectGitHead(directory: string): Promise<ProjectGitHead | null> {
  try {
    const cwd = createToolPathResolver(directory)(".");
    try {
      // Symbolic HEAD also identifies the branch of a repository with no commits yet.
      const ref = (await readGit(cwd, ["symbolic-ref", "--quiet", "HEAD"])).trim();
      return { branch: ref.replace(/^refs\/heads\//, "") };
    } catch (error) {
      if ((error as ExecFileException).code !== 1) return null;
      return { detachedAt: (await readGit(cwd, ["rev-parse", "--short", "HEAD"])).trim() };
    }
  } catch {
    return null;
  }
}
