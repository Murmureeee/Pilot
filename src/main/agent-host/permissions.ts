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

import { createToolPathResolver, isWithinDirectory } from "../workspace/paths";
import { getCommandShell } from "../workspace/shell";
import { findCommandDanger } from "./command-danger";
import { commandPrefixMatches, parseCommandScope } from "./command-scope";
import type { McpToolPolicy } from "./mcp/types";
import { isReadOnly, labelOf, pathOfArgs } from "./tools";
import type { ToolEnvironment } from "./tools/types";
import type { PendingPermission, PermissionDetails, ToolAccess } from "./types";

type Broadcast = (request: PermissionRequest) => void;

function isProtectedFile(toolName: string, args: unknown): boolean {
  return (
    (toolName === "write_file" || toolName === "edit_file") &&
    /^(c:\\windows|c:\\program files)/i.test(pathOfArgs(args) ?? "")
  );
}

function summarizeArgs(args: unknown, pretty: boolean): string {
  try {
    return JSON.stringify(args, null, pretty ? 2 : undefined) ?? "{}";
  } catch {
    return String(args);
  }
}

function ruleFor(toolName: string, args: unknown): ToolRule {
  const path = pathOfArgs(args);
  return path ? { toolName, pathPrefix: path } : { toolName };
}

function ruleMatches(rule: ToolRule, args: unknown): boolean {
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

  needsConfirmation(
    toolName: string,
    args: unknown,
    policy?: McpToolPolicy,
    environment?: ToolEnvironment,
  ): boolean {
    return this.accessFor(toolName, args, policy, environment).kind === "ask";
  }

  private accessFor(
    toolName: string,
    args: unknown,
    policy?: McpToolPolicy,
    environment: ToolEnvironment = { commandShell: getCommandShell() },
  ): ToolAccess {
    if (isReadOnly(toolName)) return { kind: "allow" };

    // 权限模式三档（composer 徽章切换）
    const mode = this.getApprovalMode();
    if (mode === "read-only") return { kind: "block" };

    const command =
      toolName === "bash" &&
      args &&
      typeof args === "object" &&
      "command" in args &&
      typeof args.command === "string"
        ? args.command
        : undefined;
    const commandDanger =
      command === undefined ? undefined : findCommandDanger(command, environment);
    if (!commandDanger && mode === "full-access" && !policy?.requireConfirmation)
      return { kind: "allow" };

    let rule: ToolRule | undefined;
    if (!commandDanger) {
      const rules = [...this.getGlobalRules(), ...this.sessionRules].filter(
        (candidate) => candidate.toolName === toolName,
      );
      if (toolName === "bash") {
        const { commandShell: shell } = environment;
        const commands = command === undefined ? undefined : parseCommandScope(command, shell);
        if (
          commands?.every((words) =>
            rules.some(
              ({ commandPrefix }) =>
                commandPrefix && commandPrefixMatches(commandPrefix, shell, words),
            ),
          )
        )
          return { kind: "allow" };

        // A single approval creates one prefix. Combined commands can use existing rules for every part.
        if (commands?.length === 1 && commands[0].every((word) => word !== null)) {
          rule = { toolName, commandPrefix: { shell, args: commands[0] } };
        }
      } else {
        if (rules.some((candidate) => ruleMatches(candidate, args))) return { kind: "allow" };
        rule = ruleFor(toolName, args);
      }
    }

    return { kind: "ask", command, commandDanger, rule };
  }

  async gate(
    call: { id: string; name: string },
    args: unknown,
    policy?: McpToolPolicy,
    environment: ToolEnvironment = { commandShell: getCommandShell() },
    describe?: () => PermissionDetails,
  ): Promise<BeforeToolCallResult | undefined> {
    const { name: toolName, id: callId } = call;
    const access = this.accessFor(toolName, args, policy, environment);
    if (access.kind === "allow") return undefined;
    if (access.kind === "block") {
      return {
        block: true,
        reason: "当前为只读模式，已拒绝该写操作（可在输入框左下角切换权限模式）",
      };
    }
    const { command, commandDanger, rule } = access;
    const details = describe?.();
    const decision = await this.ask({
      type: "permission_request",
      requestId: randomUUID(),
      callId,
      toolName,
      label: policy?.label ?? labelOf(toolName),
      inputSummary: details?.file?.diff ? "" : summarizeArgs(args, Boolean(policy)),
      danger: Boolean(commandDanger) || isProtectedFile(toolName, args),
      commandDanger,
      workingDirectory: createToolPathResolver(environment.workingDirectory)("."),
      command,
      commandShell: command === undefined ? undefined : environment.commandShell,
      mcp: policy && { server: policy.serverName, tool: policy.toolName },
      rule,
      ...details,
    });
    if (decision === "deny") return { block: true, reason: "用户拒绝了本次工具调用" };
    return undefined;
  }

  private ask(request: PermissionRequest): Promise<PermissionDecision> {
    return new Promise<PermissionDecision>((resolve) => {
      this.pending.set(request.requestId, { request, resolve });
      this.broadcast(request);
    });
  }

  respond(requestId: string, decision: PermissionDecision): PermissionRequest | undefined {
    const pending = this.pending.get(requestId);
    if (!pending) return undefined;
    if (decision === "session" || decision === "global") {
      const { rule } = pending.request;
      if (!rule) throw new Error("此操作需要逐次审批。");
      if (decision === "global") this.addGlobalRule(rule);
      else this.sessionRules.push(rule);
    }
    this.pending.delete(requestId);
    pending.resolve(decision);
    return pending.request;
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
