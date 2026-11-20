// @env node
import type { McpServerInput } from "../../shared/mcp";
import { encryptSecret } from "./secrets";
import type { McpServerConfig, Settings } from "./types";

export function mergeMcpServer(
  settings: Settings,
  { env, headers, transport, ...config }: McpServerInput,
): Settings {
  const previous = settings.mcpServers?.find((server) => server.id === config.id);
  const connection = transport ?? previous?.transport;
  if (!connection) throw new Error("请填写 MCP 连接信息。");
  const sameConnection =
    !transport ||
    (!previous?.encryptedImport &&
      JSON.stringify(previous?.transport) === JSON.stringify(transport));
  const encryptedImport = sameConnection ? previous?.encryptedImport : undefined;
  const secret = (pairs: [string, string][] | undefined, prior?: string): string | undefined =>
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
    encryptedEnv: connection.type === "stdio" ? secret(env, previous?.encryptedEnv) : undefined,
    encryptedHeaders:
      connection.type === "http" ? secret(headers, previous?.encryptedHeaders) : undefined,
  };
  const servers = settings.mcpServers ?? [];
  return {
    ...settings,
    mcpServers: previous
      ? servers.map((server) => (server.id === saved.id ? saved : server))
      : [...servers, saved],
  };
}
