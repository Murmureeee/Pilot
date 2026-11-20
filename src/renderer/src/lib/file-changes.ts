// @env browser
import type { FileChangeSummary, UiMessage } from "@shared/contract";
import type { FileChangeNode } from "./types";

function fileLocation(path: string): {
  name: string;
  folders: { name: string; path: string }[];
} {
  const normalized = /^[a-z]:[\\/]|^\\\\/i.test(path) ? path.replaceAll("\\", "/") : path;
  const segments = normalized.split("/").filter(Boolean);
  const name = segments.pop() ?? path;
  if (normalized.startsWith("/")) segments.unshift(normalized.startsWith("//") ? "//" : "/");
  let folderPath = "";
  const folders = segments.map((segment) => {
    folderPath += (folderPath && !folderPath.endsWith("/") ? "/" : "") + segment;
    return { name: segment, path: folderPath };
  });
  return { name, folders };
}

export function fileChangeFolderPaths(path: string): string[] {
  return fileLocation(path).folders.map((folder) => folder.path);
}

export function fileChangesTree(changes: readonly FileChangeSummary[]): FileChangeNode[] {
  const root: FileChangeNode[] = [];
  const folders = new Map<string, Extract<FileChangeNode, { kind: "directory" }>>();
  for (const change of changes) {
    const location = fileLocation(change.path);
    let siblings = root;
    for (const folder of location.folders) {
      let entry = folders.get(folder.path);
      if (!entry) {
        entry = { kind: "directory", ...folder, children: [] };
        folders.set(folder.path, entry);
        siblings.push(entry);
      }
      siblings = entry.children;
    }
    siblings.push({ kind: "file", name: location.name, change });
  }
  return root;
}

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
