// @env node
import { existsSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";
import { autoUpdater } from "electron-updater";
import type { UpdateStatus } from "@shared/contract";

export class DesktopUpdater {
  private status: UpdateStatus = { state: "unavailable" };

  constructor(private readonly publish: (status: UpdateStatus) => void) {
    if (
      !app.isPackaged ||
      process.platform !== "win32" ||
      !existsSync(join(process.resourcesPath, "app-update.yml"))
    ) {
      return;
    }

    this.status = { state: "idle" };
    autoUpdater.autoDownload = true;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.disableWebInstaller = true;
    autoUpdater.on("update-not-available", () => this.setStatus({ state: "current" }));
    autoUpdater.on("update-available", (info) =>
      this.setStatus({ state: "downloading", version: info.version, percent: 0 }),
    );
    autoUpdater.on("download-progress", (progress) => {
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
    autoUpdater.on("update-downloaded", (info) =>
      this.setStatus({ state: "ready", version: info.version }),
    );
    autoUpdater.on("error", () => this.setStatus({ state: "error" }));
  }

  private setStatus(status: UpdateStatus): void {
    this.status = status;
    this.publish(status);
  }

  getStatus(): UpdateStatus {
    return this.status;
  }

  async check(): Promise<UpdateStatus> {
    const { state } = this.status;
    if (state !== "idle" && state !== "current" && state !== "error") return this.status;
    this.setStatus({ state: "checking" });
    try {
      const result = await autoUpdater.checkForUpdates();
      if (!result) this.setStatus({ state: "unavailable" });
      // Download errors emit the same updater error event as check failures.
      void result?.downloadPromise?.catch(() => {});
    } catch {
      this.setStatus({ state: "error" });
    }
    return this.status;
  }

  install(): void {
    if (this.status.state !== "ready") throw new Error("没有已下载的更新。");
    this.setStatus({ state: "installing", version: this.status.version });
    autoUpdater.quitAndInstall(true, false);
  }
}
