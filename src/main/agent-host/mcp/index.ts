// @env node
import { createHash } from "node:crypto";
import { addAbortListener } from "node:events";

import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import {
  createMcpToolName,
  limitMcpContent,
  McpAuthRequiredError,
  McpClient,
  McpHttpError,
  McpTimeoutError,
  normalizeMcpInputSchema,
  StdioTransport,
  StreamableHttpTransport,
  toLlmContent,
  type McpTransport,
  type StreamableHttpTransportOptions,
  type Tool,
} from "@earendil-works/pi-mcp";
import { McpOAuthAuthorizationRequiredError } from "@earendil-works/pi-mcp/oauth";

import type { Locale } from "@shared/contract";
import type { McpOAuthInfo, McpServerInfo } from "@shared/mcp";

import { APP_NAME, APP_PACKAGE_NAME } from "../../../shared/constants";
import { MissingMcpEnvironment, resolveImportedMcp } from "../../external-import/mcp";
import type { ImportedMcpConnection, ResolvedImportedMcp } from "../../external-import/types";
import { decryptSecret } from "../../settings/secrets";
import type { McpServerConfig, Settings } from "../../settings/types";
import { mcpOAuthEndpoint, type McpOAuth } from "./oauth";
import { MCP_OAUTH_CHANGED, MCP_OAUTH_REQUIRED } from "./oauth/constants";
import type { McpOAuthEndpoint } from "./oauth/types";
import type { McpConnection, McpTool, McpToolPolicy } from "./types";

function readEncrypted<T>(stored?: string): T | undefined {
  if (!stored) return undefined;
  const plaintext = decryptSecret(stored);
  if (!plaintext) throw new Error("MCP credentials are unreadable");
  return JSON.parse(plaintext) as T;
}

function importedConnection(config: McpServerConfig): ImportedMcpConnection | undefined {
  return config.project?.connection ?? readEncrypted<ImportedMcpConnection>(config.encryptedImport);
}

function resolveConnection(
  config: McpServerConfig,
  cwd?: string,
  imported?: ImportedMcpConnection,
): ResolvedImportedMcp {
  const envPairs = readEncrypted<[string, string][]>(config.encryptedEnv);
  const headerPairs = readEncrypted<[string, string][]>(config.encryptedHeaders);
  return imported
    ? resolveImportedMcp(imported, cwd, envPairs, headerPairs)
    : {
        transport: config.transport,
        cwd,
        env: Object.fromEntries(envPairs ?? []),
        headers: Object.fromEntries(headerPairs ?? []),
      };
}

function createTransport(
  resolved: ResolvedImportedMcp,
  request = globalThis.fetch,
  authProvider?: StreamableHttpTransportOptions["authProvider"],
): McpTransport {
  const { transport } = resolved;
  if (transport.type === "http") {
    const headers = resolved.headers;
    return new StreamableHttpTransport({
      url: transport.url,
      headers,
      authProvider,
      // A redirected endpoint must never receive the previous server's private headers.
      fetch: (url, init) =>
        (headers && Object.keys(headers).length) || new Headers(init?.headers).has("Authorization")
          ? request(url, { ...init, redirect: "error" })
          : request(url, init),
    });
  }
  return new StdioTransport({
    command: transport.command,
    args: transport.args,
    cwd: resolved.cwd,
    env: resolved.env,
  });
}

