// @env browser
import type { ComposerDraft, DiffLineSpan, FileDiffLine } from "@shared/contract";

import { diffLineLabel } from "../../../shared/mentions";
import { GIT_ANNOTATION_EXCERPT_LENGTH } from "./constants";
import type { GitAnnotation, GitAnnotationSource } from "./types";

function lineSpan(rows: FileDiffLine[], side: "before" | "after"): DiffLineSpan | undefined {
  const first = rows.find((row) => row[side] !== undefined)?.[side];
  const last = rows.findLast((row) => row[side] !== undefined)?.[side];
  return first !== undefined && last !== undefined ? { first, last } : undefined;
}

export function makeGitAnnotation(
  source: GitAnnotationSource,
  anchor: number,
  focus: number,
): Omit<GitAnnotation, "message"> {
  const rows = source.diff.hunks[0].slice(Math.min(anchor, focus), Math.max(anchor, focus) + 1);
  const before = lineSpan(rows, "before");
  const after = lineSpan(rows, "after");
  const previousPath = before ? source.paths.previousPath : undefined;
  const { path } = source.paths;
  const openLine =
    source.canOpen && after
      ? source.lineTargets
        ? source.lineTargets[after.first]
        : after.first
      : undefined;
  const label = after
    ? path + ":" + diffLineLabel(after)
    : (previousPath ?? path) + ":" + (before ? diffLineLabel(before) : "");
  const excerpt = rows
    .map(({ kind, text }) => (kind === "added" ? "+ " : kind === "removed" ? "- " : "  ") + text)
    .join("\n");
  return {
    id: source.id,
    reference: {
      type: "file",
      id: path,
      label,
      meta: {
        workingDirectory: source.workingDirectory,
        diff: { area: source.area, before, after, previousPath, openLine },
      },
    },
    excerpt:
      excerpt.length > GIT_ANNOTATION_EXCERPT_LENGTH
        ? excerpt.slice(0, GIT_ANNOTATION_EXCERPT_LENGTH) + "\n…"
        : excerpt,
  };
}

export function gitAnnotationDraft(
  annotations: GitAnnotation[],
  introduction: string,
): ComposerDraft {
  const draft: ComposerDraft = [introduction];
  for (const [index, { reference, message, excerpt }] of annotations.entries()) {
    draft.push("\n\n" + (index + 1) + ". ", reference, "\n" + message + "\n" + excerpt);
  }
  return draft;
}
