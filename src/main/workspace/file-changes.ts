// @env node
import { isUtf8 } from "node:buffer";
import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  lstatSync,
  openSync,
  readSync,
  realpathSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join, relative, sep } from "node:path";
import { MAX_FILE_SNAPSHOT_BYTES } from "./constants";
import { createToolPathResolver, isWithinDirectory } from "./paths";
import { buildTextDiff } from "./text-diff";
import type { RecordedFileChange } from "./types";

export function textSnapshot(buffer: Buffer): string | undefined {
  return buffer.length <= MAX_FILE_SNAPSHOT_BYTES && !buffer.includes(0) && isUtf8(buffer)
    ? buffer.toString("utf8")
    : undefined;
}

export function readFileSnapshot(path: string): string | null | undefined {
  try {
    const stat = lstatSync(path, { throwIfNoEntry: false });
    if (!stat) return null;
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > MAX_FILE_SNAPSHOT_BYTES) return undefined;
    const fd = openSync(path, "r");
    try {
      const content = Buffer.allocUnsafe(MAX_FILE_SNAPSHOT_BYTES + 1);
      let size = 0;
      while (size < content.length) {
        const count = readSync(fd, content, size, content.length - size, size);
        if (!count) break;
        size += count;
      }
      return textSnapshot(content.subarray(0, size));
    } finally {
      closeSync(fd);
    }
  } catch {
    return undefined;
  }
}

function fingerprint(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function recordFileChange(
  absolutePath: string,
  workingDirectory: string | undefined,
  before: string | null | undefined,
  written: string,
): { pilotFileChange?: RecordedFileChange } {
  const after =
    Buffer.byteLength(written) <= MAX_FILE_SNAPSHOT_BYTES
      ? textSnapshot(Buffer.from(written))
      : undefined;
  if (before !== undefined && before === after) return {};
  const path =
    workingDirectory && isWithinDirectory(workingDirectory, absolutePath)
      ? relative(workingDirectory, absolutePath).split(sep).join("/")
      : absolutePath;
  const change: RecordedFileChange = {
    absolutePath,
    workingDirectory,
    summary: { id: randomUUID(), path, kind: before === null ? "created" : "modified" },
  };
  if (before !== undefined && after !== undefined) {
    const { stats, diff } = buildTextDiff(before, after);
    change.summary.stats = stats;
    change.snapshot = { before, afterHash: fingerprint(after), diff };
  }
  return { pilotFileChange: change };
}

export function readFileChange(toolName: string, details: unknown): RecordedFileChange | undefined {
  if (toolName !== "write_file" && toolName !== "edit_file") return undefined;
  if (!details || typeof details !== "object" || !("pilotFileChange" in details)) return undefined;
  const record = details.pilotFileChange as RecordedFileChange | undefined;
  if (
    !record ||
    typeof record.summary?.id !== "string" ||
    typeof record.summary.path !== "string" ||
    typeof record.absolutePath !== "string" ||
    !isAbsolute(record.absolutePath)
  )
    return undefined;
  return record;
}

export function restoreFileChange(
  change: RecordedFileChange,
  workingDirectory: string | undefined,
): void {
  const { absolutePath, snapshot } = change;
  if (!snapshot || (snapshot.before !== null && typeof snapshot.before !== "string")) {
    throw new Error("此文件没有可用的撤销快照。");
  }
  if (change.workingDirectory !== workingDirectory)
    throw new Error("工作目录已变更，无法撤销此文件。");
  const resolvePath = createToolPathResolver(workingDirectory);
  const verifyLocation = (): void => {
    try {
      if (
        resolvePath(absolutePath) === absolutePath &&
        realpathSync(dirname(absolutePath)) === dirname(absolutePath)
      )
        return;
    } catch (cause) {
      throw new Error("文件位置已变更，无法撤销。", { cause });
    }
    throw new Error("文件位置已变更，无法撤销。");
  };
  verifyLocation();
  const current = readFileSnapshot(absolutePath);
  // A retry after restoring the file and failing to save the transcript remains safe.
  if (current === snapshot.before) return;
  if (typeof current !== "string" || fingerprint(current) !== snapshot.afterHash) {
    throw new Error("文件已有后续改动，无法撤销此变更。");
  }
  if (snapshot.before === null) {
    unlinkSync(absolutePath);
    return;
  }

  const temporary = join(dirname(absolutePath), `.pilot-undo-${randomUUID()}.tmp`);
  const mode = lstatSync(absolutePath).mode & 0o777;
  const fd = openSync(temporary, "wx", mode);
  try {
    try {
      writeFileSync(fd, snapshot.before);
    } finally {
      closeSync(fd);
    }
    chmodSync(temporary, mode);
    verifyLocation();
    if (readFileSnapshot(absolutePath) !== current)
      throw new Error("文件已有后续改动，无法撤销此变更。");
    renameSync(temporary, absolutePath);
  } finally {
    rmSync(temporary, { force: true });
  }
}
