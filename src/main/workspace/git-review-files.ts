// @env node
import { randomUUID } from "node:crypto";
import {
  chmodSync,
  linkSync,
  lstatSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute, join } from "node:path";
import { setImmediate } from "node:timers/promises";
import type { FileDiff, GitChange, GitFileDiff } from "@shared/contract";
import {
  GIT_FILE_READ_CONCURRENCY,
  GIT_STATUS_TIMEOUT_MS,
  MAX_GIT_CHECKPOINT_BYTES,
} from "./constants";
import { readFileSnapshot, textSnapshot } from "./file-changes";
import { readGit, readGitBuffer } from "./git";
import { hashGitBlob } from "./git-changes";
import { createToolPathResolver, isWithinDirectory } from "./paths";
import { buildTextDiff } from "./text-diff";
import type {
  GitCheckpointBase,
  GitCommandOptions,
  GitEntry,
  GitFileState,
  GitWorktree,
} from "./types";

export function gitFilePath(directory: string, root: string, path: string): string {
  const filename = join(root, path);
  if (
    !path ||
    isAbsolute(path) ||
    path.split("/").some((part) => part === ".." || part.toLowerCase() === ".git") ||
    (process.platform === "win32" && /[:\\]/.test(path)) ||
    filename === directory ||
    !isWithinDirectory(directory, filename) ||
    createToolPathResolver(directory)(filename) !== filename
  ) {
    throw new Error("文件位置已变更，无法撤销。");
  }
  return filename;
}

export function readGitWorktreeFile(
  directory: string,
  root: string,
  path: string,
): GitFileState | undefined {
  try {
    const filename = gitFilePath(directory, root, path);
    const before = lstatSync(filename, { throwIfNoEntry: false });
    if (!before) return null;
    if (!before.isFile() || before.nlink !== 1) return;
    const text = readFileSnapshot(filename);
    if (typeof text !== "string") return;
    const after = lstatSync(filename);
    if (
      after.ino !== before.ino ||
      after.dev !== before.dev ||
      after.mode !== before.mode ||
      after.nlink !== before.nlink ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs
    )
      return;
    return { text, mode: after.mode & 0o777 };
  } catch {
    return undefined;
  }
}

export function sameGitFile(a: GitFileState | undefined, b: GitFileState | undefined): boolean {
  if (a === undefined || b === undefined) return false;
  return a?.text === b?.text && a?.mode === b?.mode;
}

export async function readGitIndex(
  root: string,
  path?: string,
  options?: GitCommandOptions,
): Promise<Map<string, string>> {
  const output = await readGit(
    root,
    [
      "--literal-pathspecs",
      "ls-files",
      "--stage",
      "-z",
      "--",
      ...(path === undefined ? [] : [path]),
    ],
    options,
  );
  const files = new Map<string, string>();
  for (const record of output.split("\0")) {
    const separator = record.indexOf("\t");
    if (separator < 0) continue;
    const filename = record.slice(separator + 1);
    const entry = record.slice(0, separator);
    files.set(filename, (files.get(filename) ?? "") + entry + "\n");
  }
  return files;
}

export async function captureGitCheckpointBase(
  directory: string,
  snapshot: GitWorktree,
): Promise<GitCheckpointBase | undefined> {
  const { root, entries } = snapshot;
  try {
    const [index, untracked, ignored] = await Promise.all([
      readGitIndex(root),
      readGit(root, ["ls-files", "--others", "--exclude-standard", "-z"]),
      readGit(root, [
        "ls-files",
        "--others",
        "--ignored",
        "--exclude-standard",
        "--directory",
        "-z",
      ]),
    ]);
    const known = new Set([
      ...entries.flatMap(({ path, previousPath }) =>
        previousPath ? [path, previousPath] : [path],
      ),
      ...untracked.split("\0").filter(Boolean),
      ...index.keys(),
    ]);
    const files = new Map<string, GitFileState>();
    const started = performance.now();
    let bytes = 0;
    let count = 0;
    // Put dirty files first so the checkpoint retains user edits when the capture budget is reached.
    for (const path of known) {
      if (bytes >= MAX_GIT_CHECKPOINT_BYTES || performance.now() - started >= GIT_STATUS_TIMEOUT_MS)
        break;
      const state = readGitWorktreeFile(directory, root, path);
      if (state !== undefined) {
        bytes += state ? Buffer.byteLength(state.text) : 0;
        if (bytes <= MAX_GIT_CHECKPOINT_BYTES) files.set(path, state);
      }
      if (++count % GIT_FILE_READ_CONCURRENCY === 0) await setImmediate();
    }
    return {
      index,
      known,
      files,
      ignored: [
        ...ignored.split("\0").filter(Boolean),
        ...[...known].filter((path) => path.endsWith("/")),
      ],
    };
  } catch {
    return undefined;
  }
}

export async function readGitBlob(
  root: string,
  object: string | undefined,
): Promise<string | null | undefined> {
  if (!object || /^0+$/.test(object)) return null;
  if (!/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/.test(object)) return undefined;
  try {
    return textSnapshot(await readGitBuffer(root, ["cat-file", "blob", object]));
  } catch {
    return undefined;
  }
}

