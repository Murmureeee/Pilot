// @env node
import type { McpOAuthState } from "@earendil-works/pi-mcp/oauth";

import type { McpOAuthClient, McpOAuthRef } from "@shared/mcp";

import type { Settings } from "../../../settings/types";

export interface McpOAuthEndpoint extends Pick<McpOAuthRef, "id" | "revision"> {
  url: URL;
  binding: string;
  project?: string;
  client?: McpOAuthClient;
}

export interface McpOAuthOptions {
  getSettings(): Settings;
  saveSettings(settings: Settings): void;
  request: typeof globalThis.fetch;
  openBrowser(url: string): Promise<void>;
}

export interface McpOAuthAttempt {
  requestId: string;
  controller: AbortController;
  done: Promise<boolean>;
}

export interface McpOAuthStored {
  record: NonNullable<Settings["mcpOAuth"]>[string];
  state?: McpOAuthState;
}
