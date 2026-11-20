// @env node
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import type { ProjectInstructionSource } from "@shared/contract";
import { createToolPathResolver } from "../workspace/paths";

const INSTRUCTIONS_FILE = "AGENTS.md";

export function loadProjectInstructions(directory?: string): {
  source: ProjectInstructionSource;
  body?: string;
} {
  if (!directory) return { source: { status: "unlinked" } };
  const expectedPath = join(directory, INSTRUCTIONS_FILE);
  try {
    const path = createToolPathResolver(directory)(INSTRUCTIONS_FILE);
    const stat = statSync(path, { throwIfNoEntry: false });
    if (!stat) return { source: { status: "missing", path: expectedPath } };
    if (stat.isFile()) {
      const body = new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(path)).trim();
      return body
        ? { source: { status: "loaded", path }, body }
        : { source: { status: "empty", path } };
    }
  } catch {
    // A project can be moved or contain an unreadable file between requests.
  }
  return { source: { status: "unavailable", path: expectedPath } };
}
