// @env node
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

import { safeStorage } from "electron";

import type { BackupPreview } from "../../shared/backup";
import type { Locale } from "../../shared/contract";
import { SETTINGS_FILE_NAME, STORAGE_UPGRADE_REQUIRED } from "../constants";
import type { DesktopExit } from "../desktop-exit";
import { SECRET_READ_UNAVAILABLE } from "../settings/constants";
import { parseSettings } from "../settings/schema";
import { decryptProviderKey, decryptSecret } from "../settings/secrets";
import { unpackArchive, writeArchive } from "./archive";
import {
  BACKUP_CHANGED,
  BACKUP_EXPORT_CHANGED,
  BACKUP_EXPORT_FAILED,
  BACKUP_EXPORT_PATH,
  BACKUP_IN_PROGRESS,
  BACKUP_INVALID,
  BACKUP_READ_FAILED,
  BACKUP_RESTART_FAILED,
  BACKUP_RETRY_PREVIEW,
  BACKUP_TOO_LARGE,
  BACKUP_UNSUPPORTED_PATH,
  RESTORE_DIRECTORY,
} from "./constants";
import { checkExportDestination, collectProfileFiles, profileSignature } from "./files";
import {
  inspectProfile,
  prepareRestoredCredentials,
  restoredSettingsJson,
  writeRestoredSettings,
} from "./profile";
import { armRestore, clearRestore } from "./restore";
import type { BackupExportSettings, StagedBackup } from "./types";

function backupError(error: unknown, fallback: string): Error {
  if (
    error instanceof Error &&
    [
      BACKUP_EXPORT_CHANGED,
      BACKUP_EXPORT_PATH,
      BACKUP_INVALID,
      BACKUP_READ_FAILED,
      BACKUP_TOO_LARGE,
      BACKUP_UNSUPPORTED_PATH,
      SECRET_READ_UNAVAILABLE,
      STORAGE_UPGRADE_REQUIRED,
    ].includes(error.message)
  )
    return error;
  return new Error(fallback, { cause: error });
}

async function canReadCredential(value: string, oauth = false): Promise<boolean> {
  if (process.platform === "win32") return Boolean(await decryptProviderKey(value));
  return Boolean(decryptSecret(value, oauth || process.platform === "linux"));
}

export class ProfileBackup {
  private busy = false;
  private staged?: StagedBackup;
  private readonly directory: string;

  constructor(private readonly profile: string) {
    this.directory = join(profile, RESTORE_DIRECTORY);
  }

  private begin(): void {
    if (this.busy) throw new Error(BACKUP_IN_PROGRESS);
    this.busy = true;
  }

  async export(destination: string): Promise<void> {
    this.begin();
    try {
      const target = checkExportDestination(this.profile, destination);
      const files = collectProfileFiles(this.profile);
      const signature = profileSignature(files);
      let settings: BackupExportSettings | undefined;
      if (
        process.platform === "linux" &&
        safeStorage.getSelectedStorageBackend() === "basic_text" &&
        files.some(({ path }) => path === SETTINGS_FILE_NAME)
      ) {
        const path = join(this.profile, SETTINGS_FILE_NAME);
        const stored = parseSettings(readFileSync(path), path);
        if (!stored) throw new Error(BACKUP_INVALID);
        const omitted = await prepareRestoredCredentials(stored, async () => false);
        settings = { contents: Buffer.from(restoredSettingsJson(stored)), omitted };
      }
      await writeArchive(
        this.profile,
        files,
        target,
        () => {
          if (profileSignature(collectProfileFiles(this.profile)) !== signature)
            throw new Error(BACKUP_EXPORT_CHANGED);
        },
        settings,
      );
    } catch (error) {
      throw backupError(error, BACKUP_EXPORT_FAILED);
    } finally {
      this.busy = false;
    }
  }

  async preview(path: string): Promise<BackupPreview> {
    this.begin();
    try {
      this.staged = undefined;
      clearRestore(this.directory);
      const incoming = join(this.directory, "incoming");
      mkdirSync(this.directory, { mode: 0o700 });
      mkdirSync(incoming, { mode: 0o700 });
      const omitted = await unpackArchive(path, incoming);
      const backup = inspectProfile(incoming, collectProfileFiles(incoming), true);
      const current = collectProfileFiles(this.profile);
      const lost =
        backup.settings && (await prepareRestoredCredentials(backup.settings, canReadCredential));
      if (backup.settings) writeRestoredSettings(incoming, backup.settings);
      const preview: BackupPreview = {
        name: basename(path),
        token: randomUUID(),
        current: inspectProfile(this.profile, current, false).contents,
        incoming: backup.contents,
        credentials: {
          providers: omitted.providers + (lost?.providers ?? 0),
          services: omitted.services + (lost?.services ?? 0),
        },
      };
      this.staged = {
        currentSignature: profileSignature(current),
        incomingSignature: profileSignature(collectProfileFiles(incoming)),
        preview,
      };
      return preview;
    } catch (error) {
      try {
        clearRestore(this.directory);
      } catch (cleanupError) {
        throw backupError(cleanupError, BACKUP_READ_FAILED);
      }
      throw backupError(error, BACKUP_READ_FAILED);
    } finally {
      this.busy = false;
    }
  }

  cancel(token: string): void {
    if (this.busy || this.staged?.preview.token !== token) return;
    this.staged = undefined;
    try {
      clearRestore(this.directory);
    } catch (error) {
      throw backupError(error, BACKUP_READ_FAILED);
    }
  }

  async restore(token: string, locale: Locale, exit: DesktopExit): Promise<void> {
    this.begin();
    try {
      const staged = this.staged;
      if (staged?.preview.token !== token) throw new Error(BACKUP_RETRY_PREVIEW);
      await exit.restartForRestore(() => {
        if (profileSignature(collectProfileFiles(this.profile)) !== staged.currentSignature)
          throw new Error(BACKUP_CHANGED);
        const incoming = join(this.directory, "incoming");
        if (profileSignature(collectProfileFiles(incoming)) !== staged.incomingSignature)
          throw new Error(BACKUP_RETRY_PREVIEW);
        try {
          armRestore(this.directory, {
            phase: "pending",
            locale,
            credentials: staged.preview.credentials,
          });
        } catch (error) {
          throw backupError(error, BACKUP_RESTART_FAILED);
        }
        this.staged = undefined;
      });
    } finally {
      this.busy = false;
    }
  }
}
