// @env node
import { app, globalShortcut, Menu, nativeImage, Tray } from "electron";
import type { BrowserWindow, WebContents } from "electron";

import { APP_NAME } from "../shared/constants";
import {
  GLOBAL_COMPOSER_SHORTCUT,
  type DesktopBackgroundSetting,
  type DesktopBackgroundState,
} from "../shared/desktop-background";
import { DESKTOP_BACKGROUND_COPY, DESKTOP_BACKGROUND_ERRORS } from "./constants";
import { errorDetails } from "./diagnostics";
import type { DesktopBackgroundDependencies } from "./types";

export class DesktopBackground {
  private tray?: Tray;
  private shortcutActive = false;
  private readonly ready = new WeakSet<WebContents>();
  private pendingFocus?: WebContents;

  constructor(private readonly deps: DesktopBackgroundDependencies) {}

  start(): void {
    const settings = this.deps.getSettings();
    for (const key of ["closeToTray", "globalComposerShortcut"] as const) {
      if (!settings[key]) continue;
      try {
        this.apply(key, true);
      } catch (error) {
        this.deps.log.write("warn", "main", "desktop-background-unavailable", errorDetails(error));
      }
    }
  }

  state(): DesktopBackgroundState {
    const settings = this.deps.getSettings();
    return {
      closeToTray: settings.closeToTray === true,
      globalComposerShortcut: settings.globalComposerShortcut === true,
      trayActive: this.tray !== undefined,
      shortcutActive: this.shortcutActive,
    };
  }

  set(setting: DesktopBackgroundSetting, enabled: boolean): DesktopBackgroundState {
    const current = this.deps.getSettings();
    const previous = setting === "closeToTray" ? this.tray !== undefined : this.shortcutActive;
    this.apply(setting, enabled);
    try {
      this.deps.saveSettings({ ...current, [setting]: enabled });
    } catch (error) {
      this.apply(setting, previous);
      throw error;
    }
    return this.state();
  }

  rendererReady(contents: WebContents): boolean {
    this.ready.add(contents);
    if (this.pendingFocus !== contents) return false;
    this.pendingFocus = undefined;
    return true;
  }

  hideWindow(window: BrowserWindow): boolean {
    if (!this.tray || this.tray.isDestroyed()) return false;
    window.hide();
    return true;
  }

  updateTrayMenu(): void {
    if (!this.tray) return;
    const copy = DESKTOP_BACKGROUND_COPY[this.deps.getLocale()];
    this.tray.setContextMenu(
      Menu.buildFromTemplate([
        {
          label: copy.open,
          click: () => {
            this.deps.reveal();
          },
        },
        { type: "separator" },
        {
          label: copy.quit,
          click: () => {
            this.deps.reveal();
            app.quit();
          },
        },
      ]),
    );
  }

  dispose(): void {
    this.apply("globalComposerShortcut", false);
    this.apply("closeToTray", false);
    this.pendingFocus = undefined;
  }

  private apply(setting: DesktopBackgroundSetting, enabled: boolean): void {
    if (setting === "globalComposerShortcut") {
      if (this.shortcutActive === enabled) return;
      if (!enabled) {
        globalShortcut.unregister(GLOBAL_COMPOSER_SHORTCUT);
        this.shortcutActive = false;
        return;
      }
      let registered = false;
      try {
        registered = globalShortcut.register(GLOBAL_COMPOSER_SHORTCUT, () => {
          const contents = this.deps.reveal()?.webContents;
          if (!contents) return;
          if (this.ready.has(contents) && !contents.isLoadingMainFrame() && !contents.isCrashed()) {
            this.deps.focusComposer();
          } else {
            this.pendingFocus = contents;
          }
        });
      } catch {
        throw new Error(DESKTOP_BACKGROUND_ERRORS.globalComposerShortcut);
      }
      if (!registered) throw new Error(DESKTOP_BACKGROUND_ERRORS.globalComposerShortcut);
      this.shortcutActive = true;
      return;
    }

    if (!enabled) {
      this.tray?.destroy();
      this.tray = undefined;
      return;
    }
    if (this.tray) return;
    try {
      const icon = nativeImage.createFromPath(this.deps.iconPath).resize({ width: 20 });
      if (icon.isEmpty()) throw new Error("Missing tray icon");
      this.tray = new Tray(icon);
      this.tray.setToolTip(APP_NAME);
      this.tray.on("click", () => this.deps.reveal());
      this.updateTrayMenu();
    } catch {
      this.tray?.destroy();
      this.tray = undefined;
      throw new Error(DESKTOP_BACKGROUND_ERRORS.closeToTray);
    }
  }
}
