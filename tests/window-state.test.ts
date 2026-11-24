// @env node
import { EventEmitter } from "node:events";
import { existsSync, mkdtempDisposableSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { screen, type BrowserWindow, type Rectangle } from "electron";
import { beforeEach, expect, it, vi } from "vitest";

import type { DiagnosticLog } from "../src/main/diagnostics";
import { loadWindowState, rememberWindow } from "../src/main/window-state";

const { getAllDisplays, getPrimaryDisplay } = vi.hoisted(() => ({
  getAllDisplays: vi.fn<() => { workArea: Rectangle }[]>(),
  getPrimaryDisplay: vi.fn<() => { workArea: Rectangle }>(),
}));

vi.mock("electron", () => ({
  screen: Object.assign(new EventEmitter(), { getAllDisplays, getPrimaryDisplay }),
}));

const primary = { workArea: { x: 40, y: 20, width: 1200, height: 800 } };
const secondary = { workArea: { x: -1440, y: -200, width: 1440, height: 960 } };
const bounds = { x: -1100, y: -150, width: 900, height: 600 };

beforeEach(() => {
  getAllDisplays.mockReturnValue([primary, secondary]);
  getPrimaryDisplay.mockReturnValue(primary);
});

it("preserves normal bounds and maximization on a display with negative coordinates", () => {
  using dir = mkdtempDisposableSync(join(tmpdir(), "pilot-window-"));
  const file = join(dir.path, "window-state.json");
  const state = { bounds, maximized: true };
  writeFileSync(file, JSON.stringify(state));
  expect(loadWindowState(file)).toEqual(state);
});

it("centers a window from a removed display on the primary work area", () => {
  using dir = mkdtempDisposableSync(join(tmpdir(), "pilot-window-"));
  const file = join(dir.path, "window-state.json");
  getAllDisplays.mockReturnValue([primary]);
  writeFileSync(file, JSON.stringify({ bounds, maximized: false }));
  expect(loadWindowState(file)).toEqual({
    bounds: { x: 190, y: 120, width: 900, height: 600 },
    maximized: false,
  });
});

it("fits a saved window to a smaller work area", () => {
  using dir = mkdtempDisposableSync(join(tmpdir(), "pilot-window-"));
  const file = join(dir.path, "window-state.json");
  getAllDisplays.mockReturnValue([{ workArea: { x: -1440, y: -200, width: 820, height: 510 } }]);
  writeFileSync(file, JSON.stringify({ bounds, maximized: false }));
  expect(loadWindowState(file)?.bounds).toEqual({ x: -1440, y: -200, width: 820, height: 510 });
});

it("uses the startup defaults when the saved window dimensions are missing or corrupted", () => {
  using dir = mkdtempDisposableSync(join(tmpdir(), "pilot-window-"));
  const file = join(dir.path, "window-state.json");
  expect(loadWindowState(file)).toBeUndefined();
  writeFileSync(file, "{broken");
  expect(loadWindowState(file)).toBeUndefined();
  writeFileSync(file, JSON.stringify({ bounds: { ...bounds, x: NaN }, maximized: false }));
  expect(loadWindowState(file)).toBeUndefined();
});

it("flushes normal geometry on close while preserving maximization through minimize", () => {
  using dir = mkdtempDisposableSync(join(tmpdir(), "pilot-window-"));
  const file = join(dir.path, "window-state.json");
  const window = Object.assign(new EventEmitter(), {
    getNormalBounds: () => bounds,
    isDestroyed: () => false,
    isFullScreen: () => false,
    isMaximized: () => false,
    isMinimized: vi.fn<() => boolean>(() => false),
  });
  rememberWindow(window as unknown as BrowserWindow, file, {
    write: vi.fn<DiagnosticLog["write"]>(),
  });
  try {
    window.emit("move");
    window.emit("maximize");
    window.isMinimized.mockReturnValue(true);
    window.emit("unmaximize");
    expect(existsSync(file)).toBe(false);
    window.emit("close");
    expect(JSON.parse(readFileSync(file, "utf8"))).toEqual({ bounds, maximized: true });
  } finally {
    window.emit("closed");
  }
});

it("moves an open window onto the primary display when its monitor is removed", () => {
  using dir = mkdtempDisposableSync(join(tmpdir(), "pilot-window-"));
  const window = Object.assign(new EventEmitter(), {
    getBounds: () => bounds,
    isDestroyed: () => false,
    isFullScreen: () => false,
    isMaximized: () => false,
    isMinimized: () => false,
    setBounds: vi.fn<(rectangle: Rectangle) => void>(),
  });
  rememberWindow(window as unknown as BrowserWindow, join(dir.path, "window-state.json"), {
    write: vi.fn<DiagnosticLog["write"]>(),
  });
  try {
    getAllDisplays.mockReturnValue([primary]);
    screen.emit("display-removed");
    expect(window.setBounds).toHaveBeenCalledExactlyOnceWith({
      x: 190,
      y: 120,
      width: 900,
      height: 600,
    });
  } finally {
    window.emit("closed");
  }
  screen.emit("display-removed");
  expect(window.setBounds).toHaveBeenCalledTimes(1);
});
