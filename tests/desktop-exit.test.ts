// @env node
import { EventEmitter } from "node:events";

import type { BrowserWindow, MessageBoxOptions, MessageBoxReturnValue } from "electron";
import { beforeEach, expect, it, vi } from "vitest";

import { DesktopExit } from "../src/main/desktop-exit";
import type { DiagnosticLog } from "../src/main/diagnostics";
import type { UpdateStatus } from "../src/shared/contract";

const { appOn, appQuit, showMessageBox } = vi.hoisted(() => ({
  appOn: vi.fn<(event: string, listener: (event: { preventDefault(): void }) => void) => void>(),
  appQuit: vi.fn<() => void>(),
  showMessageBox:
    vi.fn<
      (
        ...args: [MessageBoxOptions] | [BrowserWindow, MessageBoxOptions]
      ) => Promise<MessageBoxReturnValue>
    >(),
}));

vi.mock("electron", () => ({
  app: { on: appOn, quit: appQuit },
  dialog: { showMessageBox },
  ipcMain: {},
}));

function setupExit(agentActive = true, verificationActive = true) {
  const win = Object.assign(new EventEmitter(), { isDestroyed: () => false, webContents: {} });
  const host = {
    hasActiveRun: () => agentActive,
    stopForExit: vi.fn<() => Promise<void>>(async () => {}),
  };
  const verification = {
    hasActiveRuns: () => verificationActive,
    stopAll: vi.fn<() => Promise<void>>(async () => {}),
  };
  const mcp = { close: vi.fn<() => Promise<void>>(async () => {}) };
  const updater = {
    getStatus: vi.fn<() => UpdateStatus>(() => ({ state: "ready", version: "0.3.1" })),
    install: vi.fn<(allowQuit: () => void) => Promise<boolean>>(async (allowQuit) => {
      allowQuit();
      return true;
    }),
  };
  const log = { write: vi.fn<DiagnosticLog["write"]>() };
  const window = win as unknown as BrowserWindow;
  const exit = new DesktopExit({ getWindow: () => window, host, verification, mcp, updater, log });
  exit.watchWindow(window);
  const requestQuit = (): ReturnType<typeof vi.fn<() => void>> => {
    const preventDefault = vi.fn<() => void>();
    appOn.mock.calls[0][1]({ preventDefault });
    return preventDefault;
  };
  return { exit, win, host, verification, mcp, updater, log, requestQuit };
}

beforeEach(() => {
  appOn.mockClear();
  appQuit.mockClear();
  showMessageBox.mockReset();
});

it("keeps tasks running when a single quit confirmation is cancelled", async () => {
  const { exit, win, host, verification, mcp, requestQuit } = setupExit();
  const response = Promise.withResolvers<MessageBoxReturnValue>();
  showMessageBox.mockReturnValue(response.promise);

  expect(requestQuit()).toHaveBeenCalledOnce();
  const preventClose = vi.fn<() => void>();
  win.emit("close", { preventDefault: preventClose });
  expect(preventClose).toHaveBeenCalledOnce();
  expect(showMessageBox).toHaveBeenCalledTimes(1);
  expect(showMessageBox.mock.calls[0][1]).toMatchObject({
    message: "退出 Pilot？",
    buttons: ["取消", "停止并退出"],
    defaultId: 0,
    cancelId: 0,
  });
  expect(showMessageBox.mock.calls[0][1]?.detail).toContain("有验证命令在运行。");
  response.resolve({ response: 0, checkboxChecked: false });
  await response.promise;

  expect(host.stopForExit).not.toHaveBeenCalled();
  expect(verification.stopAll).not.toHaveBeenCalled();
  expect(mcp.close).not.toHaveBeenCalled();
  expect(appQuit).not.toHaveBeenCalled();
  expect(() => exit.checkWorkAllowed()).not.toThrow();
});

it("waits for both cleanup operations before quitting and blocks new work during cleanup", async () => {
  const { exit, host, verification, mcp, requestQuit } = setupExit();
  const agentStopped = Promise.withResolvers<void>();
  const verificationStopped = Promise.withResolvers<void>();
  host.stopForExit.mockReturnValue(agentStopped.promise);
  verification.stopAll.mockReturnValue(verificationStopped.promise);
  showMessageBox.mockResolvedValue({ response: 1, checkboxChecked: false });

  expect(requestQuit()).toHaveBeenCalledOnce();
  await vi.waitFor(() => expect(host.stopForExit).toHaveBeenCalledOnce());
  expect(() => exit.checkWorkAllowed()).toThrow("应用正在退出。");
  expect(appQuit).not.toHaveBeenCalled();
  agentStopped.resolve();
  await agentStopped.promise;
  expect(appQuit).not.toHaveBeenCalled();
  verificationStopped.resolve();
  await vi.waitFor(() => expect(appQuit).toHaveBeenCalledOnce());
  expect(mcp.close).toHaveBeenCalledBefore(appQuit);
  expect(requestQuit()).not.toHaveBeenCalled();
});

it("installs an update only after consent and cleanup, leaving a cancelled update ready", async () => {
  const { exit, host, verification, mcp, updater, requestQuit } = setupExit(false, true);
  showMessageBox.mockResolvedValueOnce({ response: 0, checkboxChecked: false });
  await exit.installUpdate();
  expect(updater.install).not.toHaveBeenCalled();
  expect(host.stopForExit).not.toHaveBeenCalled();
  expect(verification.stopAll).not.toHaveBeenCalled();

  showMessageBox.mockResolvedValueOnce({ response: 1, checkboxChecked: false });
  await exit.installUpdate();
  expect(showMessageBox.mock.calls[1][1]).toMatchObject({
    message: "安装更新并重启 Pilot？",
    buttons: ["取消", "停止并更新"],
  });
  expect(verification.stopAll).toHaveBeenCalledBefore(updater.install);
  expect(mcp.close).toHaveBeenCalledBefore(updater.install);
  expect(requestQuit()).not.toHaveBeenCalled();
});

it("keeps the app open when stopping cannot complete", async () => {
  const { exit, host, mcp, log, requestQuit } = setupExit();
  showMessageBox.mockResolvedValueOnce({ response: 1, checkboxChecked: false });
  showMessageBox.mockResolvedValueOnce({ response: 0, checkboxChecked: false });
  host.stopForExit.mockRejectedValueOnce(new Error("write failed"));
  expect(requestQuit()).toHaveBeenCalledOnce();
  await vi.waitFor(() => expect(showMessageBox).toHaveBeenCalledTimes(2));
  expect(log.write).toHaveBeenCalledWith("error", "main", "exit-failed", { errorName: "Error" });
  expect(showMessageBox.mock.calls[1][1]?.type).toBe("error");
  expect(mcp.close).not.toHaveBeenCalled();
  expect(appQuit).not.toHaveBeenCalled();
  await vi.waitFor(() => expect(() => exit.checkWorkAllowed()).not.toThrow());
});
