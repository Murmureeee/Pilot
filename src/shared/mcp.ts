// @env all
export type McpTransportConfig =
  | { type: "stdio"; command: string; args: string[] }
  | { type: "http"; url: string };

export interface McpServerFields {
  id: string;
  name: string;
  enabled: boolean;
  policy: "inherit" | "confirm";
}

export interface McpServerInput extends McpServerFields {
  transport?: McpTransportConfig;
  env?: [string, string][];
  headers?: [string, string][];
}

export interface McpServerInfo extends McpServerFields {
  transport: McpTransportConfig;
  hasEnv: boolean;
  imported: boolean;
  status: "disabled" | "connected" | "error";
  tools: { name: string; label: string }[];
  error?: string;
}
