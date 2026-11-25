// @env node
import { readFileSync, statSync } from "node:fs";
import { basename, dirname, join, relative, sep } from "node:path";

import type { AgentMessage } from "@earendil-works/pi-agent-core";

import type { ComposerDraft, ScopedProjectInstructionSource } from "@shared/contract";

import { createToolPathResolver } from "../workspace/paths";
import { PROJECT_INSTRUCTION_FILES } from "./constants";
import { pathOfArgs } from "./tools";
import type { ResolveToolPath } from "./tools/types";
import type { ProjectInstruction, ReferencedUserMessage, ScopedProjectInstruction } from "./types";

function readInstructions(
  resolve: ResolveToolPath,
  directory: string,
): Omit<ScopedProjectInstruction, "directory"> {
  for (const filename of PROJECT_INSTRUCTION_FILES) {
    const path = join(directory, filename);
    try {
      const file = resolve(path);
      const stat = statSync(file, { throwIfNoEntry: false });
      if (!stat) continue;
      if (stat.isFile()) {
        const body = new TextDecoder("utf-8", { fatal: true }).decode(readFileSync(file)).trim();
        return body
          ? { source: { status: "loaded", path }, body }
          : { source: { status: "empty", path } };
      }
    } catch {
      // A present but unreadable file still takes precedence over the fallback.
    }
    return { source: { status: "unavailable", path } };
  }
  return { source: { status: "missing", path: join(directory, PROJECT_INSTRUCTION_FILES[0]) } };
}

export function loadProjectInstructions(directory?: string): ProjectInstruction {
  return directory
    ? readInstructions(createToolPathResolver(directory), directory)
    : { source: { status: "unlinked" } };
}

export class ProjectInstructionScopes {
  private readonly directories = new Map<string, ScopedProjectInstruction | undefined>();
  private readonly resolve?: ResolveToolPath;

  constructor(private readonly root?: string) {
    if (root) this.resolve = createToolPathResolver(root);
  }

  includeTool(name: string, args: unknown): ScopedProjectInstruction[] {
    const path = pathOfArgs(args);
    if (!path) return [];
    switch (name) {
      case "glob":
        return this.include(path, true);
      case "grep":
        return this.include(path);
      case "read_file":
      case "write_file":
      case "edit_file":
        return this.include(path, false);
      default:
        return [];
    }
  }

  includeMessage(message: AgentMessage): void {
    if (message.role !== "user") return;
    const parts = (message as ReferencedUserMessage).pilotReference?.parts ?? [];
    for (const part of parts) {
      if (part.type === "mention" && part.kind !== "skill" && part.workingDirectory === this.root)
        this.include(part.id, part.kind === "directory");
    }
  }

  includeHistory(messages: readonly AgentMessage[]): void {
    for (const message of messages) {
      this.includeMessage(message);
      if (message.role === "assistant") {
        for (const part of message.content) {
          if (part.type === "toolCall") this.includeTool(part.name, part.arguments);
        }
      }
    }
  }

  includeDraft(draft: ComposerDraft): boolean {
    let hasTargets = false;
    for (const part of draft) {
      if (
        typeof part === "string" ||
        part.type === "skill" ||
        part.meta.workingDirectory !== this.root
      )
        continue;
      hasTargets = true;
      this.include(part.id, part.type === "directory");
    }
    return hasTargets;
  }

  sources(): ScopedProjectInstructionSource[] {
    return this.ordered().map(({ directory, source }) => ({ directory, source }));
  }

  prompt(): { text: string; directories: ReadonlySet<string> } {
    const directories = new Set<string>();
    const sections: string[] = [];
    for (const { directory, source, body } of this.ordered()) {
      if (!body) continue;
      directories.add(directory);
      sections.push(
        `## Project instructions for ${JSON.stringify(directory + "/")} (${basename(source.path)})\n\n${body}`,
      );
    }
    return { text: sections.join("\n\n"), directories };
  }

  private ordered(): ScopedProjectInstruction[] {
    return [...this.directories.values()]
      .filter((entry): entry is ScopedProjectInstruction => entry !== undefined)
      .sort(
        (a, b) =>
          b.directory.split("/").length - a.directory.split("/").length ||
          a.directory.localeCompare(b.directory, "en"),
      );
  }

  private include(path: string, isDirectory?: boolean): ScopedProjectInstruction[] {
    const { root, resolve } = this;
    if (!root || !resolve) return [];
    let directory: string;
    try {
      const target = resolve(path);
      if (relative(root, target) === "") return [];
      const folder = isDirectory ?? statSync(target, { throwIfNoEntry: false })?.isDirectory();
      directory = folder ? target : dirname(target);
    } catch {
      // The workspace tools report their own invalid or inaccessible paths.
      return [];
    }

    const applicable: ScopedProjectInstruction[] = [];
    for (; relative(root, directory) !== ""; directory = dirname(directory)) {
      const key = process.platform === "win32" ? directory.toLowerCase() : directory;
      if (!this.directories.has(key)) {
        const entry = readInstructions(resolve, directory);
        this.directories.set(
          key,
          entry.source.status === "missing"
            ? undefined
            : {
                ...entry,
                directory: relative(root, directory).split(sep).join("/"),
              },
        );
      }
      const entry = this.directories.get(key);
      if (entry) applicable.push(entry);
    }
    return applicable;
  }
}
