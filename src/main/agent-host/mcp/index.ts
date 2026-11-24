// @env node
import { createHash } from "node:crypto";
import { addAbortListener } from "node:events";

import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import {
  createMcpToolName,
  limitMcpContent,
  McpAuthRequiredError,
  McpClient,
  McpTimeoutError,
  normalizeMcpInputSchema,
  StdioTransport,
  StreamableHttpTransport,
  toLlmContent,
  type McpTransport,
  type Tool,
} from "@earendil-works/pi-mcp";

import type { McpServerInfo } from "@shared/mcp";

import { APP_NAME, APP_PACKAGE_NAME } from "../../../shared/constants";
import { MissingMcpEnvironment, resolveImportedMcp } from "../../external-import/mcp";
import type { ImportedMcpConnection } from "../../external-import/types";
import { decryptSecret } from "../../settings/secrets";
import type { McpServerConfig, Settings } from "../../settings/types";
import type { McpConnection, McpToolPolicy } from "./types";

function readEncrypted<T>(stored?: string): T | undefined {
  if (!stored) return undefined;
  const plaintext = decryptSecret(stored);
  if (!plaintext) throw new Error("MCP credentials are unreadable");
  return JSON.parse(plaintext) as T;
}

function createTransport(
  config: McpServerConfig,
  cwd?: string,
  imported?: ImportedMcpConnection,
): McpTransport {
  const envPairs = readEncrypted<[string, string][]>(config.encryptedEnv);
  const headerPairs = readEncrypted<[string, string][]>(config.encryptedHeaders);
  const resolved = imported
    ? resolveImportedMcp(imported, cwd, envPairs, headerPairs)
    : {
        transport: config.transport,
        cwd,
        env: Object.fromEntries(envPairs ?? []),
        headers: Object.fromEntries(headerPairs ?? []),
      };
  const { transport } = resolved;
  if (transport.type === "http") {
    const headers = resolved.headers;
    return new StreamableHttpTransport({
      url: transport.url,
      headers,
      // A redirected endpoint must never receive the previous server's private headers.
      fetch:
        headers && Object.keys(headers).length
          ? (url, init) => fetch(url, { ...init, redirect: "error" })
          : undefined,
    });
  }
  return new StdioTransport({
    command: transport.command,
    args: transport.args,
    cwd: resolved.cwd,
    env: resolved.env,
  });
}

function buildTool(client: McpClient, entry: Tool, name: string, serverName: string): AgentTool {
  const label = `${serverName} / ${entry.title ?? entry.name}`;
  return {
    name,
    label,
    description: entry.description ?? entry.name,
    parameters: normalizeMcpInputSchema(entry.inputSchema),
    executionMode: "sequential",
    execute: async (_id, args, signal): Promise<AgentToolResult> => {
      const result = await client.callTool(entry.name, args as Record<string, unknown>, { signal });
      const { content } = await limitMcpContent(toLlmContent(result));
      if (result.isError) {
        const reason = content
          .filter((part) => part.type === "text")
          .map((part) => part.text)
          .join("\n");
        throw new Error(reason || "MCP 工具执行失败。");
      }
      return { content, details: { toolLabel: label } };
    },
  };
}

export class McpManager {
  private readonly connections = new Map<string, McpConnection>();
  private readonly closing = new Set<Promise<void>>();
  private readonly reconnectOnSync = new Set<string>();
  private configs: McpServerConfig[] = [];

  constructor(
    private readonly getSettings: () => Settings,
    private readonly version: string,
  ) {}

  private sync(workingDirectory: string | undefined, reconnectId?: string): McpConnection[] {
    const { mcpServers = [] } = this.getSettings();
    this.configs = mcpServers;
    const active = mcpServers.filter((config) => config.enabled);
    const enabledIds = new Set(active.map((config) => config.id));
    for (const id of this.connections.keys()) {
      if (!enabledIds.has(id) || id === reconnectId || this.reconnectOnSync.has(id)) {
        this.disconnect(id);
      }
    }
    this.reconnectOnSync.clear();
    return active.map((config) => {
      // A changed endpoint or executable gets a new namespace so old approvals do not transfer.
      const signature = JSON.stringify([
        config.id,
        config.name,
        config.transport,
        config.encryptedEnv,
        config.encryptedHeaders,
        config.encryptedImport,
        config.transport.type === "stdio" ? workingDirectory : undefined,
      ]);
      const existing = this.connections.get(config.id);
      if (existing?.signature === signature) return existing;
      this.disconnect(config.id);
      const client = new McpClient({
        // Servers can use the client name as a stable identifier.
        name: APP_PACKAGE_NAME,
        title: APP_NAME,
        version: this.version,
        requestTimeoutMs: 10000,
      });
      const connection: McpConnection = {
        client,
        signature,
        ready: Promise.resolve(),
        tools: [],
      };
      connection.ready = this.connect(connection, config, workingDirectory);
      this.connections.set(config.id, connection);
      return connection;
    });
  }

