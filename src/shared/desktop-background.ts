// @env all
export const GLOBAL_COMPOSER_SHORTCUT = "CommandOrControl+Shift+Space";
export const GLOBAL_COMPOSER_SHORTCUT_LABEL = "Ctrl/⌘+Shift+Space";

export type DesktopBackgroundSetting = "closeToTray" | "globalComposerShortcut";

export interface DesktopBackgroundState {
  closeToTray: boolean;
  globalComposerShortcut: boolean;
  trayActive: boolean;
  shortcutActive: boolean;
}
