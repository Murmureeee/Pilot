// @env node
// 工具注册表：权限门按此判定只读/写类，UI 按 label 展示。
import type { AgentTool } from "@earendil-works/pi-agent-core";

import { createToolPathResolver } from "../../workspace/paths";
import { createBashTool } from "./bash";
import { PLAN_TOOL_NAME, READ_SKILL_TOOL_NAME, TOOL_LABELS } from "./constants";
import { createEditFileTool, createReadFileTool, createWriteFileTool } from "./file-tools";
import { planTool } from "./plan";
import { createGlobTool, createGrepTool } from "./search-tools";
import type { ResolveToolPath, ToolEnvironment } from "./types";

export function createTools(environment: ToolEnvironment): AgentTool[] {
  const resolvePath = createToolPathResolver(environment.workingDirectory);
  const scoped = environment.workingDirectory !== undefined;
  const write = createWriteFileTool(resolvePath, environment.workingDirectory);
  const edit = createEditFileTool(resolvePath, environment.workingDirectory);
  if (scoped) {
    // 审批与执行使用同一个绝对路径，旧目录的相对路径授权不会授权新目录。
    write.prepareArguments = (args) => prepareWritePath(args, resolvePath);
    edit.prepareArguments = (args) => prepareWritePath(args, resolvePath);
  }
  return [
    createReadFileTool(resolvePath),
    write,
    edit,
    createBashTool(environment),
    createGlobTool(resolvePath, scoped),
    createGrepTool(resolvePath, scoped),
    planTool,
  ];
}

/** 只读工具：权限门默认放行 */
const READ_ONLY_TOOLS = new Set([
  "read_file",
  "glob",
  "grep",
  PLAN_TOOL_NAME,
  READ_SKILL_TOOL_NAME,
]);

export function labelOf(toolName: string): string {
  return Object.hasOwn(TOOL_LABELS, toolName) ? TOOL_LABELS[toolName] : toolName;
}

export function isReadOnly(toolName: string): boolean {
  return READ_ONLY_TOOLS.has(toolName);
}

/** 从工具参数提取用于权限规则匹配的路径字段 */
export function pathOfArgs(args: unknown): string | undefined {
  if (args && typeof args === "object" && "path" in args) {
    const p = (args as { path?: unknown }).path;
    if (typeof p === "string") return p;
  }
  return undefined;
}

function prepareWritePath<T extends { path: string }>(
  args: unknown,
  resolvePath: ResolveToolPath,
): T {
  const path = pathOfArgs(args);
  const input = args as T;
  // 参数的其余字段由 pi-schema 校验。
  return path === undefined ? input : { ...input, path: resolvePath(path) };
}