  private disconnect(id: string): void {
    const connection = this.connections.get(id);
    if (!connection) return;
    this.connections.delete(id);
    const closed = connection.client.close().catch(() => {});
    this.closing.add(closed);
    void closed.then(() => this.closing.delete(closed));
  }

  private async connect(
    connection: McpConnection,
    config: McpServerConfig,
    cwd?: string,
  ): Promise<void> {
    const { client, signature } = connection;
    try {
      const imported = readEncrypted<ImportedMcpConnection>(config.encryptedImport);
      await client.connect(createTransport(config, cwd, imported));
      const entries = client.serverCapabilities?.tools ? await client.listTools() : [];
      const include = imported?.includeTools ? new Set(imported.includeTools) : undefined;
      const exclude = new Set(imported?.excludeTools);
      const namespace = createHash("sha256").update(signature).digest("hex").slice(0, 12);
      const names = new Set<string>();
      connection.tools = entries
        .filter(({ name }) => (!include || include.has(name)) && !exclude.has(name))
        .map((tool) => {
          const name = createMcpToolName(namespace, tool.name, (candidate) => names.has(candidate));
          names.add(name);
          return buildTool(client, tool, name, config.name);
        });
    } catch (error) {
      // Process output and response bodies can contain secrets from the server environment.
      connection.error =
        error instanceof MissingMcpEnvironment
          ? "缺少 MCP 所需的环境变量。"
          : error instanceof McpTimeoutError
            ? "连接 MCP 服务超时。"
            : error instanceof McpAuthRequiredError
              ? "此 MCP 服务需要身份验证。"
              : "无法连接 MCP 服务，请检查命令或地址。";
      await client.close().catch(() => {});
    }
  }

  async list(
    workingDirectory: string | undefined,
    reconnectId?: string,
    preserveConnections = false,
  ): Promise<McpServerInfo[]> {
    // A tool in flight still holds the client created for its run's working directory.
    if (preserveConnections && reconnectId) this.reconnectOnSync.add(reconnectId);
    const connections = preserveConnections
      ? [...this.connections.values()]
      : this.sync(workingDirectory, reconnectId);
    await Promise.all(connections.map((connection) => connection.ready));
    return (this.getSettings().mcpServers ?? []).map(
      ({ id, name, transport, enabled, policy, encryptedEnv, encryptedImport }) => {
        const connection = this.connections.get(id);
        const connected = connection?.client.connectionState === "connected" && !connection.error;
        return {
          id,
          name,
          transport,
          enabled,
          policy,
          imported: Boolean(encryptedImport),
          hasEnv: Boolean(encryptedEnv || (encryptedImport && transport.type === "stdio")),
          status: !enabled ? "disabled" : connected ? "connected" : "error",
          tools: connected
            ? connection.tools.map((tool) => ({ name: tool.name, label: tool.label }))
            : [],
          error: enabled && !connected ? (connection?.error ?? "MCP 连接已断开。") : undefined,
        };
      },
    );
  }

  async tools(workingDirectory: string | undefined, signal?: AbortSignal): Promise<AgentTool[]> {
    signal?.throwIfAborted();
    const connections = this.sync(workingDirectory);
    const ready = Promise.all(connections.map((connection) => connection.ready));
    if (signal) {
      const cancelled = Promise.withResolvers<never>();
      const listener = addAbortListener(signal, () => cancelled.reject(signal.reason));
      try {
        await Promise.race([ready, cancelled.promise]);
      } finally {
        listener[Symbol.dispose]();
      }
    } else {
      await ready;
    }
    return connections.flatMap((connection) =>
      connection.client.connectionState === "connected" ? connection.tools : [],
    );
  }

  policyOf(name: string): McpToolPolicy | undefined {
    for (const config of this.configs) {
      const tool = this.connections.get(config.id)?.tools.find((entry) => entry.name === name);
      if (tool) {
        return { label: tool.label, requireConfirmation: config.policy === "confirm" };
      }
    }
    return undefined;
  }

  async close(): Promise<void> {
    for (const id of this.connections.keys()) this.disconnect(id);
    await Promise.all(this.closing);
  }
}
