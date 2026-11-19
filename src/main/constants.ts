// @env node
// Electron derives its default profile path from the app name. Keep existing profiles on rename.
export const USER_DATA_DIRECTORY = "pi Desktop";

// 原生窗控与 src/renderer/src/assets/main.css 的窗口底色对齐。
export const TITLE_BAR_OVERLAY_COLORS = {
  light: { color: "#edf2f7", symbolColor: "#243448" },
  dark: { color: "#161e28", symbolColor: "#e4ebf4" },
} as const;
