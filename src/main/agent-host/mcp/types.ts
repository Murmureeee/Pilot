// @env node
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { McpClient } from "@earendil-works/pi-mcp";

export interface McpConnection {
  client: McpClient;
  signature: string;
  ready: Promise<void>;
  tools: AgentTool[];
  error?: string;
}

export interface McpToolPolicy {
  label: string;
  requireConfirmation: boolean;
}
