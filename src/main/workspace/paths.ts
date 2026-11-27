// @env node
import { existsSync, lstatSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, posix, relative, resolve, sep } from "node:path";

import { wslProjectPath } from "../../shared/wsl-project";

export function normalizeWorkingDirectory(directory: string): string {
  if (isAbsolute(directory)) {
    try {
      const canonical = wslProjectPath(directory)
        ? realpathSync.native(directory)
        : realpathSync(directory);
      if (statSync(canonical).isDirectory()) return canonical;
    } catch {
      // 目录可能在选择后被移走。
    }
  }
  throw new Error("无法使用该工作目录。");
}

export function isWithinDirectory(directory: string, target: string): boolean {
  const wslDirectory = wslProjectPath(directory);
  const wslTarget = wslProjectPath(target);
  if (wslDirectory || wslTarget) {
    if (
      !wslDirectory ||
      !wslTarget ||
      wslDirectory.distribution.toLowerCase() !== wslTarget.distribution.toLowerCase()
    )
      return false;
    const path = posix.relative(wslDirectory.path, wslTarget.path);
    return path !== ".." && !path.startsWith("../");
  }
  const path = relative(directory, target);
  return path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

export function workspaceRoot(directory = homedir()): string {
  let canonical: string;
  try {
    canonical = realpathSync.native(directory);
  } catch {
    canonical = resolve(directory);
  }
  let candidate = canonical;
  while (true) {
    // A linked worktree uses a .git file and has its own working files and index.
    if (existsSync(join(candidate, ".git"))) return candidate;
    const parent = dirname(candidate);
    if (parent === candidate) return canonical;
    candidate = parent;
  }
}

export function workspacesOverlap(first: string, second: string): boolean {
  return isWithinDirectory(first, second) || isWithinDirectory(second, first);
}

function resolveExistingParent(path: string): string {
  try {
    return wslProjectPath(path) ? realpathSync.native(path) : realpathSync(path);
  } catch (error) {
    // 写入可创建新目录；已有但无法解析的链接仍应失败。
    if (
      (error as NodeJS.ErrnoException).code !== "ENOENT" ||
      lstatSync(path, { throwIfNoEntry: false })
    ) {
      throw error;
    }
    const parent = dirname(path);
    if (parent === path) throw error;
    return join(resolveExistingParent(parent), basename(path));
  }
}

export function createToolPathResolver(workingDirectory?: string): (path: string) => string {
  const cwd = workingDirectory ?? homedir();
  return (path) => {
    const target = resolve(cwd, path);
    if (workingDirectory === undefined) return target;
    if (!isWithinDirectory(cwd, target)) throw new Error(`路径超出工作目录: ${target}`);
    const root = normalizeWorkingDirectory(cwd);
    if (!isWithinDirectory(cwd, root) || !isWithinDirectory(root, cwd))
      throw new Error("无法使用该工作目录。");
    const canonical = resolveExistingParent(target);
    if (!isWithinDirectory(root, canonical)) throw new Error(`路径超出工作目录: ${target}`);
    return canonical;
  };
}
