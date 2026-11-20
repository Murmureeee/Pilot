// @env node
// 文件类工具：read_file / write_file / edit_file。错误一律 throw（pi 转为 isError 给模型）。
import { mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import { int, bool, obj, opt, str } from "@earendil-works/pi-schema";
import { TOOL_LABELS } from "./constants";
import { truncate } from "./output";
import type { ResolveToolPath } from "./types";

const MAX_READ_BYTES = 2 * 1024 * 1024;

const readFileParams = obj({
  path: str({ description: "要读取的文件路径（绝对路径或相对于当前目录）" }),
  offset: opt(int({ description: "起始行号（从 1 开始，默认从头读取）" })),
  limit: opt(int({ description: "最多读取的行数（默认全部）" })),
});

export function createReadFileTool(resolvePath: ResolveToolPath): AgentTool<typeof readFileParams> {
  return {
    name: "read_file",
    label: TOOL_LABELS.read_file,
    description: "读取一个文本文件的内容（UTF-8）。大文件可用 offset/limit 按行分段。",
    parameters: readFileParams,
    execute: async (_id, params): Promise<AgentToolResult> => {
      const abs = resolvePath(params.path);
      const stat = statSync(abs);
      if (stat.isDirectory()) throw new Error(`路径是目录而非文件: ${abs}`);
      if (stat.size > MAX_READ_BYTES) {
        throw new Error(
          `文件过大（${stat.size} 字节 > ${MAX_READ_BYTES}），请用 offset/limit 分段读取`,
        );
      }
      const raw = readFileSync(abs, "utf-8");
      const lines = raw.split("\n");
      const start = Math.max(0, (params.offset ?? 1) - 1);
      const end = params.limit ? start + params.limit : lines.length;
      const selected = lines.slice(start, end).join("\n");
      return { content: [{ type: "text", text: truncate(selected, MAX_READ_BYTES) }], details: {} };
    },
  };
}

const writeFileParams = obj({
  path: str({ description: "目标文件路径" }),
  content: str({ description: "要写入的完整内容（覆盖原文件）" }),
});

export function createWriteFileTool(
  resolvePath: ResolveToolPath,
): AgentTool<typeof writeFileParams> {
  return {
    name: "write_file",
    label: TOOL_LABELS.write_file,
    description: "把完整内容写入文件（覆盖）。目录不存在会自动创建。",
    parameters: writeFileParams,
    execute: async (_id, params): Promise<AgentToolResult> => {
      const abs = resolvePath(params.path);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, params.content, "utf-8");
      return {
        content: [{ type: "text", text: `已写入 ${params.content.length} 字符到 ${abs}` }],
        details: {},
      };
    },
  };
}

const editFileParams = obj({
  path: str({ description: "目标文件路径" }),
  oldText: str({ description: "要被替换的原文本（需与文件内容精确匹配）" }),
  newText: str({ description: "替换后的新文本" }),
  replaceAll: opt(bool({ description: "替换全部匹配（默认仅替换第一处）" })),
});

export function createEditFileTool(resolvePath: ResolveToolPath): AgentTool<typeof editFileParams> {
  return {
    name: "edit_file",
    label: TOOL_LABELS.edit_file,
    description: "在文件中做精确文本替换。oldText 必须与文件内容完全匹配。",
    parameters: editFileParams,
    execute: async (_id, params): Promise<AgentToolResult> => {
      const abs = resolvePath(params.path);
      const raw = readFileSync(abs, "utf-8");
      const count = raw.split(params.oldText).length - 1;
      if (count === 0) throw new Error("oldText 未在文件中找到，请先 read_file 核对原文");
      if (count > 1 && !params.replaceAll) {
        throw new Error(`oldText 匹配了 ${count} 处，请扩大上下文使其唯一，或设 replaceAll=true`);
      }
      const next = params.replaceAll
        ? raw.replaceAll(params.oldText, params.newText)
        : raw.replace(params.oldText, params.newText);
      writeFileSync(abs, next, "utf-8");
      const replaced = params.replaceAll ? count : 1;
      return {
        content: [{ type: "text", text: `已在 ${abs} 中替换 ${replaced} 处` }],
        details: {},
      };
    },
  };
}
