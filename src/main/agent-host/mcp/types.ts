// @env node
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { McpClient } from "@earendil-works/pi-mcp";

export interface McpConnection {
  client: McpClient;
  signature: string;
  ready: Promise<void>;
  tools: McpTool[];
  error?: string;
}

export interface McpTool extends AgentTool {
  remoteName: string;
}

export interface McpToolPolicy {
  label: string;
  serverName: string;
  toolName: string;
  requireConfirmation: boolean;
}

export interface McpToolSession {
  tools(signal: AbortSignal): Promise<AgentTool[]>;
  policyOf(name: string): McpToolPolicy | undefined;
  close(): Promise<void>;
}
