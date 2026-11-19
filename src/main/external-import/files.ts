// @env node
import { createHash } from "node:crypto";
import {
  cpSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export function fingerprint(...parts: string[]): string {
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 24);
}

export function directory(path: string): string | undefined {
  try {
    const target = realpathSync(path);
    return statSync(target).isDirectory() ? target : undefined;
  } catch {
    return undefined;
  }
}

export function within(root: string, path: string): boolean {
  const child = relative(root, path);
  return child !== ".." && !child.startsWith(".." + sep) && !isAbsolute(child);
}

export function childDirectories(root: string): string[] {
  try {
    return readdirSync(root, { withFileTypes: true })
      .filter(
        (entry) => !entry.name.startsWith(".") && (entry.isDirectory() || entry.isSymbolicLink()),
      )
      .map((entry) => join(root, entry.name));
  } catch {
    return [];
  }
}

export function localPluginPath(root: string, entry: string): string | undefined {
  try {
    const path = realpathSync(resolve(root, entry));
    return within(root, path) ? path : undefined;
  } catch {
    return undefined;
  }
}

export function copyImportedDirectory(
  source: string,
  destination: string,
  configFiles: ReadonlySet<string> = new Set(),
): void {
  const parent = dirname(destination);
  mkdirSync(parent, { recursive: true });
  const stage = mkdtempSync(join(parent, ".import-"));
  try {
    cpSync(source, stage, {
      recursive: true,
      filter: (path) => {
        if (path === source) return true;
        const name = basename(path);
        if (
          name === ".git" ||
          /^(?:\.env(?:\.|$))|^(?:\.mcp|mcp|\.app)\.json$/i.test(name) ||
          configFiles.has(path)
        )
          return false;
        const properties = lstatSync(path);
        return properties.isDirectory() || properties.isFile();
      },
    });
    renameSync(stage, destination);
  } finally {
    rmSync(stage, { recursive: true, force: true });
  }
}
