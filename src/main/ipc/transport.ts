// @env node
import { ipcMain, type WebContents } from "electron";

import { DEFAULT_LOCALE } from "../../shared/constants";
import type { Locale } from "../../shared/contract";
import type { InvokeHandler, IpcChannel, RendererContext, RendererEvents } from "./types";
import { parseIpcArgs } from "./validation";

const renderers = new Map<WebContents, RendererContext>();

export function registerRenderer(contents: WebContents): void {
  renderers.set(contents, { locale: DEFAULT_LOCALE, conversationVisible: false });
  contents.once("destroyed", () => {
    renderers.delete(contents);
  });
}

export function getRendererLocale(contents: WebContents): Locale {
  return renderers.get(contents)?.locale ?? DEFAULT_LOCALE;
}

export function setRendererLocale(contents: WebContents, locale: Locale): void {
  const context = renderers.get(contents);
  if (context) context.locale = locale;
}

export function isConversationVisible(contents: WebContents): boolean {
  const context = renderers.get(contents);
  return (
    context?.conversationVisible === true && !contents.isCrashed() && !contents.isLoadingMainFrame()
  );
}

export function setConversationVisible(contents: WebContents, visible: boolean): void {
  const context = renderers.get(contents);
  if (context) context.conversationVisible = visible;
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
