// @env node
import { dialog, type BrowserWindow, type RenderProcessGoneDetails } from "electron";
import { APP_NAME } from "../shared/constants";
import { RENDERER_RECOVERY_MESSAGES } from "./constants";
import { errorDetails, type DiagnosticLog } from "./diagnostics";
import { getRendererLocale } from "./ipc/transport";

export function registerWindowRecovery(
  win: BrowserWindow,
  log: Pick<DiagnosticLog, "write">,
): void {
  const contents = win.webContents;
  let pending: { unresponsive: boolean; controller: AbortController } | undefined;
  let terminatingForReload = false;

  function cancelPrompt(): void {
    const current = pending;
    pending = undefined;
    current?.controller.abort();
  }

  function reload(reason: RenderProcessGoneDetails["reason"] | "unresponsive"): void {
    if (win.isDestroyed() || contents.isDestroyed()) return;
    try {
      log.write("info", "renderer", "reload", { reason });
      contents.reload();
    } catch (error) {
      log.write("error", "renderer", "recovery-failed", errorDetails(error));
    }
  }

  async function promptReload(
    reason: RenderProcessGoneDetails["reason"] | "unresponsive",
  ): Promise<void> {
    if (pending || win.isDestroyed() || contents.isDestroyed()) return;
    const unresponsive = reason === "unresponsive";
    const controller = new AbortController();
    const current = { unresponsive, controller };
    pending = current;
    const copy = RENDERER_RECOVERY_MESSAGES[getRendererLocale(contents)];
    const message = unresponsive
      ? copy.unresponsive
      : reason === "oom"
        ? copy.outOfMemory
        : copy.crashed;

    try {
      await dialog.showMessageBox(win, {
        title: APP_NAME,
        type: unresponsive ? "warning" : "error",
        message,
        detail: copy.detail,
        buttons: [copy.reload],
        defaultId: 0,
        noLink: true,
        signal: controller.signal,
      });
      if (controller.signal.aborted || win.isDestroyed() || contents.isDestroyed()) return;

      // Chromium can leave a reload queued behind an unresponsive renderer.
      if (unresponsive && !contents.isCrashed()) {
        terminatingForReload = true;
        contents.forcefullyCrashRenderer();
        return;
      }
      reload(reason);
    } catch (error) {
      terminatingForReload = false;
      log.write("error", "renderer", "recovery-failed", errorDetails(error));
    } finally {
      if (pending === current) pending = undefined;
    }
  }

  contents.on("render-process-gone", (_event, { reason, exitCode }) => {
    const reloadRequested = terminatingForReload;
    const expected = reason === "clean-exit" || reloadRequested;
    terminatingForReload = false;
    log.write(expected ? "debug" : "error", "renderer", "process-gone", { reason, code: exitCode });
    if (reloadRequested) {
      // Reload after the old renderer has exited and Chromium has cleared its navigation state.
      setImmediate(() => reload("unresponsive"));
      return;
    }
    if (expected) return;
    console.error(`[renderer] process gone: ${reason}`);
    void promptReload(reason);
  });
  contents.on("unresponsive", () => {
    if (pending || contents.isCrashed()) return;
    log.write("warn", "renderer", "unresponsive");
    void promptReload("unresponsive");
  });
  contents.on("responsive", () => {
    if (pending?.unresponsive && !contents.isCrashed()) cancelPrompt();
  });
  contents.once("destroyed", cancelPrompt);
}
