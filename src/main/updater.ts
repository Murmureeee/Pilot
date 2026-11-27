// @env node
import { constants, existsSync } from "node:fs";
import { chmod, copyFile, mkdtemp, realpath, rename, rmdir, stat, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";

import { app, autoUpdater as nativeUpdater, shell } from "electron";
import { AppImageUpdater, DebUpdater, autoUpdater, type AppUpdater } from "electron-updater";

import type { UpdateStatus } from "@shared/contract";

import {
  UPDATE_CHECK_INTERVAL_MS,
  UPDATE_CHECK_STARTUP_DELAY_MS,
  UPDATE_NOT_READY_MESSAGE,
} from "./constants";
import { errorDetails, type DiagnosticLog } from "./diagnostics";
import type { DesktopNetwork } from "./types";

async function replaceAppImage(installed: string, downloaded: string): Promise<string> {
  const target = await realpath(installed);
  const original = await stat(target);
  if (!original.isFile()) throw new Error("The current AppImage is not a regular file");
  // Stage the new image beside the running file so the replacement is atomic across cache locations.
  const staging = await mkdtemp(join(dirname(target), ".pilot-update-"));
  const next = join(staging, "Pilot.AppImage");
  try {
    await copyFile(downloaded, next, constants.COPYFILE_EXCL);
    await chmod(next, original.mode & 0o777);
    await rename(next, target);
  } finally {
    await unlink(next).catch(() => {});
    await rmdir(staging).catch(() => {});
  }
  return target;
}

async function prepareMacInstallation(): Promise<void> {
  // Squirrel checks the replacement app's signature when it reads the ZIP from MacUpdater.
  const { promise, resolve, reject } = Promise.withResolvers<void>();
  const ready = (): void => resolve();
  const unavailable = (): void => reject(new Error(UPDATE_NOT_READY_MESSAGE));
  nativeUpdater.once("update-downloaded", ready);
  nativeUpdater.once("error", reject);
  nativeUpdater.once("update-not-available", unavailable);
  try {
    nativeUpdater.checkForUpdates();
    await promise;
  } finally {
    nativeUpdater.removeListener("update-downloaded", ready);
    nativeUpdater.removeListener("error", reject);
    nativeUpdater.removeListener("update-not-available", unavailable);
  }
}

export class DesktopUpdater {
  private status: UpdateStatus = { state: "unavailable" };
  private readonly updater?: AppUpdater;
  private readonly appImagePath?: string;
  private downloadedFile?: string;
  private checkTimer?: NodeJS.Timeout;

  constructor(
    private readonly publish: (status: UpdateStatus) => void,
    private readonly log: DiagnosticLog,
    private readonly configureProxy: DesktopNetwork["configureProxy"],
    private autoDownload: boolean,
  ) {
    if (
      !app.isPackaged ||
      (process.platform !== "win32" &&
        process.platform !== "linux" &&
        process.platform !== "darwin") ||
      !existsSync(join(process.resourcesPath, "app-update.yml"))
    ) {
      log.write("debug", "updater", "unavailable");
      return;
    }

    const image = process.platform === "linux" ? process.env.APPIMAGE : undefined;
    this.appImagePath = image && isAbsolute(image) ? image : undefined;
    // Both Linux targets share build resources. The launched AppImage identifies itself via APPIMAGE.
    const updater = this.appImagePath ? new AppImageUpdater() : autoUpdater;
    const deb = process.platform === "linux" && updater instanceof DebUpdater;
    if (process.platform === "linux" && !this.appImagePath && !deb) {
      log.write("debug", "updater", "unavailable");
      return;
    }

    this.updater = updater;
    this.status = { state: "idle" };
    log.write("info", "updater", "idle");
    // Apply the current preference after each check, including changes made while it was in flight.
    updater.autoDownload = false;
    updater.autoInstallOnAppQuit = false;
    updater.disableWebInstaller = true;
    updater.on("download-progress", (progress) => {
      const status = this.status;
      const percent = Math.max(0, Math.min(100, Math.round(progress.percent)));
      if (
        status.state === "downloading" &&
        Number.isFinite(percent) &&
        percent !== status.percent
      ) {
        this.setStatus({ ...status, percent });
      }
    });
    updater.on("update-downloaded", (info) => {
      this.downloadedFile = info.downloadedFile;
      this.setStatus({ state: deb ? "package-ready" : "ready", version: info.version });
    });
    updater.on("error", (error) => {
      // Checks and downloads report errors through their promises. Installation uses this event.
      if (process.platform !== "darwin" && this.status.state === "installing") {
        this.setStatus({ state: "error" }, error);
      }
    });
  }

  private setStatus(status: UpdateStatus, error?: unknown): void {
    if (this.status.state !== status.state) {
      this.log.write(
        status.state === "error" ? "error" : "info",
        "updater",
        status.state,
        errorDetails(error),
      );
    }
    this.status = status;
    this.publish(status);
  }

  getStatus(): UpdateStatus {
    return this.status;
  }

  startPeriodicChecks(): void {
    if (this.updater && !this.checkTimer) this.scheduleCheck(UPDATE_CHECK_STARTUP_DELAY_MS);
  }

  stopPeriodicChecks(): void {
    clearTimeout(this.checkTimer);
    this.checkTimer = undefined;
  }

  private scheduleCheck(delay: number): void {
    this.checkTimer = setTimeout(() => {
      this.scheduleCheck(UPDATE_CHECK_INTERVAL_MS);
      void this.check();
    }, delay).unref();
  }

  setAutoDownload(enabled: boolean): void {
    if (this.autoDownload === enabled) return;
    this.autoDownload = enabled;
    if (enabled) void this.download();
  }

  async check(): Promise<UpdateStatus> {
    const updater = this.updater;
    const { state } = this.status;
    if (
      !updater ||
      (state !== "idle" && state !== "current" && state !== "available" && state !== "error")
    ) {
      return this.status;
    }
    this.downloadedFile = undefined;
    this.setStatus({ state: "checking" });
    try {
      await this.configureProxy(updater.netSession);
      const result = await updater.checkForUpdates();
      if (!result) this.setStatus({ state: "unavailable" });
      else if (!result.isUpdateAvailable) this.setStatus({ state: "current" });
      else if (this.autoDownload) void this.downloadVersion(updater, result.updateInfo.version);
      else this.setStatus({ state: "available", version: result.updateInfo.version });
    } catch (error) {
      this.setStatus({ state: "error" }, error);
    }
    return this.status;
  }

  async download(): Promise<void> {
    const status = this.status;
    if (this.updater && status.state === "available") {
      await this.downloadVersion(this.updater, status.version);
    }
  }

  private async downloadVersion(updater: AppUpdater, version: string): Promise<void> {
    this.setStatus({ state: "downloading", version, percent: 0 });
    try {
      await updater.downloadUpdate();
    } catch (error) {
      this.setStatus({ state: "error" }, error);
    }
  }

  async showPackage(): Promise<void> {
    if (this.status.state !== "package-ready" || !this.downloadedFile)
      throw new Error(UPDATE_NOT_READY_MESSAGE);
    if (!existsSync(this.downloadedFile)) {
      this.setStatus({ state: "error", reason: "package-missing" });
      return;
    }
    const failure = await shell.openPath(dirname(this.downloadedFile));
    if (failure) throw new Error(failure);
  }

  async install(allowQuit: () => void): Promise<boolean> {
    if (this.status.state !== "ready" || !this.updater) throw new Error(UPDATE_NOT_READY_MESSAGE);
    this.setStatus({ state: "installing", version: this.status.version });
    if (this.appImagePath) {
      try {
        if (!this.downloadedFile) throw new Error(UPDATE_NOT_READY_MESSAGE);
        const executable = await replaceAppImage(this.appImagePath, this.downloadedFile);
        app.relaunch({ execPath: executable, args: process.argv.slice(1) });
        allowQuit();
        app.quit();
      } catch (error) {
        this.setStatus({ state: "error", reason: "appimage-install" }, error);
        return false;
      }
    } else if (process.platform === "darwin") {
      try {
        await prepareMacInstallation();
        allowQuit();
        nativeUpdater.quitAndInstall();
      } catch (error) {
        this.setStatus({ state: "error" }, error);
        return false;
      }
    } else {
      allowQuit();
      this.updater.quitAndInstall(true, true);
    }
    return this.getStatus().state === "installing";
  }
}
