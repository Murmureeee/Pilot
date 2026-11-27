// @env node
import { createHash } from "node:crypto";
import { lstatSync, readdirSync, realpathSync } from "node:fs";
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { SETTINGS_FILE_NAME } from "../constants";
import {
  BACKUP_BYTES_LIMIT,
  BACKUP_EXPORT_PATH,
  BACKUP_FILE_LIMIT,
  BACKUP_ROOTS,
  BACKUP_TOO_LARGE,
  BACKUP_UNSUPPORTED_PATH,
  RESTORE_DIRECTORY,
} from "./constants";
import type { ProfileFile } from "./types";

export function validArchivePath(path: string, directory = false): boolean {
  const parts = path.split("/");
  const root = BACKUP_ROOTS.find((name) => name === parts[0]);
  return (
    Boolean(root) &&
    (root === SETTINGS_FILE_NAME
      ? parts.length === 1 && !directory
      : parts.length > 1 || directory) &&
    path.length <= 2048 &&
    parts.every(
      (part) =>
        part.length > 0 &&
        part.length <= 255 &&
        !/[\\:<>"|?*]|[. ]$/.test(part) &&
        !Array.from(part).some((character) => character.charCodeAt(0) < 32) &&
        !/^(?:CON|PRN|AUX|NUL|COM[0-9¹²³]|LPT[0-9¹²³])(?:\.|$)/i.test(part),
    )
  );
}

export function collectProfileFiles(profile: string): ProfileFile[] {
  const files: ProfileFile[] = [];
  const names = new Set<string>();
  let bytes = 0;

  function visit(path: string): void {
    const absolute = join(profile, ...path.split("/"));
    const stat = lstatSync(absolute, { throwIfNoEntry: false });
    if (!stat) return;
    if ((!stat.isFile() && !stat.isDirectory()) || !validArchivePath(path, stat.isDirectory()))
      throw new Error(BACKUP_UNSUPPORTED_PATH);
    const key = path.toLowerCase();
    if (names.has(key)) throw new Error(BACKUP_UNSUPPORTED_PATH);
    names.add(key);
    if (stat.isDirectory()) {
      for (const name of readdirSync(absolute).sort()) visit(path + "/" + name);
      return;
    }
    bytes += stat.size;
    if (files.length === BACKUP_FILE_LIMIT || bytes > BACKUP_BYTES_LIMIT)
      throw new Error(BACKUP_TOO_LARGE);
    files.push({
      path,
      size: stat.size,
      mode: stat.mode & 0o777,
      modified: stat.mtimeMs,
      changed: stat.ctimeMs,
      inode: stat.ino,
    });
  }

  for (const root of BACKUP_ROOTS) visit(root);
  return files;
}

export function profileSignature(files: readonly ProfileFile[]): string {
  return createHash("sha256").update(JSON.stringify(files)).digest("hex");
}

export function checkExportDestination(profile: string, path: string): string {
  const parent = realpathSync.native(dirname(resolve(path)));
  const target = join(parent, basename(path));
  for (const root of [...BACKUP_ROOTS, RESTORE_DIRECTORY]) {
    const fromRoot = relative(join(profile, root), target);
    if (fromRoot !== ".." && !fromRoot.startsWith(".." + sep) && !isAbsolute(fromRoot))
      throw new Error(BACKUP_EXPORT_PATH);
  }
  return target;
}
