import { describe, expect, it } from "vitest";
import { localizeError, t } from "../src/renderer/src/lib/i18n";
import { relativeTime } from "../src/renderer/src/lib/relative-time";

describe("interface language", () => {
  it("translates labels and preserves unknown text", () => {
    expect(t("工作环境", "en")).toBe("Working environment");
    expect(t("工作环境", "zh")).toBe("工作环境");
    expect(t("toString", "en")).toBe("toString");
    expect(
      localizeError(
        "Error invoking remote method 'settings:save': Error: 无法使用该工作目录。",
        "en",
      ),
    ).toBe("This working directory is unavailable.");
  });

  it("interpolates values literally and formats relative times in the active language", () => {
    expect(t("已完成 {0}/{1}", "en", [2, 3])).toBe("2 of 3 done");
    expect(t("允许「{0}」？", "en", ["$& {0}"])).toBe('Allow "$& {0}"?');
    expect(relativeTime(0, "zh", 120_000)).toBe("2 分钟前");
    expect(relativeTime(0, "en", 120_000)).toBe("2 minutes ago");
  });
});
