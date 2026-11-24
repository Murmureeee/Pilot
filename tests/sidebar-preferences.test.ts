// @env browser
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  loadSidebarCollapsed,
  loadSidebarWidth,
  saveSidebarCollapsed,
  saveSidebarWidth,
} from "../src/renderer/src/lib/preferences";

beforeEach(() => {
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  });
});

afterEach(() => vi.unstubAllGlobals());

it("keeps the remembered width through collapse and expansion", () => {
  expect(loadSidebarWidth()).toBe(262);
  expect(loadSidebarCollapsed()).toBe(false);
  saveSidebarWidth(388);
  saveSidebarCollapsed(true);
  expect(loadSidebarWidth()).toBe(388);
  expect(loadSidebarCollapsed()).toBe(true);
  saveSidebarCollapsed(false);
  expect(loadSidebarWidth()).toBe(388);
  expect(loadSidebarCollapsed()).toBe(false);
});

it("recovers invalid values and clamps widths to the supported range", () => {
  localStorage.setItem("pilot-sidebar-width", "not a width");
  localStorage.setItem("pilot-sidebar-collapsed", "not a boolean");
  expect(loadSidebarWidth()).toBe(262);
  expect(loadSidebarCollapsed()).toBe(false);
  saveSidebarWidth(600);
  expect(loadSidebarWidth()).toBe(520);
  saveSidebarWidth(1);
  expect(loadSidebarWidth()).toBe(220);
});
