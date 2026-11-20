// @env node
import { lstatSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export function normalizeWorkingDirectory(directory: string): string {
  if (isAbsolute(directory)) {
    try {
      const canonical = realpathSync(directory);
      if (statSync(canonical).isDirectory()) return canonical;
    } catch {
      // 目录可能在选择后被移走。
    }
  }
  throw new Error("无法使用该工作目录。");
}

export function isWithinDirectory(directory: string, target: string): boolean {
  const path = relative(directory, target);
  return path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path);
}

function resolveExistingParent(path: string): string {
  try {
    return realpathSync(path);
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
    if (relative(cwd, root) !== "") throw new Error("无法使用该工作目录。");
    const canonical = resolveExistingParent(target);
    if (!isWithinDirectory(root, canonical)) throw new Error(`路径超出工作目录: ${target}`);
    return canonical;
  };
}
