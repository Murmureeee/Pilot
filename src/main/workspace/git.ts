// @env node
import { execFile, type ExecFileException } from "node:child_process";
import { realpathSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { promisify } from "node:util";

import type { ProjectGitHead } from "@shared/contract";

import { GIT_STATUS_MAX_BYTES, GIT_STATUS_TIMEOUT_MS } from "./constants";
import { createToolPathResolver, isWithinDirectory } from "./paths";
import type { GitCommandOptions } from "./types";

const run = promisify(execFile);

export function resolveGitDirectory(directory: string): string {
  // Git reports long paths even when the selected Windows directory uses a short name.
  return realpathSync.native(createToolPathResolver(directory)("."));
}

export function relativeGitPath(
  directory: string | undefined,
  root: string,
  filename: string,
): string {
  let path = filename;
  if (directory && isWithinDirectory(directory, filename)) {
    try {
      path = join(resolveGitDirectory(directory), relative(directory, filename));
    } catch {
      // Recorded tool metadata can outlive the working directory.
    }
  }
  return relative(root, path).split(sep).join("/");
}

export async function readGit(
  cwd: string,
  args: string[],
  options?: GitCommandOptions,
): Promise<string> {
  return (await readGitBuffer(cwd, args, options)).toString("utf8");
}

export async function readGitBuffer(
  cwd: string,
  args: string[],
  options?: GitCommandOptions,
): Promise<Buffer> {
  const command = run("git", ["--no-optional-locks", "-c", "core.fsmonitor=false", ...args], {
    cwd,
    windowsHide: true,
    timeout: options?.timeout ?? GIT_STATUS_TIMEOUT_MS,
    maxBuffer: GIT_STATUS_MAX_BYTES,
    encoding: "buffer",
    env: {
      ...process.env,
      LC_ALL: "C",
      GIT_DIR: undefined,
      GIT_WORK_TREE: undefined,
      GIT_COMMON_DIR: undefined,
      GIT_INDEX_FILE: options?.index,
      GIT_OBJECT_DIRECTORY: undefined,
      GIT_ALTERNATE_OBJECT_DIRECTORIES: undefined,
      GIT_NO_LAZY_FETCH: "1",
    },
  });
  // Git may exit before consuming the input. The command's own error is the useful one.
  command.child.stdin?.on("error", () => {});
  command.child.stdin?.end(options?.input);
  const { stdout } = await command;
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
