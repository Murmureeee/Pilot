// @env browser
import type { JSX } from "react";
import type { FileChangeSummary } from "@shared/contract";

export function DiffStats({
  stats,
}: {
  stats: NonNullable<FileChangeSummary["stats"]>;
}): JSX.Element {
  return (
    <span className="flex shrink-0 items-center gap-1.5 font-mono text-xs tabular-nums">
      <span className="text-emerald-700 dark:text-emerald-400">+{stats.added}</span>
      <span className="text-destructive">−{stats.removed}</span>
    </span>
  );
}
