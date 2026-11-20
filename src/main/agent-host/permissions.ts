// @env node
// 权限门：读类默认放行；写类/命令按规则放行，未命中规则则广播确认请求并阻塞等待应答。
import { randomUUID } from "node:crypto";
import { isAbsolute } from "node:path";
import type { BeforeToolCallResult } from "@earendil-works/pi-agent-core";
import type {
  ApprovalMode,
  PermissionDecision,
  PermissionRequest,
  ToolRule,
} from "@shared/contract";
import type { McpToolPolicy } from "./mcp/types";
import { isReadOnly, labelOf, pathOfArgs } from "./tools";
import { isWithinDirectory } from "../workspace/paths";
import type { PendingPermission } from "./types";

type Broadcast = (request: PermissionRequest) => void;

/** bash 危险命令特征（FR-7.5）：硬编码列表 + 弹窗红标，命中也不自动拒绝，只提升警示 */
const DANGER_PATTERNS: RegExp[] = [
  /\brm\s+(-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r)\b/i,
  /remove-item\s+.*-recurse.*-force/i,
  /\bdel\s+\/[sq]\b/i,
  /format\s+[a-z]:/i,
  /\bmkfs\b/i,
  /\bshutdown\b|\brestart-computer\b/i,
  /reg(\.exe)?\s+(delete|add)\s/i,
  /\bdisable\b.*\bdefender\b/i,
  /remove-itemproperty|set-itemproperty.*hkey_/i,
];

function isDangerous(toolName: string, args: unknown): boolean {
  if (toolName === "bash") {
    const command =
      args && typeof args === "object" && "command" in args
        ? String((args as { command: unknown }).command)
        : "";
    return DANGER_PATTERNS.some((p) => p.test(command));
  }
  if (toolName === "write_file" || toolName === "edit_file") {
    const path = pathOfArgs(args) ?? "";
    return /^(c:\\windows|c:\\program files)/i.test(path);
  }
  return false;
}

function summarizeArgs(args: unknown): string {
  try {
    return JSON.stringify(args) ?? "{}";
  } catch {
    return String(args);
  }
}

function ruleFor(toolName: string, args: unknown): ToolRule {
  const path = pathOfArgs(args);
  return path ? { toolName, pathPrefix: path } : { toolName };
}

function ruleMatches(rule: ToolRule, toolName: string, args: unknown): boolean {
  if (rule.toolName !== toolName) return false;
  if (!rule.pathPrefix) return true;
  const path = pathOfArgs(args);
  if (path === undefined || isAbsolute(path) !== isAbsolute(rule.pathPrefix)) return false;
  return isAbsolute(path)
    ? isWithinDirectory(rule.pathPrefix, path)
    : path.startsWith(rule.pathPrefix);
}

export class PermissionManager {
  private readonly pending = new Map<string, PendingPermission>();

  constructor(
    private readonly broadcast: Broadcast,
    private readonly getGlobalRules: () => ToolRule[],
    private readonly addGlobalRule: (rule: ToolRule) => void,
    private readonly getApprovalMode: () => ApprovalMode = () => "standard",
    private readonly sessionRules: ToolRule[] = [],
  ) {}

  async gate(
    toolName: string,
    args: unknown,
    policy?: McpToolPolicy,
  ): Promise<BeforeToolCallResult | undefined> {
    if (isReadOnly(toolName)) return undefined;

    // 权限模式三档（composer 徽章切换）
    const mode = this.getApprovalMode();
    if (mode === "full-access" && !policy?.requireConfirmation) return undefined;
    if (mode === "read-only") {
      return {
        block: true,
        reason: "当前为只读模式，已拒绝该写操作（可在输入框左下角切换权限模式）",
      };
    }

    const rules = [...this.getGlobalRules(), ...this.sessionRules];
    if (rules.some((rule) => ruleMatches(rule, toolName, args))) return undefined;

    const decision = await this.ask(toolName, args, policy?.label ?? labelOf(toolName));
    switch (decision) {
      case "deny":
        return { block: true, reason: "用户拒绝了本次工具调用" };
      case "session":
        this.sessionRules.push(ruleFor(toolName, args));
        return undefined;
      case "global":
        this.addGlobalRule(ruleFor(toolName, args));
        return undefined;
      default:
        return undefined; // once
    }
  }

  private ask(toolName: string, args: unknown, label: string): Promise<PermissionDecision> {
    const requestId = randomUUID();
    const request: PermissionRequest = {
      type: "permission_request",
      requestId,
      toolName,
      label,
      inputSummary: summarizeArgs(args),
      danger: isDangerous(toolName, args),
    };
    return new Promise<PermissionDecision>((resolve) => {
      this.pending.set(requestId, { request, resolve });
      this.broadcast(request);
    });
  }

  respond(requestId: string, decision: PermissionDecision): boolean {
    const pending = this.pending.get(requestId);
    if (!pending) return false;
    this.pending.delete(requestId);
    pending.resolve(decision);
    return true;
  }

  /** abort 时全部按拒绝处理，避免工具预检卡死 */
  abortAll(): void {
    for (const { resolve } of this.pending.values()) resolve("deny");
    this.pending.clear();
  }

  hasPending(): boolean {
    return this.pending.size > 0;
  }

  listPending(): PermissionRequest[] {
    return [...this.pending.values()].map(({ request }) => request);
  }
}
