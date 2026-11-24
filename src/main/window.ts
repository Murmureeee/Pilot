// @env node
import type { BrowserWindow } from "electron";

/** 把已打开的窗口带到前台：再次启动应用时，由已在运行的实例调用。 */
export function revealWindow(
  win: Pick<BrowserWindow, "isMinimized" | "restore" | "show" | "focus">,
): void {
  if (win.isMinimized()) win.restore();
  win.show();
  win.focus();
}
