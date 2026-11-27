// @env node
import { createHash } from "node:crypto";

import type { McpServerInput } from "../../shared/mcp";
import { MCP_OAUTH_CHANGED } from "../agent-host/mcp/oauth/constants";
import { encryptSecret } from "./secrets";
import type { McpServerConfig, Settings } from "./types";

export async function saveMcpServer(
  readSettings: () => Settings,
  saveSettings: (settings: Settings) => void,
  { env, headers, transport, oauthClient, ...config }: McpServerInput,
): Promise<void> {
  const previous = readSettings().mcpServers?.find((server) => server.id === config.id);
  const connection = transport ?? previous?.transport;
  if (!connection) throw new Error("请填写 MCP 连接信息。");
  const sameConnection =
    !transport ||
    (!previous?.encryptedImport &&
      JSON.stringify(previous?.transport) === JSON.stringify(transport));
  const encryptedImport = sameConnection ? previous?.encryptedImport : undefined;
  const secret = async (
    pairs: [string, string][] | undefined,
    prior?: string,
  ): Promise<string | undefined> =>
    pairs === undefined
      ? sameConnection
        ? prior
        : undefined
      : pairs.length || encryptedImport
        ? encryptSecret(JSON.stringify(pairs))
        : undefined;
  const saved: McpServerConfig = {
    ...config,
    name: config.name.trim(),
    transport: connection,
    encryptedImport,
    importKey: previous?.importKey,
    encryptedEnv:
      connection.type === "stdio" ? await secret(env, previous?.encryptedEnv) : undefined,
    encryptedHeaders:
      connection.type === "http" ? await secret(headers, previous?.encryptedHeaders) : undefined,
    oauthClient:
      connection.type === "http"
        ? oauthClient === undefined && sameConnection
          ? previous?.oauthClient
          : (oauthClient ?? undefined)
        : undefined,
  };
  const settings = readSettings();
  const servers = settings.mcpServers ?? [];
  const latest = servers.find((server) => server.id === config.id);
  if (JSON.stringify(latest) !== JSON.stringify(previous)) throw new Error(MCP_OAUTH_CHANGED);
  saveSettings({
    ...settings,
    mcpServers: previous
      ? servers.map((server) => (server.id === saved.id ? saved : server))
      : [...servers, saved],
  });
}

export function mcpConnectionBinding(config: McpServerConfig): string {
  return createHash("sha256")
    .update(
      JSON.stringify([
        config.transport,
        config.encryptedHeaders,
        config.encryptedImport,
        config.oauthClient,
        config.project,
      ]),
    )
    .digest("hex");
}

export function pruneMcpOAuth(settings: Settings): Settings {
  if (!settings.mcpOAuth) return settings;
  const saved = new Map(settings.mcpServers?.map((server) => [server.id, server]));
  const retained = Object.entries(settings.mcpOAuth).filter(([id, entry]) => {
    if (entry.project !== undefined) return Boolean(settings.projectTrust?.[entry.project]);
    const server = saved.get(id);
    return server?.transport.type === "http" && entry.binding === mcpConnectionBinding(server);
  });
  return { ...settings, mcpOAuth: retained.length ? Object.fromEntries(retained) : undefined };
}
