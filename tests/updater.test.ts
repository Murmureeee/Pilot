// @env node
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";

import {
  autoUpdater,
  type AppUpdater,
  type UpdateCheckResult,
  type UpdateInfo,
} from "electron-updater";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

import { UPDATE_CHECK_INTERVAL_MS, UPDATE_CHECK_STARTUP_DELAY_MS } from "../src/main/constants";
import { DiagnosticLog } from "../src/main/diagnostics";
import { DesktopUpdater } from "../src/main/updater";
import type { UpdateStatus } from "../src/shared/contract";

vi.mock("node:fs", { spy: true });
vi.mock("electron", () => ({ app: { isPackaged: true } }));
vi.mock("electron-updater", async () => {
  const { EventEmitter } = await import("node:events");
  return {
    AppImageUpdater: EventEmitter,
    DebUpdater: EventEmitter,
    autoUpdater: Object.assign(new EventEmitter(), {
      netSession: {},
      checkForUpdates: vi.fn<AppUpdater["checkForUpdates"]>(),
      downloadUpdate: vi.fn<AppUpdater["downloadUpdate"]>(),
    }),
  };
});

const checkForUpdates = vi.mocked(autoUpdater.checkForUpdates);
const downloadUpdate = vi.mocked(autoUpdater.downloadUpdate);

function release(version: string, isUpdateAvailable = true): UpdateCheckResult {
  const updateInfo: UpdateInfo = {
    version,
    files: [],
    path: "pilot-setup.exe",
    sha512: "",
    releaseDate: "2026-11-27T00:00:00.000Z",
  };
  return { isUpdateAvailable, updateInfo, versionInfo: updateInfo };
}

function createUpdater(autoDownload = true): DesktopUpdater {
  return new DesktopUpdater(
    vi.fn<(status: UpdateStatus) => void>(),
    new DiagnosticLog(tmpdir(), "off"),
    vi.fn<() => Promise<void>>().mockResolvedValue(undefined),
    autoDownload,
  );
}

beforeEach(() => {
  vi.stubGlobal(
    "process",
    Object.create(process, {
      platform: { value: "win32" },
      resourcesPath: { value: tmpdir() },
    }),
  );
  vi.mocked(existsSync).mockReturnValue(true);
  checkForUpdates.mockResolvedValue(release("0.7.0"));
});

afterEach(() => {
  autoUpdater.removeAllListeners();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

it("skips periodic checks for a build without an update feed", async () => {
  vi.useFakeTimers();
  vi.mocked(existsSync).mockReturnValue(false);
  const updater = createUpdater();
  updater.startPeriodicChecks();
  expect(vi.getTimerCount()).toBe(0);
  expect(await updater.check()).toEqual({ state: "unavailable" });
  expect(checkForUpdates).not.toHaveBeenCalled();
});

it("checks after startup and refreshes an available version at each interval until stopped", async () => {
  vi.useFakeTimers();
  const updater = createUpdater(false);
  updater.startPeriodicChecks();
  updater.startPeriodicChecks();
  await vi.advanceTimersByTimeAsync(UPDATE_CHECK_STARTUP_DELAY_MS - 1);
  expect(checkForUpdates).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(checkForUpdates).toHaveBeenCalledOnce();
  expect(updater.getStatus()).toEqual({ state: "available", version: "0.7.0" });

  checkForUpdates.mockResolvedValue(release("0.7.1"));
  await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS);
  expect(checkForUpdates).toHaveBeenCalledTimes(2);
  expect(updater.getStatus()).toEqual({ state: "available", version: "0.7.1" });
  expect(downloadUpdate).not.toHaveBeenCalled();

  updater.stopPeriodicChecks();
  await vi.advanceTimersByTimeAsync(UPDATE_CHECK_INTERVAL_MS);
  expect(checkForUpdates).toHaveBeenCalledTimes(2);
});

it("downloads automatically when enabled and preserves the ready installer for explicit restart", async () => {
  const result = release("0.7.0");
  downloadUpdate.mockImplementation(async () => {
    autoUpdater.emit("update-downloaded", {
      ...result.updateInfo,
      downloadedFile: "pilot-setup.exe",
    });
    return ["pilot-setup.exe"];
  });
  const updater = createUpdater();

  expect(await updater.check()).toEqual({ state: "ready", version: "0.7.0" });
  expect(downloadUpdate).toHaveBeenCalledOnce();
  expect(autoUpdater.autoInstallOnAppQuit).toBe(false);
  expect(await updater.check()).toEqual({ state: "ready", version: "0.7.0" });
  expect(checkForUpdates).toHaveBeenCalledOnce();
});

it("applies a preference change during checking and downloads the known version when enabled again", async () => {
  const updater = createUpdater();
  const pending = Promise.withResolvers<UpdateCheckResult>();
  checkForUpdates.mockReturnValue(pending.promise);
  const check = updater.check();
  expect(await updater.check()).toEqual({ state: "checking" });
  updater.setAutoDownload(false);
  pending.resolve(release("0.7.0"));
  expect(await check).toEqual({ state: "available", version: "0.7.0" });
  expect(checkForUpdates).toHaveBeenCalledOnce();
  expect(downloadUpdate).not.toHaveBeenCalled();

  const transfer = Promise.withResolvers<string[]>();
  downloadUpdate.mockReturnValue(transfer.promise);
  updater.setAutoDownload(true);
  updater.setAutoDownload(false);
  expect(updater.getStatus()).toEqual({ state: "downloading", version: "0.7.0", percent: 0 });
  expect(downloadUpdate).toHaveBeenCalledOnce();
  autoUpdater.emit("update-downloaded", {
    ...release("0.7.0").updateInfo,
    downloadedFile: "pilot-setup.exe",
  });
  transfer.resolve(["pilot-setup.exe"]);
  expect(updater.getStatus()).toEqual({ state: "ready", version: "0.7.0" });
});

it("starts one manual download and can check again after a download failure", async () => {
  const updater = createUpdater(false);
  const transfer = Promise.withResolvers<string[]>();
  downloadUpdate.mockReturnValue(transfer.promise);
  await updater.download();
  expect(downloadUpdate).not.toHaveBeenCalled();
  await updater.check();
  const download = updater.download();
  await updater.download();
  expect(downloadUpdate).toHaveBeenCalledOnce();
  autoUpdater.emit("download-progress", {
    total: 100,
    delta: 25,
    transferred: 25,
    percent: 25,
    bytesPerSecond: 25,
  });
  expect(await updater.check()).toEqual({ state: "downloading", version: "0.7.0", percent: 25 });
  const error = new Error("Fixture download failed");
  autoUpdater.emit("error", error);
  transfer.reject(error);
  await download;
  expect(updater.getStatus()).toEqual({ state: "error" });

  checkForUpdates.mockResolvedValue(release("0.6.0", false));
  expect(await updater.check()).toEqual({ state: "current" });
  expect(checkForUpdates).toHaveBeenCalledTimes(2);
});
