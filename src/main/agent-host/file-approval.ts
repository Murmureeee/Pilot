// @env node
import { Buffer } from "node:buffer";

import type { PermissionFilePreview } from "@shared/contract";

import { MAX_FILE_SNAPSHOT_BYTES } from "../workspace/constants";
import { readFileSnapshot, textSnapshot } from "../workspace/file-changes";
import { createToolPathResolver } from "../workspace/paths";
import { buildTextDiff } from "../workspace/text-diff";
import { pathOfArgs } from "./tools";
import { applyFileEdit } from "./tools/file-tools";
import type { FileApprovalBaseline, FileApprovalReview } from "./types";

export function previewFileApproval(
  name: string,
  args: unknown,
  workingDirectory?: string,
): FileApprovalReview | undefined {
  if (name !== "write_file" && name !== "edit_file") return;
  const target = pathOfArgs(args);
  if (target === undefined || !args || typeof args !== "object") return;
  const file: PermissionFilePreview = {
    path: target,
    operation: name === "edit_file" ? "edit" : "write",
  };
  try {
    const path = createToolPathResolver(workingDirectory)(target);
    file.path = path;
    const before = readFileSnapshot(path);
    if (name === "write_file" && before !== undefined)
      file.operation = before === null ? "create" : "overwrite";
    const unavailable = "无法生成文本差异。请核对文件类型和大小。";
    if (before === undefined) return { file: { ...file, error: unavailable } };
    let after: string;
    if (name === "write_file" && "content" in args && typeof args.content === "string") {
      after = args.content;
    } else if (
      name === "edit_file" &&
      "oldText" in args &&
      typeof args.oldText === "string" &&
      "newText" in args &&
      typeof args.newText === "string"
    ) {
      if (before === null) return { file: { ...file, error: "找不到要编辑的文件。" } };
      after = applyFileEdit(before, {
        oldText: args.oldText,
        newText: args.newText,
        replaceAll: "replaceAll" in args && args.replaceAll === true,
      }).next;
    } else {
      return { file: { ...file, error: "无法根据当前参数预览此操作。" } };
    }
    if (
      Buffer.byteLength(after) > MAX_FILE_SNAPSHOT_BYTES ||
      textSnapshot(Buffer.from(after)) === undefined
    )
      return { file: { ...file, error: unavailable } };
    return {
      file: { ...file, diff: buildTextDiff(before, after).diff },
      baseline: { path, before },
    };
  } catch (error) {
    return { file: { ...file, error: error instanceof Error ? error.message : String(error) } };
  }
}

export function verifyApprovedFile(
  baseline: FileApprovalBaseline,
  args: unknown,
  workingDirectory?: string,
): void {
  const target = pathOfArgs(args);
  const path = target === undefined ? undefined : createToolPathResolver(workingDirectory)(target);
  if (path !== baseline.path || readFileSnapshot(path) !== baseline.before)
    throw new Error("文件在生成预览后发生变化。请核对更新后的差异再审批。");
}
