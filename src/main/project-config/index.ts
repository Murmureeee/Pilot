// @env node
import { createHash, createHmac, randomBytes } from "node:crypto";
import { readFileSync, statSync, type Stats } from "node:fs";
import { isAbsolute } from "node:path";

import { z } from "zod";

import type {
  AfterTurnVerification,
  CommandShell,
  ToolRule,
  VerificationKind,
} from "@shared/contract";
import type {
  ProjectConfigInfo,
  ProjectConfigIssue,
  ProjectConfigSummary,
  ProjectTrustState,
} from "@shared/project-config";

import { VERIFICATION_KINDS } from "../../shared/contract";
import { PROJECT_CONFIG_FILE } from "../../shared/project-config";
import { isWebTool, WEB_DOMAIN_PATTERN } from "../../shared/web";
import { wslProjectPath } from "../../shared/wsl-project";
import { normalizeImportedMcp } from "../external-import/mcp";
import { object } from "../external-import/sources";
import { verificationCommandSchema } from "../settings/schema";
import type { McpServerConfig, Settings } from "../settings/types";
import { createToolPathResolver } from "../workspace/paths";
import { getCommandShell } from "../workspace/shell";
import {
  PROJECT_CONFIG_SIZE_LIMIT,
  PROJECT_FILE_RULE_TOOLS,
  PROJECT_MCP_FILE,
  PROJECT_RULE_LIMIT,
  PROJECT_SERVER_LIMIT,
  PROJECT_SERVER_NAME_LIMIT,
} from "./constants";
import type { ProjectConfig, ProjectMcpServer, ProjectRuleEntry } from "./types";

const ruleSchema = z.strictObject({
  tool: z.string().min(1),
  command: z.array(z.string().min(1)).min(1).optional(),
  path: z.string().min(1).optional(),
  domain: z.string().regex(WEB_DOMAIN_PATTERN).optional(),
});
const permissionsSchema = z.strictObject({ allow: z.array(z.unknown()).max(PROJECT_RULE_LIMIT) });
const verificationSchema = z.strictObject({
  test: verificationCommandSchema.optional(),
  typecheck: verificationCommandSchema.optional(),
  build: verificationCommandSchema.optional(),
  afterTurn: z.enum(VERIFICATION_KINDS).optional(),
});
const KNOWN_KEYS = new Set(["$schema", "mcpServers", "permissions", "verification"]);
const revisionKey = randomBytes(32);

