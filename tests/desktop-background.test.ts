import { beforeEach, describe, expect, it, vi } from "vitest";

import { DesktopBackground } from "../src/main/desktop-background";
import type { Settings } from "../src/main/settings/types";
import type { DesktopBackgroundDependencies } from "../src/main/types";
import { GLOBAL_COMPOSER_SHORTCUT } from "../src/shared/desktop-background";

const { register, unregister, destroy, createMenu, quit, resize } = vi.hoisted(() => ({
  register: vi.fn<(key: string, callback: () => void) => boolean>(),
  unregister: vi.fn<(key: string) => void>(),
  destroy: vi.fn<() => void>(),
  createMenu: vi.fn<
    (template: { label: string; click(): void }[]) => { label: string; click(): void }[]
  >((template) => template),
  quit: vi.fn<() => void>(),
  resize: vi.fn<() => { isEmpty(): boolean }>(() => ({ isEmpty: () => false })),
}));

vi.mock("electron", () => ({
  app: { quit },
  globalShortcut: { register, unregister },
  Menu: { buildFromTemplate: createMenu },
  nativeImage: { createFromPath: () => ({ resize }) },
  Tray: class {
    destroy = destroy;
    isDestroyed(): boolean {
      return false;
    }
    setContextMenu(): void {}
    setToolTip(): void {}
    on(): void {}
  },
}));

function setup() {
  let settings: Settings = { providers: [], activeProviderId: "" };
  const window = {
    hide: vi.fn<() => void>(),
    webContents: {
      isLoadingMainFrame: vi.fn<() => boolean>(() => false),
      isCrashed: vi.fn<() => boolean>(() => false),
    },
  };
  const reveal = vi.fn<DesktopBackgroundDependencies["reveal"]>(
    () => window as unknown as ReturnType<DesktopBackgroundDependencies["reveal"]>,
  );
  const focusComposer = vi.fn<() => void>();
  const saveSettings = vi.fn<DesktopBackgroundDependencies["saveSettings"]>((next) => {
    settings = next;
  });
  const contents = window.webContents as unknown as Parameters<
    DesktopBackground["rendererReady"]
  >[0];
  const background = new DesktopBackground({
    getSettings: () => settings,
    saveSettings,
    reveal,
    focusComposer,
    getLocale: () => "en",
    log: { write: vi.fn<DesktopBackgroundDependencies["log"]["write"]>() },
    iconPath: "fixture.png",
  });
  return { background, contents, focusComposer, reveal, saveSettings, window };
}

describe("desktop background", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    register.mockReturnValue(true);
  });

  it("hides only while the native tray is enabled and routes Quit to app quit", () => {
    const { background, window, reveal } = setup();
    background.start();
    const nativeWindow = window as unknown as Parameters<DesktopBackground["hideWindow"]>[0];
    expect(background.hideWindow(nativeWindow)).toBe(false);
    expect(background.set("closeToTray", true)).toMatchObject({
      closeToTray: true,
      trayActive: true,
    });
    expect(background.hideWindow(nativeWindow)).toBe(true);
    expect(window.hide).toHaveBeenCalledOnce();
    const menu = createMenu.mock.calls[0]?.[0];
    menu?.find(({ label }) => label === "Quit Pilot")?.click();
    expect(reveal).toHaveBeenCalledOnce();
    expect(quit).toHaveBeenCalledOnce();
    expect(background.set("closeToTray", false)).toMatchObject({
      closeToTray: false,
      trayActive: false,
    });
    expect(destroy).toHaveBeenCalledOnce();
    expect(background.hideWindow(nativeWindow)).toBe(false);
  });

  it("focuses after the first snapshot or immediately when a renderer is ready", () => {
    const { background, contents, focusComposer, reveal } = setup();
    expect(background.set("globalComposerShortcut", true)).toMatchObject({ shortcutActive: true });
    expect(register).toHaveBeenCalledWith(GLOBAL_COMPOSER_SHORTCUT, expect.any(Function));
    const press = register.mock.calls[0][1];
    press();
    expect(reveal).toHaveBeenCalledOnce();
    expect(focusComposer).not.toHaveBeenCalled();
    expect(background.rendererReady(contents)).toBe(true);
    expect(background.rendererReady(contents)).toBe(false);
    press();
    expect(focusComposer).toHaveBeenCalledOnce();
    background.dispose();
    expect(unregister).toHaveBeenCalledWith(GLOBAL_COMPOSER_SHORTCUT);
  });

  it("does not save a shortcut already taken and releases a registration if saving fails", () => {
    const { background, saveSettings } = setup();
    register.mockReturnValueOnce(false);
    expect(() => background.set("globalComposerShortcut", true)).toThrow("无法注册全局快捷键");
    expect(saveSettings).not.toHaveBeenCalled();
    saveSettings.mockImplementationOnce(() => {
      throw new Error("disk unavailable");
    });
    expect(() => background.set("globalComposerShortcut", true)).toThrow("disk unavailable");
    expect(background.state()).toMatchObject({ shortcutActive: false });
    expect(unregister).toHaveBeenCalledOnce();
  });
});
