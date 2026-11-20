// @env browser
import type { FileChangeSummary, UiMessage } from "@shared/contract";

export function changesForReply(
  messages: readonly UiMessage[],
  replyId: string,
): FileChangeSummary[] {
  const changes: FileChangeSummary[] = [];
  const start = messages.findIndex(
    (message) => message.id === replyId && message.role === "assistant",
  );
  if (start < 0) return changes;
  for (let index = start; index < messages.length; index++) {
    const message = messages[index];
    if (message.role === "user") break;
    for (const part of message.parts) {
      if (part.type === "tool" && part.fileChange) changes.push(part.fileChange);
    }
  }
  return changes;
}

export function summarizeChanges(changes: readonly FileChangeSummary[]): {
  count: number;
  stats: FileChangeSummary["stats"];
} {
  const paths = new Set<string>();
  let stats: FileChangeSummary["stats"];
  for (const change of changes) {
    paths.add(change.path);
    if (change.stats) {
      stats ??= { added: 0, removed: 0 };
      stats.added += change.stats.added;
      stats.removed += change.stats.removed;
    }
  }
  return { count: paths.size, stats };
}
