// @env node
import {
  closeSync,
  cpSync,
  fstatSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readSync,
  readdirSync,
  realpathSync,
  rmSync,
  statSync,
  type Dirent,
} from "node:fs";
import { basename, isAbsolute, join, relative, resolve } from "node:path";

import type { SkillMeta } from "@shared/contract";

import { isWithinDirectory } from "../workspace/paths";
import {
  PROJECT_SKILL_FOLDERS,
  SKILL_FILE_BYTES,
  SKILL_FILE_NAME,
  SKILL_FILE_UNAVAILABLE,
  SKILL_HEADER_BYTES,
} from "./constants";

function parseSkillHeader(
  dirName: string,
  raw: string,
): { name: string; description: string; length: number } {
  const match = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(raw);
  const meta = new Map<string, string>();
  const lines = match?.[1].split(/\r?\n/) ?? [];
  for (let index = 0; index < lines.length; index++) {
    const pair = /^(name|description):[ \t]*(.*)$/.exec(lines[index]);
    if (!pair) continue;
    let value = pair[2].trim();
    if (/^[|>][+-]?$/.test(value)) {
      const block: string[] = [];
      while (index + 1 < lines.length && /^[ \t]/.test(lines[index + 1])) {
        block.push(lines[++index].trim());
      }
      value = block.join(" ");
    }
    const quote = value[0];
    if ((quote === '"' || quote === "'") && value.endsWith(quote)) value = value.slice(1, -1);
    meta.set(pair[1], value);
  }
  return {
    name: meta.get("name") || dirName,
    description: meta.get("description") ?? "",
    length: match?.[0].length ?? 0,
  };
}

export function parseSkillMarkdown(
  dirName: string,
  raw: string,
): { name: string; description: string; body: string } {
  const { name, description, length } = parseSkillHeader(dirName, raw);
  const body = raw.slice(length).trim();
  return { name, description: description || body.split("\n")[0]?.slice(0, 80) || "", body };
}

function scanLibrary(
  libraryPath: string,
  source: SkillMeta["source"],
  enabled: ReadonlySet<string>,
): SkillMeta[] {
  let root: string;
  let entries: Dirent[];
  try {
    root = realpathSync(libraryPath);
    if (source !== "installed" && relative(libraryPath, root) !== "") return [];
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return [];
  }
  const metas: SkillMeta[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const directory = join(root, entry.name);
    try {
      const header = readSkillHeader(skillFilePath(directory, SKILL_FILE_NAME));
      const { name, description } = parseSkillHeader(entry.name, header);
      const id = source === "installed" ? entry.name : source + "/" + entry.name;
      metas.push({
        id,
        name,
        description,
        directory,
        source,
        enabled: source !== "installed" || enabled.has(id),
      });
    } catch {
      // Entries missing a readable definition do not belong in the catalogue.
    }
  }
  return metas.sort((a, b) => a.id.localeCompare(b.id));
}

function readSkillHeader(path: string): string {
  const buffer = Buffer.alloc(SKILL_HEADER_BYTES);
  const fd = openSync(path, "r");
  try {
    const length = readSync(fd, buffer, 0, buffer.length, 0);
    return buffer.toString("utf8", 0, length);
  } finally {
    closeSync(fd);
  }
}

export function scanSkills(
  skillsDir: string,
  enabledIds: readonly string[],
  workingDirectory?: string,
): SkillMeta[] {
  const enabled = new Set(enabledIds);
  const installed = scanLibrary(skillsDir, "installed", enabled);
  if (!workingDirectory || !isAbsolute(workingDirectory)) return installed;
  return [
    ...installed,
    ...PROJECT_SKILL_FOLDERS.flatMap((source) =>
      scanLibrary(join(workingDirectory, source), source, enabled),
    ),
  ];
}

export function skillCatalog(entries: readonly SkillMeta[]): string {
  return JSON.stringify(
    entries.map(({ id, name, description, directory }) => ({
      skillId: id,
      name,
      description,
      directory,
    })),
  );
}

function skillFilePath(directory: string, input: string): string {
  const segments = input.split(/[/\\]/);
  if (
    input.includes("\0") ||
    input.includes(":") ||
    segments.includes("..") ||
    segments[0] === ""
  ) {
    throw new Error(SKILL_FILE_UNAVAILABLE);
  }
  const root = realpathSync(directory);
  if (relative(directory, root) !== "") throw new Error(SKILL_FILE_UNAVAILABLE);
  const path = realpathSync(resolve(root, ...segments));
  if (!isWithinDirectory(root, path)) throw new Error(SKILL_FILE_UNAVAILABLE);
  const stat = statSync(path);
  if (!stat.isFile() || stat.nlink !== 1) throw new Error(SKILL_FILE_UNAVAILABLE);
  return path;
}

export function readSkillFile(skill: SkillMeta, path = SKILL_FILE_NAME): string {
  try {
    const fd = openSync(skillFilePath(skill.directory, path), "r");
    try {
      const stat = fstatSync(fd);
      if (!stat.isFile() || stat.nlink !== 1 || stat.size > SKILL_FILE_BYTES)
        throw new Error(SKILL_FILE_UNAVAILABLE);
      return readFileSync(fd, "utf8");
    } finally {
      closeSync(fd);
    }
  } catch (error) {
    throw new Error(SKILL_FILE_UNAVAILABLE, { cause: error });
  }
}

export function deleteSkillDirectory(skill: SkillMeta): void {
  try {
    // Recheck the discovered directory and definition before removing the directory entry.
    skillFilePath(skill.directory, SKILL_FILE_NAME);
    rmSync(skill.directory, { recursive: true });
  } catch (error) {
    throw new Error("无法删除技能。请检查目录权限后重试。", { cause: error });
  }
}

export function importSkill(srcDir: string, skillsDir: string): string {
  let source: string;
  try {
    source = realpathSync(srcDir);
    skillFilePath(source, SKILL_FILE_NAME);
  } catch (error) {
    throw new Error("所选目录不含 SKILL.md，不是有效技能", { cause: error });
  }
  mkdirSync(skillsDir, { recursive: true });
  const base = basename(srcDir);
  let id = base;
  for (let n = 2; lstatSync(join(skillsDir, id), { throwIfNoEntry: false }); n++)
    id = `${base}-${n}`;
  // Codex can discover a skill through a directory link. Install the target as a local copy.
  cpSync(source, join(skillsDir, id), { recursive: true });
  return id;
}
