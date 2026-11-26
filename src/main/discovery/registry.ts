// @env node
import {
  MCP_REGISTRY_SERVERS_URL,
  type McpRegistryConnection,
  type McpRegistryEntry,
  type McpRegistryPage,
} from "../../shared/discovery";
import { object } from "../external-import/sources";
import type { ConfigObject } from "../external-import/types";
import {
  REGISTRY_INVALID,
  REGISTRY_MAX_BYTES,
  REGISTRY_METADATA,
  REGISTRY_PAGE_SIZE,
  REGISTRY_TIMEOUT,
  REGISTRY_UNAVAILABLE,
} from "./constants";

const variablePattern = /\{([-\w.]+)\}/g;
const envName = /^[A-Za-z_][A-Za-z0-9_]*$/;
const headerName = /^[!#$%&'*+.^_\x60|~0-9A-Za-z-]+$/;
const packageName = /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/i;
const packageVersion = /^[0-9][\w.+!-]*$/;

function records(value: unknown): ConfigObject[] {
  return Array.isArray(value) ? value.map(object) : [];
}

function text(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function valueOf(input: ConfigObject): string | undefined {
  return input.isSecret === true ? undefined : (text(input.value) ?? text(input.default));
}

function fill(textValue: string, variables: unknown): string {
  const values = object(variables);
  return textValue.replace(
    variablePattern,
    (placeholder, name: string) => valueOf(object(values[name])) ?? placeholder,
  );
}

function keyValues(
  value: unknown,
  pattern: RegExp,
): Pick<McpRegistryConnection, "values" | "required"> {
  const values = new Map<string, string>();
  const required = new Set<string>();
  for (const input of records(value)) {
    const name = text(input.name);
    if (!name || !pattern.test(name)) continue;
    const initial = fill(valueOf(input) ?? "", input.variables);
    values.set(name, /[\r\n\0]/.exec(initial) ? "" : initial);
    if (input.isRequired === true) required.add(name);
  }
  return { values: [...values], required: [...required] };
}

function argumentsOf(value: unknown): string[] {
  return records(value).flatMap((input, index) => {
    if (input.type !== "named" && input.type !== "positional") return [];
    const name = text(input.name);
    if (input.type === "named" && (!name || !/^--?[\w-]+$/.test(name))) return [];
    const initial = valueOf(input);
    if (!initial && input.isRequired !== true) return [];
    const hint = text(input.valueHint) ?? name?.replace(/^-+/, "") ?? "argument-" + (index + 1);
    const argument = initial
      ? fill(initial, input.variables)
      : "{" + hint.replace(/[^\w.-]/g, "-") + "}";
    if (/[\r\n\0]/.exec(argument)) return [];
    return input.type === "named" && name ? [name, argument] : [argument];
  });
}

function httpConnection(remote: ConfigObject): McpRegistryConnection | undefined {
  const template = text(remote.url);
  if (remote.type !== "streamable-http" || !template || /[\r\n\0]/.exec(template)) return;
  const url = fill(template, remote.variables);
  const endpoint = URL.parse(url.replace(variablePattern, "value"));
  if (
    !endpoint ||
    !["http:", "https:"].includes(endpoint.protocol) ||
    endpoint.username ||
    endpoint.password
  )
    return;
  return { transport: { type: "http", url }, ...keyValues(remote.headers, headerName) };
}

function packageConnection(item: ConfigObject): McpRegistryConnection | undefined {
  if (
    !["npm", "pypi"].includes(String(item.registryType)) ||
    object(item.transport).type !== "stdio" ||
    item.fileSha256
  )
    return;
  const npm = item.registryType === "npm";
  const command = npm ? "npx" : "uvx";
  const baseUrl = npm ? "https://registry.npmjs.org" : "https://pypi.org";
  if (
    (item.runtimeHint && item.runtimeHint !== command) ||
    (item.registryBaseUrl &&
      String(item.registryBaseUrl).replace(/\/(?:simple\/?)?$/, "") !== baseUrl)
  )
    return;
  const identifier = text(item.identifier);
  const version = text(item.version);
  if (
    !identifier ||
    !packageName.test(identifier) ||
    (!npm && identifier.includes("/")) ||
    !version ||
    !packageVersion.test(version)
  )
    return;
  const runtime = argumentsOf(item.runtimeArguments);
  const target = identifier + (npm ? "@" : "==") + version;
  if (npm && !runtime.some((arg) => arg === "-y" || arg === "--yes")) runtime.unshift("--yes");
  const args = [...runtime, target, ...argumentsOf(item.packageArguments)];
  return {
    transport: { type: "stdio", command, args },
    ...keyValues(item.environmentVariables, envName),
  };
}

function sourceUrl(value: unknown): string | undefined {
  const source = text(value);
  const url = source && URL.parse(source);
  return url && ["http:", "https:"].includes(url.protocol) && !url.username && !url.password
    ? url.href
    : undefined;
}

function registryPage(raw: unknown): McpRegistryPage {
  const result = object(raw);
  if (!Array.isArray(result.servers)) throw new Error(REGISTRY_INVALID);
  const entries: McpRegistryEntry[] = [];
  for (const row of records(result.servers)) {
    const metadata = object(object(row["_meta"])[REGISTRY_METADATA]);
    if (metadata.status === "deleted" || metadata.status === "deprecated") continue;
    const server = object(row.server);
    const id = text(server.name);
    const version = text(server.version);
    if (!id || !version) continue;
    const namespace = id.split("/")[0];
    const publisher = namespace.replace(/^io\.github\./i, "");
    const connections = [
      ...records(server.remotes).flatMap((remote) => httpConnection(remote) ?? []),
      ...records(server.packages).flatMap((item) => packageConnection(item) ?? []),
    ];
    entries.push({
      id,
      name: text(server.title) ?? id,
      description: text(server.description) ?? "",
      publisher,
      version,
      repository: sourceUrl(object(server.repository).url) ?? sourceUrl(server.websiteUrl),
      connections,
    });
  }
  return { entries, cursor: text(object(result.metadata).nextCursor) };
}

async function readResponse(response: Response): Promise<unknown> {
  if (!response.body) throw new Error(REGISTRY_INVALID);
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let result = "";
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > REGISTRY_MAX_BYTES) {
        await reader.cancel();
        throw new Error(REGISTRY_INVALID);
      }
      result += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
  try {
    return JSON.parse(result + decoder.decode()) as unknown;
  } catch (cause) {
    throw new Error(REGISTRY_INVALID, { cause });
  }
}

export async function searchMcpRegistry(
  query: string,
  cursor: string | undefined,
  request: typeof fetch,
): Promise<McpRegistryPage> {
  const url = new URL(MCP_REGISTRY_SERVERS_URL);
  url.searchParams.set("version", "latest");
  url.searchParams.set("limit", String(REGISTRY_PAGE_SIZE));
  if (query) url.searchParams.set("search", query);
  if (cursor) url.searchParams.set("cursor", cursor);
  try {
    const response = await request(url, {
      headers: { Accept: "application/json" },
      redirect: "error",
      signal: AbortSignal.timeout(REGISTRY_TIMEOUT),
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(REGISTRY_UNAVAILABLE);
    }
    return registryPage(await readResponse(response));
  } catch (cause) {
    if (cause instanceof Error && cause.message === REGISTRY_INVALID) throw cause;
    throw new Error(REGISTRY_UNAVAILABLE, { cause });
  }
}
