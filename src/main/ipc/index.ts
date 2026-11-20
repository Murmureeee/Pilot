// @env node
import { registerAgentRoutes } from "./agent";
import { registerAppRoutes } from "./app";
import { registerIntegrationRoutes } from "./integrations";
import { registerSettingsRoutes } from "./settings";
import type { IpcContext } from "./types";

export function registerIpc(ctx: IpcContext): void {
  registerAppRoutes(ctx);
  registerAgentRoutes(ctx);
  registerSettingsRoutes(ctx);
  registerIntegrationRoutes(ctx);
}
