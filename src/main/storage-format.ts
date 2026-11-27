// @env node
import { closeSync, openSync, readFileSync, readSync, renameSync, writeFileSync } from "node:fs";

import { STORAGE_UPGRADE_REQUIRED } from "./constants";

export class NewerFormatError extends Error {
  constructor(
    readonly path: string,
    readonly version: number,
  ) {
    super(STORAGE_UPGRADE_REQUIRED);
  }
}

export function formatVersion(data: unknown, supported: number, path: string): number | undefined {
  if (!data || typeof data !== "object" || !("formatVersion" in data)) return 0;
  const { formatVersion: version } = data;
  if (typeof version !== "number" || !Number.isInteger(version) || version < 0) return;
  if (version > supported) throw new NewerFormatError(path, version);
  return version;
}

export function readStoredText(path: string): string | undefined {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

export function readFilePrefix(path: string, length: number): string | undefined {
  let fd: number | undefined;
  try {
    fd = openSync(path, "r");
    const prefix = Buffer.alloc(length);
    return prefix.toString("utf8", 0, readSync(fd, prefix, 0, prefix.length, 0));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  } finally {
    if (fd !== undefined) closeSync(fd);
  }
}

export function parseStoredJson(text: string | undefined): unknown {
  if (text === undefined) return;
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

export function writeStorageAtomic(path: string, contents: string, mode?: number): void {
  // A replaced file becomes visible only after the temporary file is flushed.
  const temporary = path + ".tmp";
  writeFileSync(temporary, contents, { encoding: "utf8", flush: true, mode });
  renameSync(temporary, path);
}