function buildTool(
  client: McpClient,
  entry: Tool,
  name: string,
  serverName: string,
  describeError: (error: unknown) => string | undefined,
): McpTool {
  const label = `${serverName} / ${entry.title ?? entry.name}`;
  return {
    name,
    label,
    remoteName: entry.name,
    description: entry.description ?? entry.name,
    parameters: normalizeMcpInputSchema(entry.inputSchema),
    executionMode: "sequential",
    execute: async (_id, args, signal): Promise<AgentToolResult> => {
      const result = await client
        .callTool(entry.name, args as Record<string, unknown>, { signal })
        .catch((error: unknown) => {
          const message = describeError(error);
          if (message) throw new Error(message);
          throw error;
        });
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
  private readonly pausedPluginServers = new Map<string, number>();
  private readonly reconnectOnSync = new Set<string>();
  private configs: McpServerConfig[] = [];

  constructor(
    private readonly getSettings: () => Settings,
    private readonly version: string,
    private readonly request?: typeof globalThis.fetch,
    private readonly oauth?: McpOAuth,
  ) {}

  oauthInfo(config: McpServerConfig): McpOAuthInfo | undefined {
    const endpoint = this.oauthEndpoint(config);
    if (endpoint) return this.oauth?.info(endpoint);
  }

  private oauthEndpoint(config?: McpServerConfig): McpOAuthEndpoint | undefined {
    if (!this.oauth || !config || config.transport.type !== "http") return;
    try {
      const connection = resolveConnection(config, undefined, importedConnection(config));
      if (connection.transport.type !== "http") return;
      return mcpOAuthEndpoint(config, connection.transport.url, connection.headers);
    } catch {
      // Editing a connection while browser authorization is open invalidates the pending grant.
    }
  }

  async signIn(
    config: () => McpServerConfig | undefined,
    revision: string,
    requestId: string,
    locale: Locale,
  ): Promise<boolean> {
    const endpoint = this.oauthEndpoint(config());
    if (endpoint?.revision !== revision || !this.oauth) throw new Error(MCP_OAUTH_CHANGED);
    const signedIn = await this.oauth.signIn(
      endpoint,
      requestId,
      locale,
      () => this.oauthEndpoint(config())?.revision === revision,
    );
    if (signedIn) this.reconnectOnSync.add(endpoint.id);
    return signedIn;
  }

  cancelSignIn(requestId?: string): void {
    this.oauth?.cancel(requestId);
  }

  signOut(config: McpServerConfig | undefined, revision: string): void {
    const endpoint = this.oauthEndpoint(config);
    if (endpoint?.revision !== revision || !this.oauth) throw new Error(MCP_OAUTH_CHANGED);
    this.oauth.signOut(endpoint);
    this.reconnectOnSync.add(endpoint.id);
  }

  private sync(
    workingDirectory: string | undefined,
    reconnectId?: string,
    projectServers: readonly McpServerConfig[] = [],
  ): McpConnection[] {
    const mcpServers = [...(this.getSettings().mcpServers ?? []), ...projectServers];
    this.configs = mcpServers;
    const active = mcpServers.filter(
      (config) => config.enabled && !this.pausedPluginServers.has(config.id),
    );
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
        ...(config.project ? [config.project] : []),
        ...(config.oauthClient ? [config.oauthClient] : []),
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

  async closeProjectServers(): Promise<void> {
    for (const config of this.configs) {
      if (config.project) this.disconnect(config.id);
    }
    this.configs = this.configs.filter((config) => !config.project);
    await Promise.all(this.closing);
  }

  async withPluginServersClosed(ids: readonly string[], change: () => void): Promise<void> {
    for (const id of ids) {
      this.pausedPluginServers.set(id, (this.pausedPluginServers.get(id) ?? 0) + 1);
      this.disconnect(id);
    }
    try {
      await Promise.all(this.closing);
      change();
    } finally {
      for (const id of ids) {
        const remaining = (this.pausedPluginServers.get(id) ?? 1) - 1;
        if (remaining > 0) this.pausedPluginServers.set(id, remaining);
        else this.pausedPluginServers.delete(id);
      }
    }
  }

  private async connect(
    connection: McpConnection,
    config: McpServerConfig,
    cwd?: string,
  ): Promise<void> {
    const { client, signature } = connection;
    let endpoint: McpOAuthEndpoint | undefined;
    const loginRequired = (error: unknown): boolean =>
      error instanceof McpOAuthAuthorizationRequiredError ||
      Boolean(
        endpoint &&
        this.oauth &&
        error instanceof McpAuthRequiredError &&
        this.oauth.recordChallenge(endpoint, error.wwwAuthenticate),
      );
    try {
      const imported = importedConnection(config);
      const resolved = resolveConnection(config, cwd, imported);
      if (this.oauth && resolved.transport.type === "http")
        endpoint = mcpOAuthEndpoint(config, resolved.transport.url, resolved.headers);
      await client.connect(
        createTransport(resolved, this.request, endpoint && this.oauth?.provider(endpoint)),
      );
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
          return buildTool(client, tool, name, config.name, (error) => {
            if (loginRequired(error)) return MCP_OAUTH_REQUIRED;
            if (endpoint && error instanceof McpHttpError) return "MCP 请求失败。请检查服务连接。";
          });
        });
    } catch (error) {
      // Process output and response bodies can contain secrets from the server environment.
      connection.error = loginRequired(error)
        ? MCP_OAUTH_REQUIRED
        : error instanceof MissingMcpEnvironment
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
    if (!preserveConnections) this.sync(workingDirectory, reconnectId);
    const configs = this.getSettings().mcpServers ?? [];
    await Promise.all(configs.map(({ id }) => this.connections.get(id)?.ready));
    return configs.map((config) => {
      const { id, name, transport, enabled, policy, encryptedEnv, encryptedImport, oauthClient } =
        config;
      const connection = this.connections.get(id);
      const connected = connection?.client.connectionState === "connected" && !connection.error;
      return {
        id,
        name,
        transport,
        enabled,
        policy,
        imported: Boolean(encryptedImport),
        oauth: this.oauthInfo(config),
        oauthClient,
        hasEnv: Boolean(encryptedEnv || (encryptedImport && transport.type === "stdio")),
        status: !enabled ? "disabled" : connected ? "connected" : "error",
        tools: connected
          ? connection.tools.map((tool) => ({ name: tool.name, label: tool.label }))
          : [],
        error: enabled && !connected ? (connection?.error ?? "MCP 连接已断开。") : undefined,
      };
    });
  }

  async tools(
    workingDirectory: string | undefined,
    signal?: AbortSignal,
    projectServers?: readonly McpServerConfig[],
  ): Promise<AgentTool[]> {
    signal?.throwIfAborted();
    const connections = this.sync(workingDirectory, undefined, projectServers);
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
        return {
          label: tool.label,
          serverName: config.name,
          toolName: tool.remoteName,
          requireConfirmation: config.policy === "confirm",
        };
      }
    }
    return undefined;
  }

  async close(): Promise<void> {
    for (const id of this.connections.keys()) this.disconnect(id);
    await Promise.all([this.oauth?.close(), ...this.closing]);
  }
}
