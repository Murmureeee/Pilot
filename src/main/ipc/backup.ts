// @env node
import { BrowserWindow, dialog, type OpenDialogOptions } from "electron";

import { IPC } from "../../shared/contract";
import { BACKUP_COPY, BACKUP_EXTENSION } from "../backup/constants";
import { getRendererLocale, handle } from "./transport";
import type { IpcContext } from "./types";

export function registerBackupRoutes({
  backup,
  backupResult,
  exit,
}: Pick<IpcContext, "backup" | "backupResult" | "exit">): void {
  const filters = [{ name: "Pilot Backup", extensions: [BACKUP_EXTENSION] }];
  handle(IPC.appExportBackup, async ({ sender }) => {
    exit.checkWorkAllowed();
    const window = BrowserWindow.fromWebContents(sender);
    const options = {
      title: BACKUP_COPY[getRendererLocale(sender)].export,
      defaultPath: "pilot-" + new Date().toISOString().slice(0, 10) + "." + BACKUP_EXTENSION,
      filters,
    };
    const result = window
      ? await dialog.showSaveDialog(window, options)
      : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return false;
    exit.checkWorkAllowed();
    await backup.export(result.filePath);
    return true;
  });
  handle(IPC.appPreviewBackup, async ({ sender }) => {
    exit.checkWorkAllowed();
    const window = BrowserWindow.fromWebContents(sender);
    const options: OpenDialogOptions = {
      title: BACKUP_COPY[getRendererLocale(sender)].open,
      properties: ["openFile"],
      filters,
    };
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || !result.filePaths[0]) return null;
    exit.checkWorkAllowed();
    return backup.preview(result.filePaths[0]);
  });
  handle(IPC.appCancelBackup, (_event, token) => backup.cancel(token));
  handle(IPC.appRestoreBackup, ({ sender }, token) =>
    backup.restore(token, getRendererLocale(sender), exit),
  );
  handle(IPC.appBackupResult, () => backupResult);
}
