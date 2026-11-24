// @env node
import { expect, it } from "vitest";
import { revealWindow } from "../src/main/window";

function fakeWindow(
  minimized: boolean,
): { calls: string[]; isMinimized: () => boolean } & Record<
  "restore" | "show" | "focus",
  () => void
> {
  const calls: string[] = [];
  return {
    calls,
    isMinimized: () => minimized,
    restore: () => calls.push("restore"),
    show: () => calls.push("show"),
    focus: () => calls.push("focus"),
  };
}

it("restores a minimized window before focusing it", () => {
  const win = fakeWindow(true);
  revealWindow(win);
  expect(win.calls).toEqual(["restore", "show", "focus"]);
});

it("leaves the size of a visible window alone", () => {
  const win = fakeWindow(false);
  revealWindow(win);
  expect(win.calls).toEqual(["show", "focus"]);
});
