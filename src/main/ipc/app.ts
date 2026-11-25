// @env node
import { mkdirSync } from "node:fs";

import { BrowserWindow, app, nativeTheme, shell, type WebContents } from "electron";

import {
  IPC,
  type MenuAction,
  type OpenPathTarget,
  type PingResponse,
} from "../../shared/contract";
import { TITLE_BAR_OVERLAY_COLORS } from "../constants";
import { handle, setConversationVisible, setRendererLocale } from "./transport";
import type { IpcContext } from "./types";

/** 菜单动作白名单实现（渲染层传来的 action 必须命中此表） */
const MENU_ACTIONS: Record<MenuAction, (wc: WebContents) => void> = {
  undo: (wc) => wc.undo(),
  redo: (wc) => wc.redo(),
  cut: (wc) => wc.cut(),
  copy: (wc) => wc.copy(),
  paste: (wc) => wc.paste(),
  delete: (wc) => wc.delete(),
  "select-all": (wc) => wc.selectAll(),
  "zoom-in": (wc) => {
    wc.zoomLevel = Math.min(5, wc.zoomLevel + 0.5);
  },
  "zoom-out": (wc) => {
    wc.zoomLevel = Math.max(-3, wc.zoomLevel - 0.5);
  },
  "zoom-reset": (wc) => {
    wc.zoomLevel = 0;
  },
  reload: (wc) => wc.reload(),
  fullscreen: (wc) => {
    const win = BrowserWindow.fromWebContents(wc);
    win?.setFullScreen(!win.isFullScreen());
  },
  close: (wc) => {
    BrowserWindow.fromWebContents(wc)?.close();
  },
  quit: () => app.quit(),
};

export function registerAppRoutes(
  ctx: Pick<
    IpcContext,
    | "settingsDir"
    | "sessionsDir"
    | "skillsDir"
    | "logsDir"
    | "isDev"
    | "updater"
    | "exit"
    | "onConversationVisibilityChanged"
  >,
): void {
  handle(IPC.ping, (_event, request): PingResponse => {
    return { payload: `pong: ${request.payload}`, receivedAt: Date.now() };
  });

  handle(IPC.appInfo, () => ({
    version: app.getVersion(),
    isDev: ctx.isDev,
    isWindows: process.platform === "win32",
    settingsDir: ctx.settingsDir,
    sessionsDir: ctx.sessionsDir,
  }));
  handle(IPC.appOpenPath, (_event, target) => {
    const dirs: Record<OpenPathTarget, string> = {
      settings: ctx.settingsDir,
      sessions: ctx.sessionsDir,
      skills: ctx.skillsDir,
      logs: ctx.logsDir,
    };
    if (target === "logs") mkdirSync(ctx.logsDir, { recursive: true, mode: 0o700 });
    return shell.openPath(dirs[target]);
  });
  handle(IPC.appSetLocale, (event, locale) => setRendererLocale(event.sender, locale));
  handle(IPC.appSetConversationVisible, (event, visible) => {
    setConversationVisible(event.sender, visible);
    ctx.onConversationVisibilityChanged();
  });
  handle(IPC.appSetTitlebarTheme, (event, theme) => {
    // 无边框窗口的原生窗控颜色跟随主题（Linux 无 titleBarOverlay，静默忽略）
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    const dark = theme === "dark" || (theme === "system" && nativeTheme.shouldUseDarkColors);
    try {
      win.setTitleBarOverlay(TITLE_BAR_OVERLAY_COLORS[dark ? "dark" : "light"]);
    } catch {
      // 平台不支持 setTitleBarOverlay：保持创建时的颜色
    }
  });
  handle(IPC.menuAction, (event, action) => {
    MENU_ACTIONS[action](event.sender);
  });
  handle(IPC.appGetUpdateStatus, () => ctx.updater.getStatus());
  handle(IPC.appCheckForUpdates, () => ctx.updater.check());
  handle(IPC.appInstallUpdate, () => ctx.exit.installUpdate());
}
