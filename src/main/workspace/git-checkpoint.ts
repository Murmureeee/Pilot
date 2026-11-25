// @env node
import type { ExecFileException } from "node:child_process";
import { randomUUID } from "node:crypto";
import { realpath } from "node:fs/promises";

import type {
  FileDiff,
  FileDiffLine,
  GitCheckpointDiff,
  GitCheckpointReview,
  GitChangesView,
  GitRollbackSelection,
} from "@shared/contract";

import { MAX_GIT_CHECKPOINT_BYTES } from "./constants";
import { fingerprintText } from "./file-changes";
import { readGit } from "./git";
import {
  matchesGitEntry,
  readGitBlob,
  readGitIndex,
  readGitWorktreeFile,
  sameGitFile,
} from "./git-review-files";
import { buildTextDiff, textLines } from "./text-diff";
import type {
  GitCheckpointBase,
  GitCheckpointFile,
  GitCommandObservation,
  GitFileState,
  GitSnapshot,
  GitTaskCheckpoint,
  GitWorktree,
  LineRange,
  RecordedFileChange,
} from "./types";

function worktreeSignature(snapshot: GitWorktree, path: string): string | undefined {
  const entry = snapshot.entries.find((item) => item.path === path && item.area !== "staged");
  if (!entry) return "clean";
  if (entry.kind === "deleted") return "missing";
  return entry.worktree?.blob;
}

function commandOwnsFile(
  path: string,
  baseline: GitWorktree,
  current: GitWorktree,
  commands: GitCommandObservation[],
): boolean {
  let signature = worktreeSignature(baseline, path);
  let observed = false;
  if (signature === undefined) return false;
  for (const { before, after } of commands) {
    if (
      !before ||
      !after ||
      !("root" in before) ||
      !("root" in after) ||
      before.root !== baseline.root ||
      after.root !== baseline.root ||
      before.head !== baseline.head ||
      after.head !== baseline.head
    )
      return false;
    const from = worktreeSignature(before, path);
    const to = worktreeSignature(after, path);
    if (from === undefined || to === undefined || from !== signature) return false;
    if (from !== to) observed = true;
    signature = to;
  }
  return observed && signature === worktreeSignature(current, path);
}

function toolsOwnFile(
  records: RecordedFileChange[],
  before: GitFileState,
  after: GitFileState,
): boolean {
  if (records.length === 0 || !after) return false;
  let expected = before === null ? null : fingerprintText(before.text);
  for (const { snapshot, summary } of records) {
    if (!snapshot || summary.reverted) return false;
    const actual = snapshot.before === null ? null : fingerprintText(snapshot.before);
    if (actual !== expected) return false;
    expected = snapshot.afterHash;
  }
  return expected === fingerprintText(after.text);
}

function editedRanges(lines: FileDiffLine[], side: "before" | "after"): LineRange[] {
  let lineNumber = (lines.find((line) => line[side] !== undefined)?.[side] ?? 1) - 1;
  let start: number | undefined;
  const edits: LineRange[] = [];
  for (const line of lines) {
    if (line.kind === "context") {
      if (start !== undefined) edits.push({ start, end: lineNumber });
      start = undefined;
    } else {
      start ??= lineNumber;
    }
    if (line[side] !== undefined) lineNumber++;
  }
  if (start !== undefined) edits.push({ start, end: lineNumber });
  return edits;
}

function overlaps(a: LineRange, b: LineRange): boolean {
  // A zero-length edit shares the boundary of the adjacent replacement or deletion.
  return a.start === a.end || b.start === b.end
    ? a.start <= b.end && b.start <= a.end
    : a.start < b.end && b.start < a.end;
}

async function existingEdits(
  baseline: GitWorktree,
  path: string,
  before: GitFileState,
): Promise<LineRange[] | undefined> {
  const entries = baseline.entries.filter(
    (entry) => entry.path === path || entry.previousPath === path,
  );
  if (entries.length === 0) return [];
  if (entries.some((entry) => entry.kind === "conflicted" || entry.kind === "renamed")) return;
  const head = await readGitBlob(baseline.root, entries.find((entry) => entry.headBlob)?.headBlob);
  if (head === undefined) return;
  const normalized = (text: string): string => text.replaceAll("\r\n", "\n");
  const { diff } = buildTextDiff(
    head === null ? null : normalized(head),
    normalized(before?.text ?? ""),
  );
  if (diff.truncated) return;
  return diff.hunks.flatMap((hunk) => editedRanges(hunk, "after"));
}

