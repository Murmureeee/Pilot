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
  oauthClient?: McpOAuthClient | null;
}

export interface McpOAuthClient {
  clientId: string;
  callbackUrl?: string;
  scope?: string;
}

export interface McpOAuthInfo {
  id: string;
  revision: string;
  origin: string;
  status: "available" | "required" | "signed-in";
  hasCredentials: boolean;
}

export interface McpOAuthRef {
  id: string;
  revision: string;
  composerId?: string;
}

export interface McpServerInfo extends McpServerFields {
  transport: McpTransportConfig;
  hasEnv: boolean;
  imported: boolean;
  status: "disabled" | "connected" | "error";
  tools: { name: string; label: string }[];
  error?: string;
  oauth?: McpOAuthInfo;
  oauthClient?: McpOAuthClient;
}

export function isLoopbackHost(hostname: string): boolean {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "[::1]";
}

export function isMcpOAuthCallbackUrl(value: string): boolean {
  const url = URL.parse(value);
  return Boolean(
    url &&
    url.protocol === "http:" &&
    isLoopbackHost(url.hostname) &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash,
  );
}
