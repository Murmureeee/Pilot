// @env node
import { registerAgentRoutes } from "./agent";
import { registerAppRoutes } from "./app";
import { registerBackupRoutes } from "./backup";
import { registerIntegrationRoutes } from "./integrations";
import { registerSettingsRoutes } from "./settings";
import { registerTerminalRoutes } from "./terminal";
import type { IpcContext } from "./types";

export function registerIpc(ctx: IpcContext): void {
  registerAppRoutes(ctx);
  registerBackupRoutes(ctx);
  registerAgentRoutes(ctx);
  registerSettingsRoutes(ctx);
  registerIntegrationRoutes(ctx);
  registerTerminalRoutes(ctx);
}
