// @env all
export interface BackupContents {
  settings: boolean;
  chats: number;
  drafts: number;
  skills: number;
  rules: number;
  plugins: number;
}

export interface BackupCredentials {
  providers: number;
  services: number;
}

export interface BackupPreview {
  token: string;
  name: string;
  current: BackupContents;
  incoming: BackupContents;
  credentials: BackupCredentials;
}

export interface BackupRestoreResult {
  status: "applied" | "rolled-back";
  credentials: BackupCredentials;
}
