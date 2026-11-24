// @env node
import type { IpcMainInvokeEvent } from "electron";

import type {
  AGENT_EVENT_CHANNEL,
  IPC,
  UiAgentEvent,
  UPDATE_STATUS_CHANNEL,
  UpdateStatus,
} from "../../shared/contract";
import type { AgentHost } from "../agent-host/host";
import type { McpManager } from "../agent-host/mcp";
import type { DesktopExit } from "../desktop-exit";
import type { Settings } from "../settings/types";
import type { DesktopUpdater } from "../updater";
import type { VerificationManager } from "../verification";
import type { parseIpcArgs } from "./validation";

export type IpcChannel = (typeof IPC)[keyof typeof IPC];

export type InvokeHandler<C extends IpcChannel> = (
  event: IpcMainInvokeEvent,
  ...args: ReturnType<typeof parseIpcArgs<C>>
) => unknown;

export type RendererEvents = {
  [AGENT_EVENT_CHANNEL]: UiAgentEvent;
  [UPDATE_STATUS_CHANNEL]: UpdateStatus;
};

export interface IpcContext {
  settingsDir: string;
  sessionsDir: string;
  skillsDir: string;
  logsDir: string;
  getSettings(): Settings;
  saveSettings(settings: Settings): void;
  host: AgentHost;
  mcp: McpManager;
  updater: DesktopUpdater;
  verification: VerificationManager;
  exit: DesktopExit;
  isDev: boolean;
}
