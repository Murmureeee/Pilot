// @env node
import { isUtf8 } from "node:buffer";
import type { ExecFileException } from "node:child_process";
import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { lstat, open, readlink, realpath } from "node:fs/promises";
import { dirname, join } from "node:path";

import type { GitChange, GitChangesView } from "@shared/contract";

import {
  GIT_FILE_READ_CONCURRENCY,
  GIT_STATUS_TIMEOUT_MS,
  MAX_FILE_SNAPSHOT_BYTES,
} from "./constants";
import { readGit } from "./git";
import { createToolPathResolver, isWithinDirectory } from "./paths";
import type { GitEntry, GitObjectFormat, GitSnapshot, WorktreeFingerprint } from "./types";

function changeKind(code: string): GitChange["kind"] {
  switch (code) {
    case "A":
    case "C":
      return "added";
    case "D":
      return "deleted";
    case "R":
      return "renamed";
    default:
      return "modified";
  }
}

function parseStatus(output: string): { head: string; entries: GitEntry[] } {
  const records = output.split("\0");
  const entries: GitEntry[] = [];
  let head: string | undefined;
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    if (record.startsWith("# branch.oid ")) head = record.slice("# branch.oid ".length);
    const fields = record.split(" ");
    const [tag, xy, submodule, headMode, indexMode, worktreeMode, headBlob, indexBlob] = fields;
    switch (tag) {
      case "?":
        entries.push({
          path: record.slice(2),
          area: "untracked",
          kind: "added",
          fingerprint: null,
        });
        break;
      case "u":
        entries.push({
          path: fields.slice(10).join(" "),
          area: "unstaged",
          kind: "conflicted",
          fingerprint: null,
        });
        break;
      case "1":
      case "2": {
        const path = fields.slice(tag === "2" ? 9 : 8).join(" ");
        const previousPath = tag === "2" ? records[++i] : undefined;
        const [indexCode, worktreeCode] = xy;
        if (indexCode !== ".") {
          entries.push({
            path,
            area: "staged",
            kind: changeKind(indexCode),
            previousPath: indexCode === "R" ? previousPath : undefined,
            headBlob,
            indexBlob,
            indexMode,
            fingerprint: [headMode, indexMode, headBlob, indexBlob].join(":"),
          });
        }
        if (worktreeCode !== ".") {
          entries.push({
            path,
            area: "unstaged",
            kind: changeKind(worktreeCode),
            previousPath: worktreeCode === "R" ? previousPath : undefined,
            headBlob,
            indexBlob,
            indexMode,
            worktreeMode,
            fingerprint:
              worktreeCode === "D"
                ? [submodule, indexMode, indexBlob, worktreeMode].join(":")
                : null,
          });
        }
        break;
      }
    }
  }
  if (!head) throw new Error("Git status did not include HEAD");
  return { head, entries };
}

export function hashGitBlob(format: GitObjectFormat, content: Buffer): string {
  return createHash(format).update(`blob ${content.length}\0`).update(content).digest("hex");
}

