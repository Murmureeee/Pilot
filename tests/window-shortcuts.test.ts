import { describe, expect, it } from "vitest";

import { windowShortcutAction } from "../src/renderer/src/lib/window-shortcuts";

type Mods = Partial<Record<"ctrlKey" | "metaKey" | "shiftKey" | "altKey", boolean>>;

function press(key: string, mods: Mods = {}): ReturnType<typeof windowShortcutAction> {
  return windowShortcutAction({
    key,
    ctrlKey: false,
    metaKey: false,
    shiftKey: false,
    altKey: false,
    ...mods,
  });
}

describe("window shortcuts", () => {
  it("maps the shortcuts listed in settings to menu actions", () => {
    expect(press("=", { ctrlKey: true })).toBe("zoom-in");
    expect(press("+", { ctrlKey: true, shiftKey: true })).toBe("zoom-in");
    expect(press("-", { ctrlKey: true })).toBe("zoom-out");
    expect(press("0", { ctrlKey: true })).toBe("zoom-reset");
    expect(press("r", { ctrlKey: true })).toBe("reload");
    expect(press("W", { ctrlKey: true })).toBe("close");
    expect(press("q", { metaKey: true })).toBe("quit");
    expect(press("F11")).toBe("fullscreen");
  });

  it("ignores plain typing and other modifier combinations", () => {
    expect(press("r")).toBeNull();
    expect(press("-")).toBeNull();
    expect(press("r", { ctrlKey: true, shiftKey: true })).toBeNull();
    expect(press("s", { ctrlKey: true, shiftKey: true })).toBeNull();
    expect(press("q", { ctrlKey: true, altKey: true })).toBeNull();
    expect(press("F11", { ctrlKey: true })).toBeNull();
    expect(press("k", { ctrlKey: true })).toBeNull();
  });
});
