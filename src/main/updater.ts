// @env node
import { constants, existsSync } from "node:fs";
import { chmod, copyFile, mkdtemp, realpath, rename, rmdir, stat, unlink } from "node:fs/promises";
import { dirname, isAbsolute, join } from "node:path";

import { app, shell } from "electron";
import { AppImageUpdater, DebUpdater, autoUpdater, type AppUpdater } from "electron-updater";

import type { UpdateStatus } from "@shared/contract";

import { UPDATE_NOT_READY_MESSAGE } from "./constants";
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

export class DesktopUpdater {
  private status: UpdateStatus = { state: "unavailable" };
  private readonly updater?: AppUpdater;
  private readonly appImagePath?: string;
  private downloadedFile?: string;

  constructor(
    private readonly publish: (status: UpdateStatus) => void,
    private readonly log: DiagnosticLog,
    private readonly configureProxy: DesktopNetwork["configureProxy"],
  ) {
    if (
      !app.isPackaged ||
      (process.platform !== "win32" && process.platform !== "linux") ||
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
    updater.autoDownload = true;
    updater.autoInstallOnAppQuit = false;
    updater.disableWebInstaller = true;
    updater.on("update-not-available", () => this.setStatus({ state: "current" }));
    updater.on("update-available", (info) =>
      this.setStatus({ state: "downloading", version: info.version, percent: 0 }),
    );
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
    updater.on("error", (error) => this.setStatus({ state: "error" }, error));
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

  async check(): Promise<UpdateStatus> {
    const updater = this.updater;
    const { state } = this.status;
    if (!updater || (state !== "idle" && state !== "current" && state !== "error"))
      return this.status;
    this.downloadedFile = undefined;
    this.setStatus({ state: "checking" });
    try {
      await this.configureProxy(updater.netSession);
      const result = await updater.checkForUpdates();
      if (!result) this.setStatus({ state: "unavailable" });
      // Download errors emit the same updater error event as check failures.
      void result?.downloadPromise?.catch(() => {});
    } catch (error) {
      this.setStatus({ state: "error" }, error);
    }
    return this.status;
  }

  showPackage(): void {
    if (this.status.state !== "package-ready" || !this.downloadedFile)
      throw new Error(UPDATE_NOT_READY_MESSAGE);
    if (!existsSync(this.downloadedFile)) {
      this.setStatus({ state: "error", reason: "package-missing" });
      return;
    }
    shell.showItemInFolder(this.downloadedFile);
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
    } else {
      allowQuit();
      this.updater.quitAndInstall(true, true);
    }
    return this.getStatus().state === "installing";
  }
}