function relativeRulePath(path: string): string | undefined {
  const normalized = path.replaceAll("\\", "/").replace(/^\.\//, "");
  if (isAbsolute(path) || /[:\0]/.test(normalized) || normalized.startsWith("/")) return;
  if (normalized.split("/").some((part) => part === "..")) return;
  return normalized || undefined;
}

function ruleEntry(value: unknown): ProjectRuleEntry | undefined {
  const parsed = ruleSchema.safeParse(value);
  if (!parsed.success) return undefined;
  const { tool, command, path, domain } = parsed.data;
  if (tool === "bash") return command && !path && !domain ? { tool, command } : undefined;
  if ((PROJECT_FILE_RULE_TOOLS as readonly string[]).includes(tool)) {
    const relative = path && !command && !domain ? relativeRulePath(path) : undefined;
    return relative ? { tool: tool as "write_file" | "edit_file", path: relative } : undefined;
  }
  if (isWebTool(tool)) return domain && !command && !path ? { tool, domain } : undefined;
  return undefined;
}

function locate(
  resolve: (path: string) => string,
  file: string,
): { path: string; stat?: Stats } | undefined {
  try {
    const path = resolve(file);
    return { path, stat: statSync(path, { throwIfNoEntry: false }) };
  } catch {
    return undefined;
  }
}

export function loadProjectConfig(directory: string): ProjectConfig {
  const resolve = createToolPathResolver(directory);
  const issues: ProjectConfigIssue[] = [];
  const files: string[] = [];
  const read = (file: string): Record<string, unknown> | undefined => {
    const found = locate(resolve, file);
    if (!found) {
      issues.push({ file, reason: "unreadable" });
      return undefined;
    }
    const { path, stat } = found;
    if (!stat) return undefined;
    if (!stat.isFile()) {
      issues.push({ file, reason: "unreadable" });
      return undefined;
    }
    if (stat.size > PROJECT_CONFIG_SIZE_LIMIT) {
      issues.push({ file, reason: "too-large" });
      return undefined;
    }
    try {
      const value: unknown = JSON.parse(readFileSync(path, "utf8").replace(/^\uFEFF/, ""));
      if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("object");
      files.push(file);
      return value as Record<string, unknown>;
    } catch {
      issues.push({ file, reason: "invalid-json" });
      return undefined;
    }
  };

  const servers = new Map<string, ProjectMcpServer>();
  const addServers = (file: string, value: unknown, declaresPolicy: boolean): void => {
    if (value === undefined) return;
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      issues.push({ file, reason: "invalid-field" });
      return;
    }
    for (const [name, entry] of Object.entries(object(value))) {
      if (!name.trim() || name.length > PROJECT_SERVER_NAME_LIMIT) {
        issues.push({ file, reason: "unsupported-server", name: name.slice(0, 40) });
        continue;
      }
      const connection = normalizeImportedMcp(entry, {
        source: "claude-code",
        workspace: directory,
      });
      if (typeof connection === "string") {
        issues.push({ file, reason: "unsupported-server", name });
        continue;
      }
      // 后读取的 .pilot/config.json 覆盖 .mcp.json 中的同名服务。
      servers.delete(name);
      if (servers.size >= PROJECT_SERVER_LIMIT) {
        issues.push({ file, reason: "unsupported-server", name });
        continue;
      }
      servers.set(name, {
        name,
        file,
        transport: connection.transport,
        cwd: connection.transport.type === "stdio" ? connection.cwd : undefined,
        envNames: [
          ...(connection.env ?? []).map(([key]) => key),
          ...(connection.envNames ?? []),
          ...(connection.headers ?? []).map(([key]) => key),
          ...(connection.headerVariables ?? []).map(([, key]) => key),
          ...(connection.bearerVariable ? [connection.bearerVariable] : []),
        ],
        policy: declaresPolicy && object(entry).policy === "inherit" ? "inherit" : "confirm",
        connection,
      });
    }
  };

  const claude = read(PROJECT_MCP_FILE);
  if (claude) addServers(PROJECT_MCP_FILE, claude.mcpServers ?? {}, false);

  const rules: ProjectRuleEntry[] = [];
  let verification: Partial<Record<VerificationKind, string>> = {};
  let afterTurn: VerificationKind | undefined;
  const pilot = read(PROJECT_CONFIG_FILE);
  if (pilot) {
    if (Object.keys(pilot).some((key) => !KNOWN_KEYS.has(key)))
      issues.push({ file: PROJECT_CONFIG_FILE, reason: "invalid-field" });
    addServers(PROJECT_CONFIG_FILE, pilot.mcpServers, true);
    if (pilot.permissions !== undefined) {
      const permissions = permissionsSchema.safeParse(pilot.permissions);
      if (!permissions.success) issues.push({ file: PROJECT_CONFIG_FILE, reason: "invalid-field" });
      for (const value of permissions.data?.allow ?? []) {
        const rule = ruleEntry(value);
        if (rule) rules.push(rule);
        else issues.push({ file: PROJECT_CONFIG_FILE, reason: "unsupported-rule" });
      }
    }
    if (pilot.verification !== undefined) {
      const parsed = verificationSchema.safeParse(pilot.verification);
      if (parsed.success) {
        const { afterTurn: kind, ...commands } = parsed.data;
        verification = commands;
        if (kind && commands[kind]) afterTurn = kind;
        else if (kind) issues.push({ file: PROJECT_CONFIG_FILE, reason: "invalid-field" });
      } else {
        issues.push({ file: PROJECT_CONFIG_FILE, reason: "invalid-field" });
      }
    }
  }

  const serverList = [...servers.values()].sort((a, b) => a.name.localeCompare(b.name));
  const fingerprint = createHash("sha256")
    .update(
      JSON.stringify({
        directory,
        servers: serverList.map(({ name, file, policy, connection }) => ({
          name,
          file,
          policy,
          connection,
        })),
        rules,
        verification,
        afterTurn,
      }),
    )
    .digest("hex");
  return {
    directory,
    files,
    servers: serverList,
    rules,
    verification,
    afterTurn,
    issues,
    fingerprint,
  };
}