async function fingerprintWorktreeFile(
  root: string,
  path: string,
  format: GitObjectFormat,
  checkLineEndings: boolean,
  signal: AbortSignal,
): Promise<WorktreeFingerprint | undefined> {
  if (signal.aborted) return;
  try {
    const filename = join(root, path);
    if (!isWithinDirectory(root, await realpath(dirname(filename)))) return;
    const stat = await lstat(filename);
    if (stat.isSymbolicLink()) {
      return {
        mode: "symlink",
        blob: hashGitBlob(format, await readlink(filename, { encoding: "buffer" })),
      };
    }
    if (!stat.isFile()) return;

    const file = await open(filename, (constants.O_NOFOLLOW ?? 0) | (constants.O_NONBLOCK ?? 0));
    try {
      const initial = await file.stat();
      if (!initial.isFile() || initial.ino !== stat.ino || initial.dev !== stat.dev) return;
      const hash = createHash(format).update(`blob ${initial.size}\0`);
      const chunks: Buffer[] | undefined =
        checkLineEndings && initial.size <= MAX_FILE_SNAPSHOT_BYTES ? [] : undefined;
      let size = 0;
      for await (const chunk of file.createReadStream({
        autoClose: false,
        signal,
      }) as AsyncIterable<Buffer>) {
        hash.update(chunk);
        size += chunk.length;
        if (size <= MAX_FILE_SNAPSHOT_BYTES) chunks?.push(chunk);
      }
      const final = await lstat(filename);
      if (
        size !== initial.size ||
        final.size !== initial.size ||
        final.ino !== initial.ino ||
        final.dev !== initial.dev ||
        final.mtimeMs !== initial.mtimeMs ||
        final.ctimeMs !== initial.ctimeMs
      )
        return;

      const content = chunks && Buffer.concat(chunks);
      const blob = hash.digest("hex");
      // Windows files may have CRLF on disk even when the index stores LF.
      const lfBlob =
        content && content.includes("\r\n") && !content.includes(0) && isUtf8(content)
          ? hashGitBlob(format, Buffer.from(content.toString("utf8").replaceAll("\r\n", "\n")))
          : undefined;
      return { mode: "file", blob, lfBlob };
    } finally {
      await file.close();
    }
  } catch {
    return undefined;
  }
}

function detectWorktreeRenames(entries: GitEntry[], baseline: GitEntry[]): GitEntry[] {
  if (!entries.some((entry) => entry.area === "unstaged" && entry.kind === "deleted"))
    return entries;
  const oldWorktree = new Map(
    baseline
      .filter((entry) => entry.area === "unstaged")
      .map((entry) => [entry.path, entry.worktree]),
  );
  const sources = new Map<string, GitEntry[]>();
  const destinations = new Map<string, GitEntry[]>();
  const sourceKeys = new Map<GitEntry, Set<string>>();
  const destinationKeys = new Map<GitEntry, Set<string>>();
  const add = (index: Map<string, GitEntry[]>, keys: Set<string>, entry: GitEntry): void => {
    for (const key of keys) {
      const matches = index.get(key);
      if (matches) matches.push(entry);
      else index.set(key, [entry]);
    }
  };
  for (const entry of entries) {
    if (entry.area === "unstaged" && entry.kind === "deleted" && entry.indexBlob) {
      const keys = new Set<string>();
      if (entry.indexMode === "120000") keys.add("symlink:" + entry.indexBlob);
      if (entry.indexMode?.startsWith("100")) keys.add("file:" + entry.indexBlob);
      const old = oldWorktree.get(entry.path);
      if (old) keys.add(old.mode + ":" + old.blob);
      sourceKeys.set(entry, keys);
      add(sources, keys, entry);
    }
    if (entry.area === "untracked" && entry.worktree) {
      const { mode, blob, lfBlob } = entry.worktree;
      const keys = new Set([mode + ":" + blob]);
      if (lfBlob) keys.add(mode + ":" + lfBlob);
      destinationKeys.set(entry, keys);
      add(destinations, keys, entry);
    }
  }

  const unique = (index: Map<string, GitEntry[]>, keys: Set<string>): GitEntry | undefined => {
    let match: GitEntry | undefined;
    for (const key of keys) {
      const matches = index.get(key);
      if (!matches) continue;
      if (matches.length > 1 || (match && match !== matches[0])) return;
      match = matches[0];
    }
    return match;
  };
  const paired = new Set<GitEntry>();
  const renames = new Map<GitEntry, GitEntry>();
  for (const [source, keys] of sourceKeys) {
    const destination = unique(destinations, keys);
    if (!destination || unique(sources, destinationKeys.get(destination)!) !== source) continue;
    renames.set(source, {
      ...source,
      kind: "renamed",
      previousPath: source.path,
      path: destination.path,
      fingerprint: source.fingerprint + ":" + destination.fingerprint,
    });
    paired.add(destination);
  }
  return entries.filter((entry) => !paired.has(entry)).map((entry) => renames.get(entry) ?? entry);
}

