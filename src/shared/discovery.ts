// @env all
import type { GitPluginSource } from "./imports";
import type { McpTransportConfig } from "./mcp";

export const MCP_REGISTRY_SERVERS_URL = "https://registry.modelcontextprotocol.io/v0.1/servers";
export const MCP_REGISTRY_MIN_QUERY = 3;

export interface PluginMarketplaceSource {
  location: string;
  name: string;
}

export interface MarketplaceEntry {
  key: string;
  name: string;
  description?: string;
  author: string;
  version?: string;
  source?: GitPluginSource;
  sourceType: string;
}

export interface PluginMarketplace extends PluginMarketplaceSource {
  entries: MarketplaceEntry[];
}

export interface McpRegistryConnection {
  transport: McpTransportConfig;
  values: [string, string][];
  required: string[];
}

export interface McpRegistryEntry {
  id: string;
  name: string;
  description: string;
  publisher: string;
  version: string;
  repository?: string;
  connections: McpRegistryConnection[];
}

export interface McpRegistryPage {
  entries: McpRegistryEntry[];
  cursor?: string;
}
