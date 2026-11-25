// @env node
import {
  app,
  dialog,
  type BrowserWindow,
  type MessageBoxOptions,
  type MessageBoxReturnValue,
} from "electron";

import { APP_NAME, DEFAULT_LOCALE } from "../shared/constants";
import { APP_EXITING_MESSAGE, NATIVE_EXIT_MESSAGES, UPDATE_NOT_READY_MESSAGE } from "./constants";
import { errorDetails } from "./diagnostics";
import { getRendererLocale } from "./ipc/transport";
import type { DesktopExitDependencies, ExitAction, ExitStage } from "./types";

async function showMessage(
  window: BrowserWindow | undefined,
  options: MessageBoxOptions,
): Promise<MessageBoxReturnValue> {
  return window && !window.isDestroyed()
    ? dialog.showMessageBox(window, options)
    : dialog.showMessageBox(options);
}

export class DesktopExit {
  private stage: ExitStage = "idle";

  constructor(private readonly deps: DesktopExitDependencies) {
    app.on("before-quit", (event) => {
      if (this.stage === "exiting") return;
      event.preventDefault();
      void this.request("quit", this.deps.getWindow());
    });
  }

  watchWindow(window: BrowserWindow): void {
    window.on("close", (event) => {
      if (this.stage === "exiting" || this.stage === "closing-window") return;
      event.preventDefault();
      void this.request(process.platform === "darwin" ? "closeWindow" : "quit", window);
    });
  }

  isExiting(): boolean {
    return this.stage === "exiting";
  }

  checkWorkAllowed(): void {
    if (this.stage !== "idle" && this.stage !== "confirming") {
      throw new Error(APP_EXITING_MESSAGE);
    }
  }

  async installUpdate(): Promise<void> {
    if (this.deps.updater.getStatus().state !== "ready") throw new Error(UPDATE_NOT_READY_MESSAGE);
    await this.request("update", this.deps.getWindow());
  }

  private async request(action: ExitAction, window: BrowserWindow | undefined): Promise<void> {
    if (this.stage !== "idle") return;
    this.stage = "confirming";
    const locale =
      window && !window.isDestroyed() ? getRendererLocale(window.webContents) : DEFAULT_LOCALE;
    const copy = NATIVE_EXIT_MESSAGES[locale];
    const agentActive = this.deps.host.hasActiveRun();
    const verificationActive = this.deps.verification.hasActiveRuns();

    try {
      if (agentActive || verificationActive) {
        const { response } = await showMessage(window, {
          title: APP_NAME,
          type: "warning",
          message: copy[action].title,
          detail: [agentActive && copy.agent, verificationActive && copy.verification, copy.detail]
            .filter(Boolean)
            .join("\n"),
          buttons: [copy.cancel, copy[action].accept],
          defaultId: 0,
          cancelId: 0,
          noLink: true,
        });
        if (response !== 1) return;
      }
      if (action === "update" && this.deps.updater.getStatus().state !== "ready") return;

      this.stage = "stopping";
      const stopped = await Promise.allSettled([
        this.deps.host.stopForExit(),
        this.deps.verification.stopAll(),
      ]);
      for (const result of stopped) {
        if (result.status === "rejected") throw result.reason;
      }

      if (action === "closeWindow") {
        this.stage = "closing-window";
        if (window && !window.isDestroyed()) window.close();
        return;
      }

      await this.deps.mcp.close();
      if (action === "update") {
        const installing = await this.deps.updater.install(() => {
          this.stage = "exiting";
        });
        if (!installing) this.stage = "idle";
      } else {
        this.stage = "exiting";
        app.quit();
      }
    } catch (error) {
      this.stage = "stopping";
      this.deps.log.write("error", "main", "exit-failed", errorDetails(error));
      await showMessage(window, {
        title: APP_NAME,
        type: "error",
        message: copy.failed,
        detail: copy.failedDetail,
        buttons: [copy.back],
      }).catch(() => {});
    } finally {
      if (this.stage !== "exiting") this.stage = "idle";
    }
  }
}
