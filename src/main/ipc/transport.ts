// @env node
import { ipcMain, type WebContents } from "electron";
import { DEFAULT_LOCALE } from "../../shared/constants";
import type { Locale } from "../../shared/contract";
import type { InvokeHandler, IpcChannel, RendererEvents } from "./types";
import { parseIpcArgs } from "./validation";

const renderers = new Map<WebContents, Locale>();

export function registerRenderer(contents: WebContents): void {
  renderers.set(contents, DEFAULT_LOCALE);
  contents.once("destroyed", () => {
    renderers.delete(contents);
  });
}

export function getRendererLocale(contents: WebContents): Locale {
  return renderers.get(contents) ?? DEFAULT_LOCALE;
}

export function setRendererLocale(contents: WebContents, locale: Locale): void {
  renderers.set(contents, locale);
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
  for (const contents of renderers.keys()) {
    if (!contents.isDestroyed() && !contents.isCrashed()) contents.send(channel, event);
  }
}
