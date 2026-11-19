// @env node
import { isAbsolute, resolve } from "node:path";
import type { ImportIssue } from "@shared/imports";
import { object } from "./sources";
import type { ImportedMcpConnection, ImportMcpContext, ResolvedImportedMcp } from "./types";

const ENV_NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
const PROTECTED_HTTP_ENV =
  /^(?:ANTHROPIC_(?!BASE_URL$)|CLAUDE_(?:CODE_)?(?:OAUTH|API|AUTH)|AWS_(?:ACCESS_KEY|SECRET|SESSION_TOKEN|BEARER_TOKEN)|GOOGLE_APPLICATION_CREDENTIALS$|(?:HTTP|HTTPS|ALL)_PROXY$|NPM_TOKEN$|NODE_AUTH_TOKEN$)/i;

function strings(value: unknown): string[] | undefined {
  return Array.isArray(value) && value.every((item) => typeof item === "string")
    ? value
    : undefined;
}

function entries(value: unknown): [string, string][] | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const pairs = Object.entries(object(value));
  return pairs.every((item): item is [string, string] => typeof item[1] === "string")
    ? pairs
    : undefined;
}

function isHttpEndpoint(value: string): boolean {
  const url = URL.parse(value);
  return Boolean(
    url &&
    (url.protocol === "http:" || url.protocol === "https:") &&
    !url.username &&
    !url.password,
  );
}

export function normalizeImportedMcp(
  value: unknown,
  context: ImportMcpContext,
): ImportedMcpConnection | Extract<ImportIssue["reason"], "transport" | "connection"> {
  const entry = object(value);
  const { source, plugin, workspace } = context;
  const type = entry.type ?? (typeof entry.command === "string" ? "stdio" : "http");
  const includeTools = strings(entry.enabled_tools);
  const excludeTools = strings(entry.disabled_tools);
  if (
    (entry.enabled_tools !== undefined && !includeTools) ||
    (entry.disabled_tools !== undefined && !excludeTools)
  )
    return "connection";

  if (type === "http" || type === "streamable-http") {
    const url = entry.url;
    const headers = entries(entry.headers ?? entry.http_headers);
    const headerVariables = entries(entry.env_http_headers);
    const bearerVariable =
      typeof entry.bearer_token_env_var === "string" ? entry.bearer_token_env_var : undefined;
    if (
      typeof url !== "string" ||
      (!isHttpEndpoint(url) && !(source === "claude-code" && url.includes("${"))) ||
      ((entry.headers ?? entry.http_headers) !== undefined && !headers) ||
      (entry.env_http_headers !== undefined &&
        (!headerVariables || headerVariables.some(([, name]) => !ENV_NAME.test(name)))) ||
      (entry.bearer_token_env_var !== undefined &&
        (!bearerVariable || !ENV_NAME.test(bearerVariable)))
    )
      return "connection";
    return {
      source,
      transport: { type: "http", url },
      headers,
      headerVariables,
      bearerVariable,
      includeTools,
      excludeTools,
    };
  }
  if (type !== "stdio") return "transport";

  const command = entry.command;
  const args = strings(entry.args);
  const env = entries(entry.env);
  const envNames: string[] = [];
  if (entry.env_vars !== undefined) {
    if (!Array.isArray(entry.env_vars)) return "connection";
    for (const item of entry.env_vars) {
      const { name, source: origin } = object(item);
      const variable = typeof item === "string" ? item : name;
      if (typeof variable !== "string" || !ENV_NAME.test(variable)) return "connection";
      if (origin && origin !== "local") return "transport";
      envNames.push(variable);
    }
  }
  if (
    typeof command !== "string" ||
    !command.trim() ||
    (entry.args !== undefined && !args) ||
    (entry.env !== undefined && (!env || env.some(([name]) => !ENV_NAME.test(name)))) ||
    (entry.cwd !== undefined && typeof entry.cwd !== "string")
  )
    return "connection";
  const variables: Record<string, string> = {};
  if (workspace) variables.CLAUDE_PROJECT_DIR = workspace;
  if (plugin) {
    variables.CLAUDE_PLUGIN_ROOT = plugin.installed;
    variables.CODEX_PLUGIN_ROOT = plugin.installed;
    variables.PLUGIN_ROOT = plugin.installed;
    if (plugin.data) variables.CLAUDE_PLUGIN_DATA = plugin.data;
  }
  const rebase = (text: string): string =>
    plugin
      ? text
          .replaceAll(plugin.original + "/", plugin.installed + "/")
          .replaceAll(plugin.original + "\\", plugin.installed + "\\")
          .replaceAll(
            plugin.original.replaceAll("\\", "/") + "/",
            plugin.installed.replaceAll("\\", "/") + "/",
          )
      : text;
  const base = plugin?.installed ?? workspace;
  const cwd = typeof entry.cwd === "string" ? rebase(entry.cwd) : undefined;
  return {
    source,
    transport: { type: "stdio", command: rebase(command), args: (args ?? []).map(rebase) },
    cwd:
      cwd && base && !isAbsolute(cwd) && !cwd.includes("${") ? resolve(base, cwd) : (cwd ?? base),
    variables,
    env,
    envNames,
    includeTools,
    excludeTools,
  };
}

export class MissingMcpEnvironment extends Error {}

export function resolveImportedMcp(
  imported: ImportedMcpConnection,
  workingDirectory?: string,
  overrideEnv?: [string, string][],
  overrideHeaders?: [string, string][],
): ResolvedImportedMcp {
  const { transport, source, variables } = imported;
  const expand = (text: string, remote = false): string =>
    text.replace(/\$\{([A-Za-z_]\w*)(?::-(.*?))?\}/g, (match, name: string, fallback?: string) => {
      if (variables && Object.hasOwn(variables, name)) return variables[name];
      if (source !== "claude-code") return match;
      if (remote && PROTECTED_HTTP_ENV.test(name)) return "";
      const value = process.env[name] ?? fallback;
      if (value !== undefined) return value;
      throw new MissingMcpEnvironment();
    });
  if (transport.type === "http") {
    const url = expand(transport.url, true);
    if (!isHttpEndpoint(url)) throw new Error("Invalid MCP URL");
    const headers = new Headers(
      overrideHeaders ?? imported.headers?.map(([name, value]) => [name, expand(value, true)]),
    );
    if (!overrideHeaders) {
      for (const [name, variable] of imported.headerVariables ?? []) {
        const value = process.env[variable];
        if (value === undefined) throw new MissingMcpEnvironment();
        headers.set(name, value);
      }
      if (imported.bearerVariable) {
        const token = process.env[imported.bearerVariable];
        if (!token) throw new MissingMcpEnvironment();
        headers.set("Authorization", "Bearer " + token);
      }
    }
    return { transport: { type: "http", url }, headers: Object.fromEntries(headers) };
  }
  const supplied =
    overrideEnv ??
    imported.env?.map(([name, value]): [string, string] => [name, expand(value)]) ??
    [];
  const forwarded = (imported.envNames ?? []).flatMap((name): [string, string][] =>
    process.env[name] !== undefined ? [[name, process.env[name]]] : [],
  );
  const cwd = imported.cwd ? expand(imported.cwd) : workingDirectory;
  return {
    transport: {
      type: "stdio",
      command: expand(transport.command),
      args: transport.args.map((arg) => expand(arg)),
    },
    cwd,
    env: Object.fromEntries([...Object.entries(variables ?? {}), ...forwarded, ...supplied]),
  };
}
