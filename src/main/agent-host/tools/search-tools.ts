// @env node
// 搜索类工具：glob（文件名匹配）与 grep（内容正则搜索）。只读，权限门默认放行。
import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join, relative } from "node:path";
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import { int, obj, opt, str } from "@earendil-works/pi-schema";
import { TOOL_LABELS } from "./constants";
import { looksBinary, truncate } from "./output";
import type { ResolveToolPath } from "./types";

const MAX_FILE_BYTES = 512 * 1024;
const TEXT_EXTS = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".md",
  ".txt",
  ".css",
  ".html",
  ".py",
  ".go",
  ".rs",
  ".java",
  ".c",
  ".h",
  ".cpp",
  ".yml",
  ".yaml",
  ".toml",
  ".vue",
  ".sql",
  ".sh",
]);

function walk(root: string, skipLinks: boolean, out: string[] = []): string[] {
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (out.length > 5_000) return out;
    if (skipLinks && entry.isSymbolicLink()) continue;
    const full = join(root, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === ".git") continue;
      walk(full, skipLinks, out);
    } else {
      out.push(full);
    }
  }
  return out;
}

const globParams = obj({
  pattern: str({ description: "文件名通配符，如 *.md 或 report*.docx（匹配文件名，不含目录）" }),
  path: opt(str({ description: "搜索起始目录，默认当前目录" })),
});

export function createGlobTool(
  resolvePath: ResolveToolPath,
  scoped = false,
): AgentTool<typeof globParams> {
  return {
    name: "glob",
    label: TOOL_LABELS.glob,
    description: "按文件名通配符递归查找文件（跳过 node_modules/.git）。",
    parameters: globParams,
    execute: async (_id, params): Promise<AgentToolResult> => {
      const root = resolvePath(params.path ?? ".");
      const regex = new RegExp(
        `^${params.pattern
          .replace(/[.+^${}()|[\]\\]/g, "\\$&")
          .replace(/\*/g, ".*")
          .replace(/\?/g, ".")}$`,
        "i",
      );
      const hits = walk(root, scoped)
        .filter((f) => regex.test(f.split(/[\\/]/).pop() ?? ""))
        .slice(0, 200)
        .map((f) => relative(root, f));
      if (hits.length === 0) throw new Error(`未找到匹配 ${params.pattern} 的文件（于 ${root}）`);
      return {
        content: [{ type: "text", text: hits.join("\n") }],
        details: { count: hits.length },
      };
    },
  };
}

const grepParams = obj({
  pattern: str({ description: "正则表达式（对文件内容逐行匹配）" }),
  path: opt(str({ description: "搜索起始目录或单个文件，默认当前目录" })),
  maxResults: opt(int({ description: "最多返回条数，默认 50" })),
});

export function createGrepTool(
  resolvePath: ResolveToolPath,
  scoped = false,
): AgentTool<typeof grepParams> {
  return {
    name: "grep",
    label: TOOL_LABELS.grep,
    description: "在目录内的文本文件中按正则逐行搜索，返回 file:line: 内容 形式的结果。",
    parameters: grepParams,
    execute: async (_id, params): Promise<AgentToolResult> => {
      const root = resolvePath(params.path ?? ".");
      const max = params.maxResults ?? 50;
      const regex = new RegExp(params.pattern, "i");
      const files = statSync(root).isFile() ? [root] : walk(root, scoped);
      const results: string[] = [];
      for (const file of files) {
        if (results.length >= max) break;
        if (!TEXT_EXTS.has(extname(file).toLowerCase())) continue;
        const stat = statSync(file);
        if (stat.size > MAX_FILE_BYTES || stat.size === 0) continue;
        let text: string;
        try {
          const buf = readFileSync(file);
          if (looksBinary(buf)) continue;
          text = buf.toString("utf-8");
        } catch {
          continue;
        }
        const lines = text.split("\n");
        for (let i = 0; i < lines.length && results.length < max; i++) {
          if (regex.test(lines[i])) {
            results.push(`${relative(root, file)}:${i + 1}: ${lines[i].trim().slice(0, 200)}`);
          }
        }
      }
      if (results.length === 0)
        throw new Error(`未找到匹配 /${params.pattern}/ 的内容（于 ${root}）`);
      return {
        content: [{ type: "text", text: truncate(results.join("\n"), 16_000) }],
        details: { count: results.length },
      };
    },
  };
}
