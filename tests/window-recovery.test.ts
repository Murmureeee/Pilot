// @env node
import { EventEmitter } from "node:events";

import type { BrowserWindow, MessageBoxOptions, MessageBoxReturnValue } from "electron";
import { beforeEach, expect, it, vi } from "vitest";

import type { DiagnosticLog } from "../src/main/diagnostics";
import { registerRenderer, setRendererLocale } from "../src/main/ipc/transport";
import { registerWindowRecovery } from "../src/main/window-recovery";

const { showMessageBox } = vi.hoisted(() => ({
  showMessageBox:
    vi.fn<(win: BrowserWindow, options: MessageBoxOptions) => Promise<MessageBoxReturnValue>>(),
}));
vi.mock("electron", () => ({ dialog: { showMessageBox }, ipcMain: {} }));

function setupWindow() {
  const contents = Object.assign(new EventEmitter(), {
    isDestroyed: vi.fn<() => boolean>(() => false),
    isCrashed: vi.fn<() => boolean>(() => false),
    forcefullyCrashRenderer: vi.fn<() => void>(),
    reload: vi.fn<() => void>(),
  });
  const win = { isDestroyed: () => false, webContents: contents } as unknown as BrowserWindow;
  const log = { write: vi.fn<DiagnosticLog["write"]>() };
  registerWindowRecovery(win, log);
  return { win, contents, log };
}

beforeEach(() => {
  showMessageBox.mockReset();
});

it("asks to reload the same window once after an unexpected exit", async () => {
  using logged = vi.spyOn(console, "error").mockImplementation(() => {});
  const { win, contents, log } = setupWindow();
  registerRenderer(win.webContents);
  setRendererLocale(win.webContents, "en");
  const response = Promise.withResolvers<MessageBoxReturnValue>();
  showMessageBox.mockReturnValue(response.promise);
  try {
    contents.emit("render-process-gone", {}, { reason: "clean-exit", exitCode: 0 });
    expect(showMessageBox).not.toHaveBeenCalled();
    contents.isCrashed.mockReturnValue(true);
    contents.emit("render-process-gone", {}, { reason: "oom", exitCode: 1 });
    contents.emit("unresponsive");
    expect(logged).toHaveBeenCalledOnce();
    expect(log.write).toHaveBeenCalledWith("error", "renderer", "process-gone", {
      reason: "oom",
      code: 1,
    });
    expect(showMessageBox).toHaveBeenCalledExactlyOnceWith(
      win,
      expect.objectContaining({
        message: "The Pilot interface ran out of memory",
        buttons: ["Reload"],
      }),
    );
    response.resolve({ response: 0, checkboxChecked: false });
    await response.promise;
    expect(contents.reload).toHaveBeenCalledOnce();
    expect(contents.forcefullyCrashRenderer).not.toHaveBeenCalled();
  } finally {
    contents.emit("destroyed");
  }
});

it("dismisses the hang prompt if the renderer responds before reloading", async () => {
  const { contents } = setupWindow();
  const response = Promise.withResolvers<MessageBoxReturnValue>();
  showMessageBox.mockReturnValue(response.promise);
  contents.emit("unresponsive");
  contents.emit("unresponsive");
  expect(showMessageBox).toHaveBeenCalledTimes(1);
  const { signal } = showMessageBox.mock.calls[0][1];
  contents.emit("responsive");
  expect(signal?.aborted).toBe(true);
  response.resolve({ response: 0, checkboxChecked: false });
  await response.promise;
  expect(contents.reload).not.toHaveBeenCalled();
  expect(contents.forcefullyCrashRenderer).not.toHaveBeenCalled();
});

it.each(["crashed", "killed"])(
  "accepts the %s exit after terminating a stuck renderer",
  async (reason) => {
    const { contents, log } = setupWindow();
    const response = Promise.resolve({ response: 0, checkboxChecked: false });
    showMessageBox.mockReturnValue(response);
    contents.emit("unresponsive");
    await response;
    expect(contents.forcefullyCrashRenderer).toHaveBeenCalledOnce();
    expect(contents.reload).not.toHaveBeenCalled();
    contents.emit("render-process-gone", {}, { reason, exitCode: 1 });
    await new Promise<void>((resolve) => setImmediate(resolve));
    expect(contents.reload).toHaveBeenCalledOnce();
    expect(showMessageBox).toHaveBeenCalledTimes(1);
    expect(log.write).toHaveBeenCalledWith("debug", "renderer", "process-gone", {
      reason,
      code: 1,
    });
  },
);

it("closes the recovery prompt with its window", async () => {
  const { contents } = setupWindow();
  const response = Promise.withResolvers<MessageBoxReturnValue>();
  showMessageBox.mockReturnValue(response.promise);
  contents.emit("unresponsive");
  const { signal } = showMessageBox.mock.calls[0][1];
  contents.emit("destroyed");
  expect(signal?.aborted).toBe(true);
  response.resolve({ response: 0, checkboxChecked: false });
  await response.promise;
  expect(contents.reload).not.toHaveBeenCalled();
});
