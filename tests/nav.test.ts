import { describe, expect, it } from "vitest";

import {
  canBack,
  canForward,
  initialNavState,
  moveNav,
  peekNav,
  pushNav,
} from "../src/renderer/src/lib/nav";

describe("nav stack", () => {
  it("records visits and truncates the forward branch", () => {
    let nav = initialNavState();
    nav = pushNav(nav, "a");
    nav = pushNav(nav, "b");
    nav = pushNav(nav, "c");
    expect(nav.stack).toEqual(["a", "b", "c"]);
    expect(nav.index).toBe(2);

    // 回退两次后（位于 a）：前进目标是 b；跳到新会话 → 前进分支 [b, c] 被截断
    nav = moveNav(nav, "back");
    nav = moveNav(nav, "back");
    expect(peekNav(nav, "forward")).toBe("b");
    nav = pushNav(nav, "d");
    expect(nav.stack).toEqual(["a", "d"]);
    expect(canForward(nav)).toBe(false);
  });

  it("ignores repeated visits to the current session", () => {
    let nav = initialNavState();
    nav = pushNav(nav, "a");
    nav = pushNav(nav, "a");
    expect(nav.stack).toEqual(["a"]);
  });

  it("boundaries disable back/forward", () => {
    let nav = initialNavState();
    expect(canBack(nav)).toBe(false);
    nav = pushNav(nav, "a");
    expect(canBack(nav)).toBe(false);
    expect(canForward(nav)).toBe(false);
    nav = pushNav(nav, "b");
    expect(canBack(nav)).toBe(true);
    expect(canForward(nav)).toBe(false);
  });

  it("moveNav is a no-op at boundaries", () => {
    const nav = initialNavState();
    expect(moveNav(nav, "back")).toEqual(nav);
    expect(peekNav(nav, "forward")).toBeUndefined();
  });
});
