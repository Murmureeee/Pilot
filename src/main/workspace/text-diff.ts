// @env node
import type { FileChangeSummary, FileDiff, FileDiffLine } from "@shared/contract";
import {
  DIFF_CONTEXT_LINES,
  MAX_DIFF_COMPARISONS,
  MAX_DIFF_PREVIEW_LINES,
  MAX_DIFF_SEARCH_DISTANCE,
} from "./constants";

function previousDiagonal(
  frontier: Int32Array,
  offset: number,
  diagonal: number,
  distance: number,
): number {
  return diagonal === -distance ||
    (diagonal !== distance && frontier[offset + diagonal - 1] < frontier[offset + diagonal + 1])
    ? diagonal + 1
    : diagonal - 1;
}

function reconstruct(
  history: Int32Array[],
  offset: number,
  x: number,
  y: number,
): FileDiffLine["kind"][] {
  const kinds: FileDiffLine["kind"][] = [];
  for (let distance = history.length - 1; distance >= 0; distance--) {
    const frontier = history[distance];
    const diagonal = previousDiagonal(frontier, offset, x - y, distance);
    const previousX = frontier[offset + diagonal];
    const previousY = previousX - diagonal;
    while (x > previousX && y > previousY) {
      kinds.push("context");
      x--;
      y--;
    }
    if (distance === 0) break;
    if (x === previousX) {
      kinds.push("added");
      y--;
    } else {
      kinds.push("removed");
      x--;
    }
  }
  return kinds.reverse();
}

function myers(before: string[], after: string[]): FileDiffLine["kind"][] | undefined {
  const limit = Math.min(before.length + after.length, MAX_DIFF_SEARCH_DISTANCE);
  if (Math.abs(before.length - after.length) > limit) return undefined;
  const offset = limit + 1;
  const frontier = new Int32Array(2 * offset + 1).fill(-1);
  const history: Int32Array[] = [];
  frontier[offset + 1] = 0;
  let comparisons = 0;
  for (let distance = 0; distance <= limit; distance++) {
    history.push(frontier.slice());
    for (let diagonal = -distance; diagonal <= distance; diagonal += 2) {
      const previous = previousDiagonal(frontier, offset, diagonal, distance);
      let x = frontier[offset + previous] + Number(previous < diagonal);
      let y = x - diagonal;
      while (x < before.length && y < after.length && before[x] === after[y]) {
        if (++comparisons > MAX_DIFF_COMPARISONS) return undefined;
        x++;
        y++;
      }
      frontier[offset + diagonal] = x;
      if (x >= before.length && y >= after.length) return reconstruct(history, offset, x, y);
    }
  }
  return undefined;
}

export function buildTextDiff(
  before: string | null,
  after: string,
): { stats: NonNullable<FileChangeSummary["stats"]>; diff: FileDiff } {
  const original = before?.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  const modified = after.match(/[^\n]*\n|[^\n]+$/g) ?? [];
  let prefix = 0;
  let suffix = 0;
  const common = Math.min(original.length, modified.length);
  while (prefix < common && original[prefix] === modified[prefix]) prefix++;
  while (prefix + suffix < common && original.at(-1 - suffix) === modified.at(-1 - suffix))
    suffix++;

  const oldMiddle = original.slice(prefix, original.length - suffix);
  const newMiddle = modified.slice(prefix, modified.length - suffix);
  const kinds: FileDiffLine["kind"][] = myers(oldMiddle, newMiddle) ?? [
    ...oldMiddle.map(() => "removed" as const),
    ...newMiddle.map(() => "added" as const),
  ];
  const leading = Math.min(prefix, DIFF_CONTEXT_LINES);
  const trailing = Math.min(suffix, DIFF_CONTEXT_LINES);
  const rows: FileDiffLine["kind"][] = [
    ...Array.from({ length: leading }, () => "context" as const),
    ...kinds,
    ...Array.from({ length: trailing }, () => "context" as const),
  ];
  const ranges: { start: number; end: number }[] = [];
  const stats = { added: 0, removed: 0 };
  for (const [index, kind] of rows.entries()) {
    if (kind === "context") continue;
    if (kind === "added") stats.added++;
    else stats.removed++;
    const start = Math.max(0, index - DIFF_CONTEXT_LINES);
    const end = Math.min(rows.length, index + 1 + DIFF_CONTEXT_LINES);
    const last = ranges.at(-1);
    if (last && start <= last.end) last.end = end;
    else ranges.push({ start, end });
  }

  const hunks: FileDiffLine[][] = [];
  let remaining = MAX_DIFF_PREVIEW_LINES;
  let oldIndex = prefix - leading;
  let newIndex = oldIndex;
  let cursor = 0;
  for (const { start, end } of ranges) {
    // The gaps between hunks contain only unchanged lines.
    oldIndex += start - cursor;
    newIndex += start - cursor;
    const lines: FileDiffLine[] = [];
    for (cursor = start; cursor < end && remaining > 0; cursor++, remaining--) {
      const kind = rows[cursor];
      const content = kind === "removed" ? original[oldIndex] : modified[newIndex];
      const line: FileDiffLine = {
        kind,
        text: content.replace(/\r?\n$/, ""),
      };
      if (kind !== "context" && !content.endsWith("\n")) line.noNewline = true;
      if (kind !== "added") line.before = ++oldIndex;
      if (kind !== "removed") line.after = ++newIndex;
      lines.push(line);
    }
    if (lines.length) hunks.push(lines);
    if (remaining === 0) break;
  }
  const truncated = remaining === 0 && cursor < (ranges.at(-1)?.end ?? 0);
  return { stats, diff: { hunks, truncated } };
}