export async function captureGitSnapshot(directory: string | undefined): Promise<GitSnapshot> {
  if (!directory) return null;
  try {
    const cwd = createToolPathResolver(directory)(".");
    const info = await readGit(cwd, ["rev-parse", "--show-toplevel", "--show-object-format"]);
    const end = info.lastIndexOf("\n", info.length - 2);
    const root = await realpath(info.slice(0, end).replace(/\r$/, ""));
    const format = info.slice(end + 1).trim();
    if (format !== "sha1" && format !== "sha256") return { unavailable: true };
    const { head, entries } = parseStatus(
      await readGit(root, [
        "status",
        "--porcelain=v2",
        "-z",
        "--branch",
        "--untracked-files=all",
        "--find-renames",
      ]),
    );
    const checkRenames = entries.some(
      (entry) => entry.area === "unstaged" && entry.kind === "deleted",
    );
    const files = entries.filter(
      (entry) =>
        entry.area !== "staged" && entry.fingerprint === null && entry.kind !== "conflicted",
    );
    const signal = AbortSignal.timeout(GIT_STATUS_TIMEOUT_MS);
    for (let i = 0; i < files.length && !signal.aborted; i += GIT_FILE_READ_CONCURRENCY) {
      await Promise.all(
        files.slice(i, i + GIT_FILE_READ_CONCURRENCY).map(async (entry) => {
          const candidate = checkRenames && entry.area === "untracked";
          const fingerprint = await fingerprintWorktreeFile(
            root,
            entry.path,
            format,
            candidate,
            signal,
          );
          if (!fingerprint) return;
          entry.fingerprint = [
            entry.indexMode,
            entry.indexBlob,
            entry.worktreeMode,
            fingerprint.mode,
            fingerprint.blob,
          ].join(":");
          entry.worktree = fingerprint;
        }),
      );
    }
    return { root, head, format, entries };
  } catch (error) {
    const { code, stderr } = error as ExecFileException & { stderr?: string };
    if (
      code === "ENOENT" ||
      (code === 128 && /not a git repository|must be run in a work tree/.test(stderr ?? ""))
    )
      return null;
    return { unavailable: true };
  }
}

export function compareGitSnapshots(
  baseline: GitSnapshot | undefined,
  current: GitSnapshot,
  phase: GitChangesView["phase"],
  interrupted = false,
): GitChangesView | null {
  if (!current && (!baseline || "unavailable" in baseline)) return null;
  if (!current || "unavailable" in current) return { phase, changes: null };
  const before = baseline && "root" in baseline && baseline.root === current.root ? baseline : null;
  const key = (area: GitChange["area"], path: string): string => area + ":" + path;
  const previousEntries = new Map<string, GitEntry>();
  const previousPaths = new Set<string>();
  const baselineEntries = before ? detectWorktreeRenames(before.entries, []) : [];
  for (const entry of baselineEntries) {
    previousEntries.set(key(entry.area, entry.path), entry);
    previousPaths.add(entry.path);
    if (entry.previousPath) previousPaths.add(entry.previousPath);
  }

  const currentPaths = new Set<string>();
  const sameHead = before?.head === current.head;
  const changes = detectWorktreeRenames(
    current.entries,
    sameHead ? (before?.entries ?? []) : [],
  ).map((entry): GitChange => {
    const { fingerprint, area, path, previousPath, kind } = entry;
    const change = { area, path, previousPath, kind };
    const id = key(area, path);
    const previous = previousEntries.get(id);
    currentPaths.add(id);
    if (previousPath) currentPaths.add(key(area, previousPath));
    const matches =
      fingerprint !== null &&
      previous?.fingerprint === fingerprint &&
      previous.kind === kind &&
      previous.previousPath === previousPath;
    if (phase === "workspace" || matches) return { ...change, origin: "existing" };
    const mixed =
      interrupted ||
      !sameHead ||
      fingerprint === null ||
      previousPaths.has(path) ||
      (previousPath !== undefined && previousPaths.has(previousPath));
    return { ...change, origin: mixed ? "mixed" : "task" };
  });
  for (const { area, path, previousPath, kind } of baselineEntries) {
    if (!currentPaths.has(key(area, path))) {
      changes.push({ area, path, previousPath, kind, resolved: true, origin: "mixed" });
    }
  }
  return { phase, changes: changes.sort((a, b) => a.path.localeCompare(b.path)) };
}
