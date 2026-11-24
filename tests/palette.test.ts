import { describe, expect, it } from "vitest";

import { filterEntries, type PaletteEntry } from "../src/renderer/src/lib/palette";
import { relativeTime } from "../src/renderer/src/lib/relative-time";

const ENTRIES: PaletteEntry[] = [
  { kind: "action", id: "new-chat", label: "新聊天", detail: "Ctrl+N" },
  { kind: "action", id: "open-settings", label: "打开设置" },
  { kind: "chat", id: "s1", label: "设置5分钟后关机", detail: "5 分钟前" },
  { kind: "chat", id: "s2", label: "配置开发环境", detail: "1 小时前" },
];

describe("filterEntries", () => {
  it("returns everything on empty query with tab=all", () => {
    expect(filterEntries(ENTRIES, "", "all")).toHaveLength(4);
  });

  it("filters by label substring (case-insensitive)", () => {
    expect(filterEntries(ENTRIES, "设置", "all").map((e) => e.id)).toEqual(["open-settings", "s1"]);
    expect(filterEntries(ENTRIES, "CTRL", "all")).toHaveLength(0); // 只匹配 label
  });

  it("tab=actions keeps only actions", () => {
    const result = filterEntries(ENTRIES, "", "actions");
    expect(result.every((e) => e.kind === "action")).toBe(true);
    expect(result).toHaveLength(2);
  });

  it("tab=chats keeps only chats", () => {
    const result = filterEntries(ENTRIES, "", "chats");
    expect(result.every((e) => e.kind === "chat")).toBe(true);
    expect(result).toHaveLength(2);
  });

  it("combines query with tab filter", () => {
    const result = filterEntries(ENTRIES, "开发", "chats");
    expect(result.map((e) => e.id)).toEqual(["s2"]);
  });
});

describe("relativeTime", () => {
  const now = Date.parse("2026-01-10T12:00:00Z");

  it("shows 刚刚 within a minute", () => {
    expect(relativeTime(now - 30_000, "zh", now)).toBe("刚刚");
  });

  it("shows minutes within an hour", () => {
    expect(relativeTime(now - 5 * 60_000, "zh", now)).toBe("5 分钟前");
  });

  it("shows hours within a day", () => {
    expect(relativeTime(now - 3 * 3_600_000, "zh", now)).toBe("3 小时前");
  });

  it("shows 昨天 within two days", () => {
    expect(relativeTime(now - 1.5 * 86_400_000, "zh", now)).toBe("昨天");
  });

  it("falls back to a date beyond two days", () => {
    expect(relativeTime(now - 10 * 86_400_000, "zh", now)).toMatch(/^\d{4}\/\d{1,2}\/\d{1,2}$/);
  });
});
