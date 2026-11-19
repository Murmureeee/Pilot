// @env browser
// 命令面板条目模型与过滤（纯函数，NFR-6 测试覆盖）。
export type PaletteTab = "all" | "actions" | "chats";

export interface PaletteEntry {
  kind: "action" | "chat";
  id: string;
  label: string;
  /** 操作快捷键提示或会话相对时间 */
  detail?: string;
}

export const PALETTE_TABS: { value: PaletteTab; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "actions", label: "操作" },
  { value: "chats", label: "聊天" },
];

export function filterEntries(
  entries: PaletteEntry[],
  query: string,
  tab: PaletteTab,
): PaletteEntry[] {
  const q = query.trim().toLowerCase();
  return entries.filter((entry) => {
    if (tab === "actions" && entry.kind !== "action") return false;
    if (tab === "chats" && entry.kind !== "chat") return false;
    if (q.length === 0) return true;
    return entry.label.toLowerCase().includes(q);
  });
}
