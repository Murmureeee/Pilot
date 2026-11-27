// @env node
import type { BackupCredentials, BackupPreview } from "../../shared/backup";
import type { Locale } from "../../shared/contract";

export interface ArchiveEntry {
  path: string;
  size: number;
  mode: number;
}

export interface BackupExportSettings {
  contents: Buffer;
  omitted: BackupCredentials;
}

export interface ProfileFile extends ArchiveEntry {
  modified: number;
  changed: number;
  inode: number;
}

export interface StagedBackup {
  currentSignature: string;
  incomingSignature: string;
  preview: BackupPreview;
}

export type RestorePhase =
  | "pending"
  | "saving"
  | "replacing"
  | "rolling-back"
  | "applied"
  | "rolled-back";

export interface RestoreState {
  phase: RestorePhase;
  locale: Locale;
  credentials: BackupCredentials;
}

export interface RestoreResult {
  status: "applied" | "rolled-back" | "blocked";
  locale: Locale;
  credentials: BackupCredentials;
}
