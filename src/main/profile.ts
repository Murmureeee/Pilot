// @env node
import { existsSync, mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";

import { APP_NAME } from "../shared/constants";
import { LEGACY_USER_DATA_DIRECTORIES } from "./constants";

export function prepareUserDataDirectory(appData: string): string {
  const directory = join(appData, APP_NAME);
  if (existsSync(directory)) return directory;

  for (const name of LEGACY_USER_DATA_DIRECTORIES) {
    const legacy = join(appData, name);
    if (!existsSync(legacy)) continue;
    try {
      renameSync(legacy, directory);
      return directory;
    } catch (error) {
      if (existsSync(directory)) return directory;
      if (!existsSync(legacy)) throw error;
      // An open older process can lock the profile on Windows.
      console.warn("[profile] Profile migration is pending. Using the existing profile.");
      return legacy;
    }
  }

  mkdirSync(directory, { recursive: true });
  return directory;
}
