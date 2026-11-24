import { describe, expect, it } from "vitest";

import { levelAt, levelIndex, levelLabel } from "../src/renderer/src/lib/thinking-level";

describe("thinking-level mapping", () => {
  it("round-trips index ↔ level", () => {
    for (let i = 0; i < 7; i++) {
      expect(levelIndex(levelAt(i))).toBe(i);
    }
  });

  it("clamps out-of-range indices", () => {
    expect(levelAt(-3)).toBe("off");
    expect(levelAt(99)).toBe("max");
  });

  it("labels all levels in Chinese", () => {
    expect(levelLabel("off")).toBe("关闭");
    expect(levelLabel("medium")).toBe("中");
    expect(levelLabel("max")).toBe("最高");
  });
});