export async function createGitTaskCheckpoint(
  id: string,
  directory: string,
  baseline: GitSnapshot | undefined,
  current: GitSnapshot,
  base: GitCheckpointBase | undefined,
  view: GitChangesView,
  recorded: ReadonlyMap<string, RecordedFileChange[]>,
  commands: GitCommandObservation[],
): Promise<GitTaskCheckpoint | undefined> {
  if (!current || !("root" in current) || !view.changes) return;
  const files: GitCheckpointFile[] = [];
  const affected = new Map(
    view.changes
      .filter((change) => change.origin !== "existing")
      .map((change) => [change.path, change]),
  );
  const index = await readGitIndex(current.root).catch(() => undefined);
  let bytes = 0;
  for (const [path, change] of affected) {
    const indexEntry = index?.get(path) ?? "";
    const file: GitCheckpointFile = { path, index: indexEntry, revision: randomUUID() };
    files.push(file);
    if (
      !base ||
      !baseline ||
      !("root" in baseline) ||
      baseline.root !== current.root ||
      baseline.head !== current.head
    ) {
      file.conflict = "snapshot";
      continue;
    }
    const before = base.known.has(path)
      ? base.files.get(path)
      : base.ignored.some((item) => path === item || (item.endsWith("/") && path.startsWith(item)))
        ? undefined
        : null;
    const after = readGitWorktreeFile(directory, current.root, path);
    const entry = current.entries.find((item) => item.path === path && item.area !== "staged");
    const original = baseline.entries.find((item) => item.path === path && item.area !== "staged");
    if (!matchesGitEntry(baseline, original, before) || !matchesGitEntry(current, entry, after)) {
      file.conflict = "snapshot";
      continue;
    }
    if (before === undefined || after === undefined) {
      file.conflict = "snapshot";
      continue;
    }
    bytes += Buffer.byteLength(before?.text ?? "") + Buffer.byteLength(after?.text ?? "");
    if (bytes > MAX_GIT_CHECKPOINT_BYTES) {
      file.conflict = "snapshot";
      continue;
    }
    file.before = before;
    file.after = after;
    if (
      !index ||
      (base.index.get(path) ?? "") !== indexEntry ||
      view.changes.some(
        (item) => item.area === "staged" && item.origin !== "existing" && item.path === path,
      )
    ) {
      file.conflict = "index";
    } else if (
      change.previousPath ||
      change.kind === "conflicted" ||
      (before && after && before.mode !== after.mode) ||
      sameGitFile(before, after)
    ) {
      file.conflict = "ownership";
    } else {
      const records = recorded.get(path) ?? [];
      if (toolsOwnFile(records, before, after)) continue;
      if (records.length > 0 || !commandOwnsFile(path, baseline, current, commands)) {
        file.conflict = "ownership";
        continue;
      }
      const userEdits = await existingEdits(baseline, path, before);
      if (!userEdits || ((!before || !after) && userEdits.length > 0)) file.conflict = "ownership";
      else if (userEdits.length > 0) file.userEdits = userEdits;
    }
  }
  return { id, snapshot: current, files };
}

function checkpointDiff(file: GitCheckpointFile): FileDiff | null {
  return file.before === undefined || file.after === undefined
    ? null
    : buildTextDiff(file.before?.text ?? null, file.after?.text ?? "").diff;
}

export function describeGitCheckpoint(checkpoint: GitTaskCheckpoint): GitCheckpointReview {
  return {
    id: checkpoint.id,
    files: checkpoint.files.map((file) => ({
      path: file.path,
      conflict: file.conflict,
      reverted: !file.conflict && sameGitFile(file.before, file.after) ? true : undefined,
    })),
  };
}