export function matchesGitEntry(
  snapshot: GitWorktree,
  entry: GitEntry | undefined,
  state: GitFileState | undefined,
): boolean {
  if (!entry) return state !== undefined;
  if (entry.kind === "deleted") return state === null;
  return Boolean(
    state &&
    entry.worktree?.mode === "file" &&
    hashGitBlob(snapshot.format, Buffer.from(state.text)) === entry.worktree.blob,
  );
}

function editorLineTargets(diff: FileDiff, shown: string, live: string): Record<number, number> {
  const alignment = buildTextDiff(
    shown.replaceAll("\r\n", "\n"),
    live.replaceAll("\r\n", "\n"),
  ).diff;
  if (alignment.truncated) return {};
  const regions = alignment.hunks.map((hunk) => ({
    from: hunk.find((line) => line.before !== undefined)?.before ?? 1,
    to: hunk.findLast((line) => line.before !== undefined)?.before ?? 0,
    end: hunk.findLast((line) => line.after !== undefined)?.after ?? 0,
    context: new Map(
      hunk.filter((line) => line.kind === "context").map((line) => [line.before, line.after]),
    ),
  }));
  const targets: Record<number, number> = {};
  for (const hunk of diff.hunks) {
    for (const { after: line } of hunk) {
      if (line === undefined) continue;
      const region = regions.findLast((item) => item.from <= line);
      const target = !region
        ? line
        : line <= region.to
          ? region.context.get(line)
          : line + region.end - region.to;
      if (target !== undefined) targets[line] = target;
    }
  }
  return targets;
}

async function gitWorktreeText(
  root: string,
  path: string,
  index: string,
  text: string,
): Promise<string> {
  if (!text.includes("\r\n") || index.includes("\r\n")) return text;
  try {
    const attrs = (
      await readGit(root, ["check-attr", "-z", "text", "eol", "crlf", "--", path])
    ).split("\0");
    const [, , textAttr, , , eol, , , crlf] = attrs;
    if (textAttr === "unset" || (textAttr === "unspecified" && crlf === "unset")) return text;
    const convert =
      textAttr === "set" ||
      textAttr === "auto" ||
      eol === "lf" ||
      eol === "crlf" ||
      crlf === "set" ||
      crlf === "input" ||
      /^(?:true|yes|on|1|input)$/i.test(
        (await readGit(root, ["config", "--get", "core.autocrlf"])).trim(),
      );
    // The Git comparison uses normalized line endings. The checkpoint retains the worktree bytes.
    return convert ? text.replaceAll("\r\n", "\n") : text;
  } catch {
    return text;
  }
}

export async function gitFileDiff(
  directory: string,
  snapshot: GitWorktree,
  change: GitChange,
  expected?: GitFileState,
  nativeDiff?: FileDiff,
): Promise<GitFileDiff> {
  const { root, entries } = snapshot;
  const { path, area, previousPath, resolved } = change;
  try {
    gitFilePath(directory, root, path);
    if (previousPath) gitFilePath(directory, root, previousPath);
  } catch {
    return { diff: null, canOpen: false };
  }
  const atPath = entries.find((entry) => entry.path === path && entry.area === area);
  const source =
    previousPath && !atPath
      ? entries.find((entry) => entry.path === previousPath && entry.area === area)
      : atPath;
  if (resolved || change.kind === "conflicted" || (!atPath && !source))
    return { diff: null, canOpen: false };
  const worktree = readGitWorktreeFile(directory, root, path);
  const current = entries.find((entry) => entry.path === path && entry.area !== "staged");
  const after =
    area === "staged"
      ? await readGitBlob(root, atPath?.indexBlob)
      : expected !== undefined
        ? (expected?.text ?? null)
        : matchesGitEntry(snapshot, current, worktree)
          ? (worktree?.text ?? null)
          : undefined;
  const before =
    area === "untracked"
      ? null
      : await readGitBlob(root, area === "staged" ? atPath?.headBlob : source?.indexBlob);
  const shown =
    area === "unstaged" && typeof before === "string" && typeof after === "string"
      ? await gitWorktreeText(root, path, before, after)
      : after;
  const diff =
    nativeDiff ??
    (before !== undefined && shown !== undefined ? buildTextDiff(before, shown ?? "").diff : null);
  if (typeof after !== "string" || !worktree) return { diff, canOpen: false };
  if (worktree.text === after) return { diff, canOpen: true };
  const lineTargets =
    area === "staged" && diff ? editorLineTargets(diff, after, worktree.text) : undefined;
  return { diff, canOpen: Boolean(lineTargets && Object.keys(lineTargets).length), lineTargets };
}

export function replaceGitWorktreeFile(
  directory: string,
  root: string,
  path: string,
  before: GitFileState,
  after: GitFileState,
): void {
  const filename = gitFilePath(directory, root, path);
  const verify = (): void => {
    if (!sameGitFile(readGitWorktreeFile(directory, root, path), before)) {
      throw new Error("文件已有后续改动，无法撤销此变更。");
    }
  };
  verify();
  if (!after) {
    unlinkSync(filename);
    return;
  }
  // Keeping the temporary file beside the target makes replacement atomic within the worktree.
  const temporary = join(dirname(filename), `.pilot-rollback-${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, after.text, { mode: after.mode, flag: "wx", flush: true });
    chmodSync(temporary, after.mode);
    verify();
    if (before) renameSync(temporary, filename);
    else linkSync(temporary, filename);
  } finally {
    rmSync(temporary, { force: true });
  }
}
