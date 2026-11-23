// @env browser
// 应用菜单已移除（Menu.setApplicationMenu(null)），Electron 不再提供窗口级快捷键，由渲染层识别后走菜单动作白名单。
import type { MenuAction } from "@shared/contract";

export function windowShortcutAction(event: {
  key: string;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}): MenuAction | null {
  // AltGr 在部分键盘布局上等于 Ctrl+Alt，是在输入字符，不是快捷键。
  if (event.altKey) return null;
  const mod = event.ctrlKey || event.metaKey;
  if (event.key === "F11") return mod || event.shiftKey ? null : "fullscreen";
  if (!mod) return null;
  // Ctrl+= 与 Ctrl+Shift+=（即 Ctrl++）都放大。
  if (event.key === "=" || event.key === "+") return "zoom-in";
  if (event.shiftKey) return null;
  switch (event.key.toLowerCase()) {
    case "-":
      return "zoom-out";
    case "0":
      return "zoom-reset";
    case "r":
      return "reload";
    case "w":
      return "close";
    case "q":
      return "quit";
    default:
      return null;
  }
}
