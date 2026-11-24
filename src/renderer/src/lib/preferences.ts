// @env browser
// 只影响渲染层的输入偏好，与主题一样存在 localStorage，不进主进程设置。
import type { SendKey } from "./types";

const SEND_KEY_STORAGE_KEY = "pilot-send-key";

export function loadSendKey(): SendKey {
  return localStorage.getItem(SEND_KEY_STORAGE_KEY) === "mod-enter" ? "mod-enter" : "enter";
}

export function saveSendKey(sendKey: SendKey): void {
  localStorage.setItem(SEND_KEY_STORAGE_KEY, sendKey);
}

const COLLAPSED_PROJECTS_STORAGE_KEY = "pilot-collapsed-projects";

export function loadCollapsedProjects(): string[] {
  try {
    const stored: unknown = JSON.parse(
      localStorage.getItem(COLLAPSED_PROJECTS_STORAGE_KEY) ?? "[]",
    );
    return Array.isArray(stored) ? stored.filter((item) => typeof item === "string") : [];
  } catch {
    return [];
  }
}

export function saveCollapsedProjects(directories: readonly string[]): void {
  localStorage.setItem(COLLAPSED_PROJECTS_STORAGE_KEY, JSON.stringify(directories));
}
