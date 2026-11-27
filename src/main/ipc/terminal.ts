// @env node
import { IPC } from "../../shared/contract";
import { getCommandShell } from "../workspace/shell";
import { handle } from "./transport";
import type { IpcContext } from "./types";

export function registerTerminalRoutes({
  host,
  terminal,
  getSettings,
  exit,
}: Pick<IpcContext, "host" | "terminal" | "getSettings" | "exit">): void {
  handle(IPC.sessionTerminals, (_event, composerId) => {
    host.checkComposerId(composerId);
    return terminal.list(composerId);
  });
  handle(IPC.sessionOpenTerminal, (_event, composerId, directory, size) => {
    exit.checkWorkAllowed();
    const cwd = host.prepareTerminal(composerId, directory);
    return terminal.open(composerId, cwd, getCommandShell(getSettings().commandShell, cwd), size);
  });
  handle(IPC.sessionTerminalOutput, (_event, composerId, id) => {
    host.checkComposerId(composerId);
    return terminal.output(composerId, id);
  });
  handle(IPC.sessionWriteTerminal, (_event, composerId, id, data) => {
    exit.checkWorkAllowed();
    host.checkComposerId(composerId);
    terminal.write(composerId, id, data);
  });
  handle(IPC.sessionResizeTerminal, (_event, composerId, id, size) => {
    host.checkComposerId(composerId);
    terminal.resize(composerId, id, size);
  });
  handle(IPC.sessionStopTerminal, (_event, composerId, id) => {
    host.checkComposerId(composerId);
    return terminal.stop(composerId, id);
  });
}
