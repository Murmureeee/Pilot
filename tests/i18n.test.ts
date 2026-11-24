import { describe, expect, it, vi } from "vitest";

import { formatDuration } from "../src/renderer/src/lib/duration";
import {
  currentLocale,
  localizeError,
  restoreLocale,
  setLocale,
  t,
  watchLocale,
} from "../src/renderer/src/lib/i18n";
import { relativeTime } from "../src/renderer/src/lib/relative-time";

describe("interface language", () => {
  it("translates labels and preserves unknown text", () => {
    expect(t("工作环境", "en")).toBe("Working environment");
    expect(t("工作环境", "zh")).toBe("工作环境");
    expect(t("toString", "en")).toBe("toString");
    expect(t("还没有翻译的文案：{0}", "en")).toBe("还没有翻译的文案：{0}");
    expect(
      localizeError(
        "Error invoking remote method 'settings:save': Error: 无法使用该工作目录。",
        "en",
      ),
    ).toBe("This working directory is unavailable.");
    expect(localizeError("Missing: config.yaml", "en")).toBe("Missing: config.yaml");
  });

  it("interpolates values literally and formats relative times in the active language", () => {
    expect(t("已完成 {0}/{1}", "en", [2, 3])).toBe("2 of 3 done");
    expect(t("允许「{0}」？", "en", ["$& {0}"])).toBe('Allow "$& {0}"?');
    expect(relativeTime(0, "zh", 120_000)).toBe("2 分钟前");
    expect(relativeTime(0, "en", 120_000)).toBe("2 minutes ago");
    expect(t("退出 {0}", "en", ["Pilot"])).toBe("Quit Pilot");
    expect(t("连接正常 · {0}ms", "en", [42])).toBe("Connected · 42 ms");
    expect(t("退出 {0}", "en", [])).toBe("Quit {0}");
    expect(t("退出 {0}", "en", ["$5 {0}"])).toBe("Quit $5 {0}");
  });

  it("formats step durations by length", () => {
    expect(formatDuration(40, "zh")).toBe("0.1 秒");
    expect(formatDuration(3_240, "zh")).toBe("3.2 秒");
    expect(formatDuration(59_600, "zh")).toBe("1 分 0 秒");
    expect(formatDuration(133_000, "zh")).toBe("2 分 13 秒");
    expect(formatDuration(133_000, "en")).toBe("2m 13s");
  });

  it("migrates the legacy locale preference and uses the Pilot key", () => {
    const values = new Map([["pi-locale", "en"]]);
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    });
    const reportLocale = vi.fn<(locale: string) => void>();
    const unwatch = watchLocale(reportLocale);
    try {
      restoreLocale();
      expect(currentLocale()).toBe("en");
      setLocale("zh");
      expect(currentLocale()).toBe("zh");
      expect(values.get("pilot-locale")).toBe("zh");
      values.set("pilot-locale", "unknown");
      restoreLocale();
      expect(currentLocale()).toBe("zh");
      expect(reportLocale.mock.calls).toEqual([["en"], ["zh"], ["zh"]]);
    } finally {
      unwatch();
      vi.unstubAllGlobals();
    }
  });
});