export function gitCheckpointDiff(
  directory: string,
  checkpoint: GitTaskCheckpoint,
  file: GitCheckpointFile,
): GitCheckpointDiff {
  return reviewGitCheckpointFile(
    file,
    readGitWorktreeFile(directory, checkpoint.snapshot.root, file.path),
  );
}

export function reviewGitCheckpointFile(
  file: GitCheckpointFile,
  current: GitFileState | undefined,
): GitCheckpointDiff {
  const diff = checkpointDiff(file);
  let conflict = file.conflict;
  if (!conflict && !sameGitFile(file.after, current)) conflict = "later-edit";
  if (!conflict && diff?.truncated && file.userEdits?.length) conflict = "ownership";
  const hunks = (diff?.hunks ?? []).map(
    (hunk) =>
      !conflict &&
      Boolean(file.before && file.after && !diff?.truncated) &&
      !editedRanges(hunk, "before").some((range) =>
        file.userEdits?.some((edit) => overlaps(range, edit)),
      ),
  );
  const hasConflicts = file.userEdits?.length && hunks.some((safe) => !safe);
  return {
    diff,
    revision: file.revision,
    hunks,
    wholeFile: !conflict && !hasConflicts && !sameGitFile(file.before, file.after) && Boolean(diff),
    conflict: conflict ?? (hasConflicts ? "ownership" : undefined),
    canOpen: Boolean(current && sameGitFile(file.after, current)),
  };
}

export function rollbackTarget(
  directory: string,
  checkpoint: GitTaskCheckpoint,
  file: GitCheckpointFile,
  selection: GitRollbackSelection,
): GitFileState {
  const detail = gitCheckpointDiff(directory, checkpoint, file);
  if (selection.revision !== file.revision || !detail.diff)
    throw new Error("检查点已更新，请重新预览撤销范围。");
  if (detail.conflict === "later-edit") throw new Error("文件已有后续改动，无法撤销此变更。");
  if (selection.hunks === undefined && detail.wholeFile) return file.before!;
  if (file.after && file.before && selection.hunks?.length) {
    const original = textLines(file.before.text);
    const result = textLines(file.after.text);
    const selected = [...new Set(selection.hunks)].sort((a, b) => b - a);
    if (selected.every((index) => detail.hunks[index])) {
      for (const index of selected) {
        const hunk = detail.diff.hunks[index];
        const before = hunk.filter((line) => line.before !== undefined);
        const after = hunk.filter((line) => line.after !== undefined);
        const from = (before[0]?.before ?? 1) - 1;
        const start = (after[0]?.after ?? 1) - 1;
        result.splice(start, after.length, ...original.slice(from, from + before.length));
      }
      return { text: result.join(""), mode: file.after.mode };
    }
  }
  throw new Error("选中的改动存在冲突，文件已保留。");
}

export async function verifyGitRollback(
  directory: string,
  snapshot: Pick<GitWorktree, "root" | "head">,
  files: readonly Pick<GitCheckpointFile, "path" | "index" | "after">[],
): Promise<void> {
  const [root, head] = await Promise.all([
    readGit(directory, ["rev-parse", "--show-toplevel"])
      .then((output) => realpath(output.replace(/\r?\n$/, "")))
      .catch(() => undefined),
    readGit(directory, ["rev-parse", "--verify", "--quiet", "HEAD"])
      .then((output) => output.trim())
      .catch((error: ExecFileException) => (error.code === 1 ? "(initial)" : undefined)),
  ]);
  if (!root || root !== snapshot.root || head !== snapshot.head)
    throw new Error("Git 工作树或 HEAD 已变更，无法撤销。");
  if (!files.length) return;
  const index = await readGitIndex(root, files.length === 1 ? files[0].path : undefined);
  for (const file of files) {
    if ((index.get(file.path) ?? "") !== file.index)
      throw new Error("文件的暂存内容已变更，无法撤销。");
    if (!sameGitFile(readGitWorktreeFile(directory, root, file.path), file.after))
      throw new Error("文件已有后续改动，无法撤销此变更。");
  }
}
