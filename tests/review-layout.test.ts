// @env browser
import { afterEach, expect, it, vi } from "vitest";

import { loadReviewWidth, saveReviewWidth } from "../src/renderer/src/lib/preferences";
import { reviewLayout } from "../src/renderer/src/lib/review-layout";

it("preserves a 21rem conversation and 360px review when a wide sidebar is preferred", () => {
  const layout = reviewLayout(1100, 520, false, true, null);
  expect(layout).toMatchObject({
    overlay: false,
    sidebarWidth: 340,
    reviewWidth: 360,
    range: { min: 360, max: 360 },
  });
  expect(reviewLayout(1100, 262, false, true, null).reviewWidth).toBe(387);
  expect(reviewLayout(1100, 262, true, true, null).reviewWidth).toBe(518);
});

it("uses the full card for sizing between the two breakpoints and overlays below 900px", () => {
  expect(reviewLayout(1099, 520, false, true, 650)).toMatchObject({
    overlay: false,
    reviewWidth: 650,
  });
  expect(reviewLayout(900, 520, false, true, 650)).toMatchObject({
    overlay: false,
    reviewWidth: 500,
  });
  expect(reviewLayout(899, 262, false, true, 650).overlay).toBe(true);
});

afterEach(() => vi.unstubAllGlobals());

it("restores the preferred width when room returns and ignores malformed saved widths", () => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
  expect(loadReviewWidth()).toBeNull();
  saveReviewWidth(620);
  const width = loadReviewWidth();
  expect(reviewLayout(900, 262, false, true, width).reviewWidth).toBe(500);
  expect(reviewLayout(1282, 262, false, true, width).reviewWidth).toBe(620);
  values.set("pilot-review-width", "NaN");
  expect(loadReviewWidth()).toBeNull();
  values.set("pilot-review-width", "200");
  expect(loadReviewWidth()).toBe(360);
});