function needsTrust(config: ProjectConfig): boolean {
  return Boolean(
    config.servers.length || config.rules.length || Object.keys(config.verification).length,
  );
}

export function projectTrustState(settings: Settings, config: ProjectConfig): ProjectTrustState {
  if (!needsTrust(config)) return "not-needed";
  const saved = settings.projectTrust?.[config.directory];
  if (!saved) return "untrusted";
  return saved.fingerprint === config.fingerprint ? "trusted" : "changed";
}

export function trustProject(settings: Settings, config: ProjectConfig): Settings {
  return {
    ...settings,
    projectTrust: {
      ...settings.projectTrust,
      [config.directory]: { fingerprint: config.fingerprint, trustedAt: Date.now() },
    },
  };
}

export function revokeProjectTrust(settings: Settings, directory: string): Settings {
  const projectTrust = { ...settings.projectTrust };
  delete projectTrust[directory];
  return { ...settings, projectTrust };
}

export function projectToolRules(config: ProjectConfig, shell: CommandShell): ToolRule[] {
  const wslDistribution = wslProjectPath(config.directory)?.distribution;
  return config.rules.flatMap((rule): ToolRule[] => {
    if ("command" in rule)
      return [
        {
          toolName: rule.tool,
          commandPrefix: { shell, args: rule.command, ...(wslDistribution && { wslDistribution }) },
        },
      ];
    if ("path" in rule) return [{ toolName: rule.tool, pathPrefix: rule.path }];
    return [{ toolName: rule.tool, domain: rule.domain }];
  });
}

function afterTurnOf(
  config: ProjectConfig,
  shell: CommandShell,
): AfterTurnVerification | undefined {
  const command = config.afterTurn && config.verification[config.afterTurn];
  return config.afterTurn && command ? { kind: config.afterTurn, command, shell } : undefined;
}

export function summarizeProjectConfig(
  config: ProjectConfig,
  shell: CommandShell,
): ProjectConfigSummary {
  return {
    directory: config.directory,
    files: config.files,
    mcpServers: config.servers.map(({ connection: _connection, ...server }) => server),
    toolRules: projectToolRules(config, shell),
    verification: config.verification,
    afterTurn: afterTurnOf(config, shell),
    issues: config.issues,
  };
}

export function projectConfigInfo(
  settings: Settings,
  directory: string,
  config = loadProjectConfig(directory),
): ProjectConfigInfo {
  return {
    ...summarizeProjectConfig(config, getCommandShell(settings.commandShell, directory)),
    trust: projectTrustState(settings, config),
    hasSavedTrust: Boolean(settings.projectTrust?.[directory]),
    revision: revisionOf(config),
  };
}

function revisionOf(config: ProjectConfig): string {
  return createHmac("sha256", revisionKey).update(config.fingerprint).digest("hex");
}

export function trustProjectRevision(
  settings: Settings,
  directory: string,
  revision: string,
): Settings {
  const config = loadProjectConfig(directory);
  if (revisionOf(config) !== revision) throw new Error("项目配置已更改。请刷新并重新核对。");
  return needsTrust(config) ? trustProject(settings, config) : settings;
}

export function projectMcpServers(config: ProjectConfig): McpServerConfig[] {
  return config.servers.map(({ name, file, policy, transport, connection }) => ({
    id:
      "project:" +
      createHash("sha256")
        .update(config.directory + "\0" + name)
        .digest("hex")
        .slice(0, 16),
    name,
    enabled: true,
    policy,
    transport,
    project: { directory: config.directory, file, connection },
  }));
}

/** 用户为项目保存的回合后验证优先；项目声明的命令需要先信任项目。 */
export function afterTurnVerificationFor(
  settings: Settings,
  directory: string,
  projectFingerprint?: string,
): AfterTurnVerification | undefined {
  const saved = settings.afterTurnVerification?.[directory];
  if (saved !== undefined) return saved ?? undefined;
  if (!projectFingerprint) return undefined;
  try {
    const config = loadProjectConfig(directory);
    return config.fingerprint === projectFingerprint &&
      projectTrustState(settings, config) === "trusted"
      ? afterTurnOf(config, getCommandShell(settings.commandShell, directory))
      : undefined;
  } catch {
    return undefined;
  }
}
