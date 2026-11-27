// @env node
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { BackupContents, BackupCredentials } from "../../shared/backup";
import { headerVersion, sessionEntries, transcriptPrefix } from "../agent-host/session-format";
import { parseNewChatDrafts, parseSessionIndex } from "../agent-host/session-index";
import {
  NEW_CHAT_DRAFTS_FILE,
  SESSION_DRAFT_EXTENSION,
  SESSION_DRAFT_IMAGES_EXTENSION,
  SESSION_TRANSCRIPT_EXTENSION,
  SETTINGS_FILE_NAME,
  SETTINGS_FORMAT_VERSION,
} from "../constants";
import { parseSettings } from "../settings/schema";
import type { Settings } from "../settings/types";
import {
  NewerFormatError,
  parseStoredJson,
  readStoredText,
  writeStorageAtomic,
} from "../storage-format";
import { BACKUP_INVALID } from "./constants";
import type { ProfileFile } from "./types";

export function inspectProfile(
  directory: string,
  files: readonly ProfileFile[],
  strict: boolean,
): { contents: BackupContents; settings: Settings | undefined } {
  const paths = new Set(files.map(({ path }) => path));
  const settingsFile = join(directory, SETTINGS_FILE_NAME);
  const settings = paths.has(SETTINGS_FILE_NAME)
    ? parseSettings(readFileSync(settingsFile), settingsFile)
    : undefined;
  if (strict && paths.has(SETTINGS_FILE_NAME) && !settings) throw new Error(BACKUP_INVALID);
  const indexFile = join(directory, "sessions", "index.json");
  const indexText = readStoredText(indexFile);
  const parsed = indexText === undefined ? undefined : parseSessionIndex(indexText, indexFile);
  if (strict && parsed?.damaged) throw new Error(BACKUP_INVALID);
  const chats = new Set(parsed?.index.sessions.map(({ id }) => id));
  const drafts = new Set<string>();
  let skills = 0;
  for (const file of paths) {
    if (/^skills\/[^/]+\/SKILL\.md$/.test(file)) skills++;
    const [root, name, nested] = file.split("/");
    if (root !== "sessions" || !name || nested) continue;
    const target = join(directory, root, name);
    if (name.endsWith(SESSION_TRANSCRIPT_EXTENSION)) {
      try {
        headerVersion(transcriptPrefix(target), target);
      } catch (error) {
        if (error instanceof NewerFormatError) throw error;
        if (strict) throw new Error(BACKUP_INVALID, { cause: error });
      }
      chats.add(name.slice(0, -SESSION_TRANSCRIPT_EXTENSION.length));
    } else if (
      name === NEW_CHAT_DRAFTS_FILE ||
      name.endsWith(SESSION_DRAFT_EXTENSION) ||
      name.endsWith(SESSION_DRAFT_IMAGES_EXTENSION)
    ) {
      const entries = sessionEntries(parseStoredJson(readStoredText(target)), target);
      if (!Array.isArray(entries)) {
        if (strict) throw new Error(BACKUP_INVALID);
        continue;
      }
      if (name === NEW_CHAT_DRAFTS_FILE) {
        for (const draft of parseNewChatDrafts(entries)) drafts.add(draft.id);
      } else if (entries.length) {
        const extension = name.endsWith(SESSION_DRAFT_EXTENSION)
          ? SESSION_DRAFT_EXTENSION
          : SESSION_DRAFT_IMAGES_EXTENSION;
        drafts.add(name.slice(0, -extension.length));
      }
    }
  }
  return {
    contents: {
      settings: paths.has(SETTINGS_FILE_NAME),
      chats: chats.size,
      drafts: drafts.size,
      skills,
      rules: settings?.toolRules?.length ?? 0,
      plugins: settings?.importedPlugins?.length ?? 0,
    },
    settings,
  };
}

export async function prepareRestoredCredentials(
  settings: Settings,
  canRead: (value: string, oauth?: boolean) => Promise<boolean>,
): Promise<BackupCredentials> {
  let providers = 0;
  const services = new Set<string>();
  for (const provider of settings.providers) {
    if (provider.apiKey && !(await canRead(provider.apiKey))) {
      delete provider.apiKey;
      providers++;
    }
  }
  for (const server of settings.mcpServers ?? []) {
    for (const field of ["encryptedEnv", "encryptedHeaders", "encryptedImport"] as const) {
      const value = server[field];
      if (value && !(await canRead(value))) {
        delete server[field];
        server.enabled = false;
        services.add(server.id);
      }
    }
  }
  for (const [id, credential] of Object.entries(settings.mcpOAuth ?? {})) {
    if (services.has(id) || !(await canRead(credential.encryptedState, true))) {
      delete settings.mcpOAuth?.[id];
      services.add(id);
    }
  }
  return { providers, services: services.size };
}

export function restoredSettingsJson(settings: Settings): string {
  const { recoveredFrom: _previousPath, ...portable } = settings;
  return JSON.stringify({ ...portable, formatVersion: SETTINGS_FORMAT_VERSION }, null, 2);
}

export function writeRestoredSettings(directory: string, settings: Settings): void {
  writeStorageAtomic(join(directory, SETTINGS_FILE_NAME), restoredSettingsJson(settings), 0o600);
}
