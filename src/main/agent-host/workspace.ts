// @env node
import { opendir } from "node:fs/promises";
import type { WorkspaceEntry } from "../../shared/contract";
import { createToolPathResolver } from "./tools/paths";

const SKIP_DIRECTORIES = new Set([".git", "node_modules"]);
const SCAN_LIMIT = 5_000;
const RESULT_LIMIT = 40;

export async function searchWorkspace(
  workingDirectory: string | undefined,
  query: string,
): Promise<WorkspaceEntry[]> {
  if (!workingDirectory) return [];
  const resolvePath = createToolPathResolver(workingDirectory);
  const needle = query.trim().replaceAll("\\", "/").replace(/^\.\//, "").toLowerCase();
  const directories = [""];
  const visited = new Set<string>();
  const matches: { entry: WorkspaceEntry; rank: number }[] = [];
  let scanned = 0;

  for (const prefix of directories) {
    if (scanned >= SCAN_LIMIT) break;
    try {
      const path = resolvePath(prefix || ".");
      if (visited.has(path)) continue;
      visited.add(path);
      const directory = await opendir(path);
      for await (const item of directory) {
        scanned++;
        if (scanned > SCAN_LIMIT) break;
        const isDirectory = item.isDirectory();
        if (isDirectory ? SKIP_DIRECTORIES.has(item.name) : !item.isFile()) continue;

        const relativePath = prefix ? prefix + "/" + item.name : item.name;
        if (isDirectory && needle) directories.push(relativePath);
        const lowerPath = relativePath.toLowerCase();
        if (!lowerPath.includes(needle)) continue;
        const name = item.name.toLowerCase();
        const rank =
          name === needle ? 0 : name.startsWith(needle) ? 1 : lowerPath.startsWith(needle) ? 2 : 3;
        matches.push({
          entry: { path: relativePath, kind: isDirectory ? "directory" : "file" },
          rank,
        });
      }
    } catch (error) {
      if (prefix === "") throw new Error("无法搜索工作目录。", { cause: error });
    }
  }

  return matches
    .sort((a, b) => a.rank - b.rank || a.entry.path.localeCompare(b.entry.path))
    .slice(0, RESULT_LIMIT)
    .map(({ entry }) => entry);
}
