// @env node
import type { BrowserWindow, Rectangle } from "electron";
import type { AgentHost } from "./agent-host/host";
import type { McpManager } from "./agent-host/mcp";
import type { DiagnosticLog } from "./diagnostics";
import type { DesktopUpdater } from "./updater";
import type { VerificationManager } from "./verification";

export type ExitAction = "quit" | "closeWindow" | "update";
export type ExitStage = "idle" | "confirming" | "stopping" | "closing-window" | "exiting";

export interface DesktopExitDependencies {
  getWindow(): BrowserWindow | undefined;
  host: Pick<AgentHost, "hasActiveRun" | "stopForExit">;
  verification: Pick<VerificationManager, "hasActiveRuns" | "stopAll">;
  mcp: Pick<McpManager, "close">;
  updater: Pick<DesktopUpdater, "getStatus" | "install">;
  log: Pick<DiagnosticLog, "write">;
}

export interface WindowState {
  bounds: Rectangle;
  maximized: boolean;
}
