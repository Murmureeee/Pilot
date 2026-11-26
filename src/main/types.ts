// @env node
import type { BrowserWindow, Rectangle, Session } from "electron";

import type { AgentHost } from "./agent-host/host";
import type { McpManager } from "./agent-host/mcp";
import type { DiagnosticLog } from "./diagnostics";
import type { TerminalManager } from "./terminal";
import type { DesktopUpdater } from "./updater";
import type { VerificationManager } from "./verification";

export type ExitAction = "quit" | "closeWindow" | "update";
export type ExitStage = "idle" | "confirming" | "stopping" | "closing-window" | "exiting";

export interface DesktopExitDependencies {
  getWindow(): BrowserWindow | undefined;
  host: Pick<AgentHost, "hasActiveRun" | "stopForExit">;
  verification: Pick<VerificationManager, "hasActiveRuns" | "stopAll">;
  terminal: Pick<TerminalManager, "hasActiveProcesses" | "stopAll">;
  mcp: Pick<McpManager, "close">;
  updater: Pick<DesktopUpdater, "getStatus" | "install">;
  log: Pick<DiagnosticLog, "write">;
}

export interface WindowState {
  bounds: Rectangle;
  maximized: boolean;
}

export interface DesktopNetwork {
  fetch: typeof globalThis.fetch;
  configureProxy(session: Pick<Session, "setProxy">): Promise<void>;
}
export type ProjectEntry = string | null | undefined;
