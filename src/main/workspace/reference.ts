// @env node
import { opendirSync, statSync } from "node:fs";
import { relative, sep } from "node:path";

import { z } from "zod";

import type {
  GitDiffReference,
  WorkspaceEntry,
  WorkspaceReferencePreview,
  WorkspaceReferenceRequest,
} from "@shared/contract";

import { MAX_DIRECTORY_PREVIEW_ENTRIES } from "./constants";
import { readFileSnapshot } from "./file-changes";
import { createToolPathResolver } from "./paths";

const lineNumber = z.number().int().positive();
const lineSpan = z
  .strictObject({ first: lineNumber, last: lineNumber })
  .refine(({ first, last }) => first <= last);

export const gitDiffReferenceSchema = z
  .strictObject({
    area: z.enum(["staged", "unstaged", "untracked"]),
    previousPath: z
      .string()
      .min(1)
      .refine((value) => !value.includes("\0"))
      .optional(),
    before: lineSpan.optional(),
    after: lineSpan.optional(),
    openLine: lineNumber.optional(),
  })
  .refine(
    ({ before, after, openLine, previousPath, area }) =>
      Boolean(before || after) &&
      (!openLine || Boolean(after)) &&
      (!previousPath || Boolean(before)) &&
      (area !== "untracked" || !before),
  ) satisfies z.ZodType<GitDiffReference>;

export function previewWorkspaceReference(
  workingDirectory: string | undefined,
  reference: WorkspaceReferenceRequest,
): WorkspaceReferencePreview {
  if (!workingDirectory) throw new Error("请先选择工作目录。");
  if (reference.workingDirectory && reference.workingDirectory !== workingDirectory) {
    throw new Error("工作目录已变更，请重新选择文件引用。");
  }
  try {
    const target = createToolPathResolver(workingDirectory)(reference.path);
    const path = relative(workingDirectory, target).split(sep).join("/") || ".";
    const file = statSync(target);
    if (file.isFile()) return { kind: "file", path, text: readFileSnapshot(target) ?? null };
    if (!file.isDirectory()) throw new Error("Unsupported workspace entry");

    const entries: WorkspaceEntry[] = [];
    const directory = opendirSync(target);
    let truncated = false;
    try {
      for (let index = 0; index <= MAX_DIRECTORY_PREVIEW_ENTRIES; index++) {
        const entry = directory.readSync();
        if (!entry) break;
        if (index === MAX_DIRECTORY_PREVIEW_ENTRIES) {
          truncated = true;
          break;
        }
        const kind = entry.isDirectory() ? "directory" : entry.isFile() ? "file" : undefined;
        if (!kind) continue;
        entries.push({ path: path === "." ? entry.name : path + "/" + entry.name, kind });
      }
    } finally {
      directory.closeSync();
    }
    entries.sort((a, b) => a.kind.localeCompare(b.kind) || a.path.localeCompare(b.path));
    return { kind: "directory", path, entries, truncated };
  } catch (cause) {
    throw new Error("无法预览该工作目录中的文件或文件夹。", { cause });
  }
}
