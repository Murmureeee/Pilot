// @env browser
import { SIDEBAR_DEFAULT_WIDTH, SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH } from "./constants";
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

const SIDEBAR_WIDTH_STORAGE_KEY = "pilot-sidebar-width";
const SIDEBAR_COLLAPSED_STORAGE_KEY = "pilot-sidebar-collapsed";

function readSidebarPreference(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeSidebarPreference(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Keep the current layout usable if the profile cannot save preferences.
  }
}

export function loadSidebarWidth(): number {
  const value = readSidebarPreference(SIDEBAR_WIDTH_STORAGE_KEY)?.trim();
  const width = Number(value);
  if (!value || !Number.isFinite(width)) return SIDEBAR_DEFAULT_WIDTH;
  return Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, Math.round(width)));
}

export function saveSidebarWidth(width: number): void {
  writeSidebarPreference(SIDEBAR_WIDTH_STORAGE_KEY, String(width));
}

export function loadSidebarCollapsed(): boolean {
  return readSidebarPreference(SIDEBAR_COLLAPSED_STORAGE_KEY) === "true";
}

export function saveSidebarCollapsed(collapsed: boolean): void {
  writeSidebarPreference(SIDEBAR_COLLAPSED_STORAGE_KEY, String(collapsed));
}
