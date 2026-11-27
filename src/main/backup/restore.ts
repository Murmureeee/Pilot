// @env node
import { lstatSync, mkdirSync, renameSync, rmSync } from "node:fs";
import { join } from "node:path";

import { DEFAULT_LOCALE } from "../../shared/constants";
import { parseStoredJson, readStoredText, writeStorageAtomic } from "../storage-format";
import { validCredentialCounts } from "./archive";
import { BACKUP_INVALID, BACKUP_ROOTS, RESTORE_DIRECTORY, RESTORE_STATE } from "./constants";
import type { RestorePhase, RestoreResult, RestoreState } from "./types";

function readState(path: string): RestoreState | undefined {
  const text = readStoredText(path);
  if (text === undefined) return;
  const state = parseStoredJson(text);
  if (
    state &&
    typeof state === "object" &&
    "phase" in state &&
    (state.phase === "pending" ||
      state.phase === "saving" ||
      state.phase === "replacing" ||
      state.phase === "rolling-back" ||
      state.phase === "applied" ||
      state.phase === "rolled-back") &&
    "locale" in state &&
    (state.locale === "zh" || state.locale === "en") &&
    "credentials" in state &&
    validCredentialCounts(state.credentials)
  )
    return { phase: state.phase, locale: state.locale, credentials: state.credentials };
  throw new Error(BACKUP_INVALID);
}

export function clearRestore(directory: string): void {
  const stat = lstatSync(directory, { throwIfNoEntry: false });
  if (!stat) return;
  // A profile junction is resolved before startup. Never recurse through a replacement link.
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error(BACKUP_INVALID);
  rmSync(directory, { recursive: true, maxRetries: 3, retryDelay: 50 });
}

export function armRestore(directory: string, state: RestoreState): void {
  writeStorageAtomic(join(directory, RESTORE_STATE), JSON.stringify(state));
}

function moveRoots(from: string, to: string): void {
  for (const root of BACKUP_ROOTS) {
    const source = join(from, root);
    if (!lstatSync(source, { throwIfNoEntry: false })) continue;
    const destination = join(to, root);
    if (lstatSync(destination, { throwIfNoEntry: false })) throw new Error(BACKUP_INVALID);
    renameSync(source, destination);
  }
}

export function applyPendingBackup(profile: string): RestoreResult | undefined {
  const directory = join(profile, RESTORE_DIRECTORY);
  const incoming = join(directory, "incoming");
  const original = join(directory, "original");
  let state: RestoreState | undefined;
  try {
    const stage = lstatSync(directory, { throwIfNoEntry: false });
    if (!stage) return;
    if (!stage.isDirectory() || stage.isSymbolicLink()) throw new Error(BACKUP_INVALID);
    state = readState(join(directory, RESTORE_STATE));
    if (!state) {
      clearRestore(directory);
      return;
    }
    const stateAfter = (phase: RestorePhase): void => {
      const next = { ...state!, phase };
      armRestore(directory, next);
      state = next;
    };
    if (state.phase === "pending") {
      try {
        if (!lstatSync(incoming, { throwIfNoEntry: false })?.isDirectory())
          throw new Error(BACKUP_INVALID);
        stateAfter("saving");
        mkdirSync(original, { mode: 0o700 });
        moveRoots(profile, original);
        stateAfter("replacing");
        moveRoots(incoming, profile);
        stateAfter("applied");
      } catch {
        // The saved phase identifies which renames can be reversed after a failure.
      }
    }
    state = readState(join(directory, RESTORE_STATE))!;
    if (state.phase === "replacing") moveRoots(profile, incoming);
    if (state.phase !== "applied" && state.phase !== "rolled-back") {
      stateAfter("rolling-back");
      if (lstatSync(original, { throwIfNoEntry: false })) moveRoots(original, profile);
      stateAfter("rolled-back");
    }
    const result: RestoreResult = {
      status: state.phase === "applied" ? "applied" : "rolled-back",
      locale: state.locale,
      credentials: state.credentials,
    };
    // The data already belongs to the live profile. Retry any failed cleanup at the next launch.
    try {
      clearRestore(directory);
    } catch {
      console.warn("[backup] Could not remove the restore staging directory");
    }
    return result;
  } catch {
    return {
      status: "blocked",
      locale: state?.locale ?? DEFAULT_LOCALE,
      credentials: { providers: 0, services: 0 },
    };
  }
}
