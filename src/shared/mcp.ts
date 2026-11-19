// @env all
export type McpTransportConfig =
  | { type: "stdio"; command: string; args: string[] }
  | { type: "http"; url: string };

export interface McpServerConfig {
  id: string;
  name: string;
  enabled: boolean;
  policy: "inherit" | "confirm";
  transport: McpTransportConfig;
  encryptedEnv?: string;
  encryptedHeaders?: string;
  encryptedImport?: string;
  importKey?: string;
}

export interface McpServerInput extends Pick<
  McpServerConfig,
  "id" | "name" | "enabled" | "policy"
> {
  transport?: McpTransportConfig;
  env?: [string, string][];
  headers?: [string, string][];
}

export interface McpServerInfo extends Pick<
  McpServerConfig,
  "id" | "name" | "enabled" | "policy" | "transport"
> {
  hasEnv: boolean;
  imported: boolean;
  status: "disabled" | "connected" | "error";
  tools: { name: string; label: string }[];
  error?: string;
}
