// @env node
import { isUtf8 } from "node:buffer";
import { createHash } from "node:crypto";
import { isAbsolute, join, resolve } from "node:path";

import type { FileDiffLine, GitChange, GitPatchSelection } from "@shared/contract";

import { MAX_DIFF_PREVIEW_LINES } from "./constants";
import { readGitBuffer, resolveGitDirectory } from "./git";
import { isWithinDirectory } from "./paths";
import type { GitCommandOptions, GitPatchHunk, GitSelectionReview, GitWorktree } from "./types";

export async function readGitPatch(
  root: string,
  args: string[],
  options?: GitCommandOptions,
): Promise<Buffer> {
  return readGitBuffer(
    root,
    [
      "-c",
      "core.quotePath=true",
      "-c",
      "diff.suppressBlankEmpty=false",
      "--literal-pathspecs",
      "diff",
      "--patch",
      "--binary",
      "--full-index",
      "--no-color",
      "--no-ext-diff",
      "--no-textconv",
      "--no-relative",
      "--src-prefix=a/",
      "--dst-prefix=b/",
      "--output-indicator-old=-",
      "--output-indicator-new=+",
      "--output-indicator-context= ",
      "--ignore-submodules=none",
      "--submodule=short",
      "--unified=3",
      "--inter-hunk-context=0",
      ...args,
    ],
    options,
  );
}

export function displayGitPatch(patch: Buffer): string {
  // Keep non-UTF-8 bytes distinguishable in the preview.
  return isUtf8(patch)
    ? patch.toString("utf8")
    : patch
        .toString("latin1")
        .replace(
          /[\u0080-\u00ff]/g,
          (byte) => "\\x" + byte.charCodeAt(0).toString(16).padStart(2, "0"),
        );
}

function parsePartialPatch(patch: Buffer): GitSelectionReview["partial"] {
  if (!isUtf8(patch)) return;
  const parts = patch
    .toString("utf8")
    .replace(/\n$/, "")
    .split(/\n(?=@@ )/);
  const header = parts.shift() ?? "";
  if (
    parts.length === 0 ||
    !/^index [a-f0-9]+\.\.[a-f0-9]+ 100(?:644|755)$/m.test(header) ||
    patch.includes(Buffer.from("\ndiff --git "))
  )
    return;
  const hunks: GitPatchHunk[] = [];
  const diff: FileDiffLine[][] = [];
  let lineCount = 0;
  for (const part of parts) {
    const [heading, ...lines] = part.split("\n");
    const range = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(heading);
    if (!range || (lineCount += lines.length) > MAX_DIFF_PREVIEW_LINES) return;
    let before = Number(range[1]);
    let after = Number(range[3]);
    const shown: FileDiffLine[] = [];
    for (const line of lines) {
      const text = line.slice(1).replace(/\r$/, "");
      switch (line[0]) {
        case "+":
          shown.push({ kind: "added", text, after: after++ });
          break;
        case "-":
          shown.push({ kind: "removed", text, before: before++ });
          break;
        case " ":
          shown.push({ kind: "context", text, before: before++, after: after++ });
          break;
        case "\\":
          if (shown.length) shown[shown.length - 1].noNewline = true;
          break;
        default:
          return;
      }
    }
    diff.push(shown);
    hunks.push({
      header: heading,
      lines,
      newStart: Number(range[3]),
      delta: Number(range[4] ?? 1) - Number(range[2] ?? 1),
    });
  }
  return { header, hunks, diff: { hunks: diff, truncated: false } };
}

export async function readGitSelection(
  directory: string,
  snapshot: GitWorktree,
  change: GitChange,
  options?: GitCommandOptions,
): Promise<GitSelectionReview> {
  const project = resolveGitDirectory(directory);
  const paths = change.previousPath ? [change.previousPath, change.path] : [change.path];
  const valid = paths.every(
    (path) =>
      path &&
      !isAbsolute(path) &&
      !path
        .split("/")
        .some((part) => !part || part === "." || part === ".." || /^\.git$/i.test(part)) &&
      !(process.platform === "win32" && /[:\\]/.test(path)) &&
      resolve(snapshot.root, path) !== project &&
      isWithinDirectory(project, join(snapshot.root, path)),
  );
  if (!valid || change.kind === "conflicted" || change.resolved)
    return { paths, patch: Buffer.alloc(0) };
  const args =
    change.area === "staged"
      ? [
          "--cached",
          "--ita-invisible-in-index",
          ...(snapshot.head === "(initial)" ? [] : [snapshot.head]),
        ]
      : ["--ita-invisible-in-index"];
  const patch =
    change.area === "untracked"
      ? Buffer.alloc(0)
      : await readGitPatch(snapshot.root, [...args, "--no-renames", "--", ...paths], options);
  const entries = snapshot.entries.filter(
    (entry) => paths.includes(entry.path) && (change.area !== "staged" || entry.area === "staged"),
  );
  const revision = createHash("sha256")
    .update(JSON.stringify([snapshot.root, snapshot.head, change.area, paths, entries]))
    .update(patch)
    .digest("hex");
  const partial =
    change.kind === "modified" && paths.length === 1 ? parsePartialPatch(patch) : undefined;
  return { paths, revision, patch, partial };
}

export function selectedGitPatch(review: GitSelectionReview, selection: GitPatchSelection): Buffer {
  if (!review.revision || review.revision !== selection.revision)
    throw new Error("Git 变更已更新，请重新查看差异。");
  if (!selection.hunks) return review.patch;
  const { partial } = review;
  const chosen = new Set(selection.hunks);
  if (!partial || !chosen.size || [...chosen].some((index) => !partial.hunks[index]))
    throw new Error("无法选中这些 Git 区块。");

  let skippedDelta = 0;
  const lines = [partial.header];
  for (const [index, hunk] of partial.hunks.entries()) {
    if (!chosen.has(index)) {
      skippedDelta += hunk.delta;
      continue;
    }
    // A skipped insertion or deletion changes the positions in the resulting file.
    lines.push(
      hunk.header.replace(
        /^(@@ -\d+(?:,\d+)? \+)\d+/,
        (_, prefix: string) => prefix + (hunk.newStart - skippedDelta),
      ),
      ...hunk.lines,
    );
  }
  return Buffer.from(lines.join("\n") + "\n");
}
