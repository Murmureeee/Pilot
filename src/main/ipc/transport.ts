// @env node
import { ipcMain, type WebContents } from "electron";
import type { InvokeHandler, IpcChannel, RendererEvents } from "./types";
import { parseIpcArgs } from "./validation";

const renderers = new Set<WebContents>();

export function registerRenderer(contents: WebContents): void {
  renderers.add(contents);
  contents.once("destroyed", () => {
    renderers.delete(contents);
  });
}

export function handle<C extends IpcChannel>(channel: C, listener: InvokeHandler<C>): void {
  ipcMain.handle(channel, (event, ...args: unknown[]) => {
    if (
      !renderers.has(event.sender) ||
      !event.senderFrame ||
      event.senderFrame !== event.sender.mainFrame
    ) {
      throw new Error("Invalid IPC sender for " + channel);
    }
    return listener(event, ...parseIpcArgs(channel, args));
  });
}

export function sendToRenderers<C extends keyof RendererEvents>(
  channel: C,
  event: RendererEvents[C],
): void {
  for (const contents of renderers) contents.send(channel, event);
}
