// @env node
import { randomUUID } from "node:crypto";

import type { MemoryPreview, MemoryScope } from "@shared/contract";

import { MEMORY_TEXT_LIMIT } from "../../shared/constants";
import { MAX_FILE_SNAPSHOT_BYTES } from "../workspace/constants";
import {
  gitFilePath,
  readGitWorktreeFile,
  replaceGitWorktreeFile,
  sameGitFile,
} from "../workspace/git-review-files";
import { buildTextDiff } from "../workspace/text-diff";
import type { GitFileState } from "../workspace/types";
import {
  MEMORY_ALREADY_EXISTS,
  MEMORY_PREVIEW_STALE,
  MEMORY_TEXT_REQUIRED,
  MEMORY_UNDO_CONFLICT,
  PROJECT_INSTRUCTION_FILES,
} from "./constants";
import type { HostDeps, MemoryChange } from "./types";

function projectTarget(directory: string): { filename: string; before: GitFileState } {
  for (const filename of PROJECT_INSTRUCTION_FILES) {
    const before = readGitWorktreeFile(directory, directory, filename);
    if (before === undefined) throw new Error("无法预览项目指令。请检查文件位置、大小和访问权限。");
    if (before) return { filename, before };
  }
  return { filename: PROJECT_INSTRUCTION_FILES[0], before: null };
}

function appendMemory(before: string | null | undefined, text: string): string {
  const existing = before ?? "";
  const note = text.trim().replace(/\r\n?/g, "\n");
  if (!note || note.includes("\0") || note.length > MEMORY_TEXT_LIMIT)
    throw new Error(MEMORY_TEXT_REQUIRED);
  if (
    ("\n" + existing.replace(/^\uFEFF/, "").replace(/\r\n/g, "\n") + "\n").includes(
      "\n" + note + "\n",
    )
  )
    throw new Error(MEMORY_ALREADY_EXISTS);
  const newline = existing.match(/\r?\n/)?.[0] ?? "\n";
  const gap =
    !existing || existing === "\uFEFF" || existing.endsWith(newline + newline)
      ? ""
      : existing.endsWith(newline)
        ? newline
        : newline + newline;
  return existing + gap + note.replaceAll("\n", newline) + newline;
}

export class MemoryChanges {
  private pending?: MemoryChange;
  private saved?: MemoryChange;

  constructor(private readonly deps: Pick<HostDeps, "getSettings" | "saveSettings">) {}

  preview(
    composerId: string,
    directory: string | undefined,
    scope: MemoryScope,
    text: string,
  ): MemoryPreview {
    this.pending = undefined;
    const ref = { composerId, token: randomUUID() };
    let pending: MemoryChange;
    let path: string | null = null;
    if (scope === "project") {
      if (!directory) throw new Error("请先打开项目，或选择全局个性化。");
      const { filename, before } = projectTarget(directory);
      const appended = appendMemory(before?.text, text);
      if (Buffer.byteLength(appended) > MAX_FILE_SNAPSHOT_BYTES)
        throw new Error("项目指令超出差异预览上限。请缩短内容或选择全局个性化。");
      const mode =
        before?.mode ?? (process.platform === "win32" ? 0o666 : 0o666 & ~process.umask());
      pending = { ...ref, scope, directory, filename, before, after: { text: appended, mode } };
      path = gitFilePath(directory, directory, filename);
    } else {
      const before = this.deps.getSettings().persona;
      pending = { ...ref, scope, before, after: appendMemory(before, text) };
    }
    const { diff } =
      pending.scope === "project"
        ? buildTextDiff(pending.before?.text ?? null, pending.after.text)
        : buildTextDiff(pending.before ?? null, pending.after);
    if (diff.truncated) throw new Error("差异超出预览上限。请缩短记忆内容后重试。");
    this.pending = pending;
    return { token: ref.token, path, diff };
  }

  save(composerId: string, token: string, directory: string | undefined): void {
    const change = this.pending;
    if (change?.token !== token || change.composerId !== composerId)
      throw new Error(MEMORY_PREVIEW_STALE);
    if (change.scope === "project") {
      if (directory !== change.directory) throw new Error(MEMORY_PREVIEW_STALE);
      const { filename, before } = projectTarget(directory);
      if (filename !== change.filename || !sameGitFile(before, change.before))
        throw new Error(MEMORY_PREVIEW_STALE);
      replaceGitWorktreeFile(directory, directory, filename, change.before, change.after);
    } else {
      this.changePersona(change.before, change.after, MEMORY_PREVIEW_STALE);
    }
    this.saved = change;
    this.pending = undefined;
  }

  undo(composerId: string, token: string, directory: string | undefined): void {
    const change = this.saved;
    if (change?.token !== token || change.composerId !== composerId)
      throw new Error(MEMORY_UNDO_CONFLICT);
    if (change.scope === "project") {
      if (
        directory !== change.directory ||
        !sameGitFile(readGitWorktreeFile(directory, directory, change.filename), change.after)
      )
        throw new Error(MEMORY_UNDO_CONFLICT);
      replaceGitWorktreeFile(directory, directory, change.filename, change.after, change.before);
    } else {
      this.changePersona(change.after, change.before, MEMORY_UNDO_CONFLICT);
    }
    this.saved = undefined;
  }

  private changePersona(from: string | undefined, to: string | undefined, conflict: string): void {
    const settings = this.deps.getSettings();
    if (settings.persona !== from) throw new Error(conflict);
    this.deps.saveSettings({ ...settings, persona: to });
  }
}
