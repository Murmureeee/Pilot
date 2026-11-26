// @env node
import { isAbsolute, resolve } from "node:path";

import type { ProjectEntry } from "./types";

export function applicationArguments(argv: readonly string[], defaultApp: boolean): string[] {
  if (!defaultApp) return argv.slice(1);
  // Electron can put switches such as --inspect before the development app path.
  const entry = argv.findIndex((argument, index) => index > 0 && !argument.startsWith("-"));
  return entry < 0 ? [] : argv.slice(entry + 1);
}

export function projectEntryArgument(
  args: readonly string[],
  workingDirectory: string,
): ProjectEntry {
  let folder: string | undefined;
  for (let index = 0; index < args.length; index++) {
    let argument = args[index]!;
    if (argument === "--") {
      if (args.length !== index + 2 || folder !== undefined) return null;
      argument = args[++index]!;
    } else if (argument === "--open-project") {
      argument = args[++index] ?? "";
    } else if (argument.startsWith("--open-project=")) {
      argument = argument.slice("--open-project=".length);
    } else if (argument.startsWith("-")) {
      continue;
    }
    if (folder !== undefined || !argument.trim() || argument.includes("\0")) return null;
    folder = argument;
  }
  return folder === undefined ? undefined : resolve(workingDirectory, folder);
}

export function projectEntryFromInstance(data: unknown): ProjectEntry {
  if (!data || typeof data !== "object" || !("project" in data)) return;
  const folder = data.project;
  if (folder === null) return null;
  if (typeof folder === "string" && !folder.includes("\0") && isAbsolute(folder)) return folder;
}
