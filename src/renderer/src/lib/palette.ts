// @env browser
// 命令面板条目模型与过滤（纯函数，NFR-6 测试覆盖）。
import type { SessionSearchHit, SessionSearchResults } from "@shared/contract";

import type { SettingsSection, WorkbenchCommand } from "./types";

export type PaletteTab = "all" | "action" | "project" | "chat" | "settings";

export interface PaletteEntry {
  kind: Exclude<PaletteTab, "all">;
  id: string;
  label: string;
  detail?: string;
  terms?: readonly string[];
  command?: WorkbenchCommand;
  section?: SettingsSection;
  hit?: SessionSearchHit;
  findQuery?: string;
}

export interface PaletteSearch {
  key: string;
  result?: SessionSearchResults;
  error?: string;
}

export const PALETTE_TABS: { value: PaletteTab; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "action", label: "操作" },
  { value: "project", label: "项目" },
  { value: "chat", label: "聊天" },
  { value: "settings", label: "设置" },
];

export function filterEntries(
  entries: PaletteEntry[],
  query: string,
  tab: PaletteTab,
): PaletteEntry[] {
  const q = query.trim().normalize("NFKC").toLowerCase();
  return entries.filter((entry) => {
    if (tab !== "all" && entry.kind !== tab) return false;
    if (q.length === 0) return true;
    return [entry.label, ...(entry.terms ?? [])].some((text) =>
      text.normalize("NFKC").toLowerCase().includes(q),
    );
  });
}
