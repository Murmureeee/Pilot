// @env browser
// 主题（FR-5.5：亮/暗/跟随系统）：documentElement 的 .dark class + localStorage 持久化；
// 切换时同步原生标题栏窗控颜色（system 档由主进程 nativeTheme 解析）。
import { useSyncExternalStore } from "react";

import type { ThemeSetting } from "@shared/contract";

const STORAGE_KEY = "pilot-theme";
const LEGACY_STORAGE_KEY = "pi-theme";

export function loadTheme(): ThemeSetting {
  const raw = localStorage.getItem(STORAGE_KEY) ?? localStorage.getItem(LEGACY_STORAGE_KEY);
  return raw === "dark" || raw === "light" ? raw : "system";
}

/** 应用主题到 DOM 并同步原生标题栏；system 档下 DOM 需要立即解析（不等系统事件） */
export function applyTheme(theme: ThemeSetting): void {
  localStorage.setItem(STORAGE_KEY, theme);
  const dark =
    theme === "dark" ||
    (theme === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
  void window.pi?.setTitlebarTheme(theme).catch(() => {});
  window.dispatchEvent(new Event("pilot-theme-change"));
}

function subscribeTheme(onChange: () => void): () => void {
  window.addEventListener("pilot-theme-change", onChange);
  return () => window.removeEventListener("pilot-theme-change", onChange);
}

export function useTheme(): ThemeSetting {
  return useSyncExternalStore(subscribeTheme, loadTheme);
}

/** 跟随系统时监听系统主题变化（返回退订函数） */
export function watchSystemTheme(onChange: () => void): () => void {
  const mq = window.matchMedia("(prefers-color-scheme: dark)");
  mq.addEventListener("change", onChange);
  return () => mq.removeEventListener("change", onChange);
}
