// @env node
import { statSync } from "node:fs";
import { parse } from "node:path";

import type { PromptInput, PromptMention, UiUserPart } from "@shared/contract";

import { MENTION_CONTEXT_HEADING } from "../../shared/constants";
import { mentionToken } from "../../shared/mentions";
import { createToolPathResolver } from "../workspace/paths";
import { loadSkillBody, scanSkills, skillSection } from "./skills";
import type { DisplayMention, PreparedPrompt } from "./types";

function tokenPositions(
  text: string,
  known: ReadonlyMap<string, DisplayMention["part"]>,
): DisplayMention[] {
  const matches: DisplayMention[] = [];
  for (const match of text.matchAll(/@\[(?:file|directory|skill):[^[\]\r\n]+\]/g)) {
    const part = known.get(match[0]);
    if (part) matches.push({ offset: match.index, token: match[0], part });
  }
  return matches;
}

function displayParts(text: string, mentions: DisplayMention[]): UiUserPart[] {
  const parts: UiUserPart[] = [];
  let cursor = 0;
  for (const { offset, token, part } of mentions) {
    if (cursor < offset) parts.push({ type: "text", text: text.slice(cursor, offset) });
    parts.push(part);
    cursor = offset + token.length;
  }
  if (cursor < text.length || !parts.length) parts.push({ type: "text", text: text.slice(cursor) });
  return parts;
}

export function legacyMentionParts(text: string): UiUserPart[] | undefined {
  const separator = "\n\n" + MENTION_CONTEXT_HEADING + "\n";
  const start = text.lastIndexOf(separator);
  if (start < 0) return undefined;
  const body = text.slice(0, start);
  const references = new Map<string, DisplayMention["part"]>();
  // Old sessions stored this exact generated appendix in the message body.
  for (const row of text.slice(start + separator.length).split("\n")) {
    const match = /^- (@\[(file|directory|skill):([^[\]\r\n]+)\]): (.+)$/.exec(row);
    if (!match || !body.includes(match[1])) return undefined;
    const [, token, kind, encodedId, description] = match;
    try {
      const id = decodeURIComponent(encodedId);
      if (kind === "skill") {
        const name = /^Use (?:enabled )?skill (".*?")(?: from the system instructions)?$/.exec(
          description,
        );
        if (!name) return undefined;
        const label: unknown = JSON.parse(name[1]);
        if (typeof label !== "string" || !label) return undefined;
        references.set(token, { type: "mention", kind, id, label });
      } else if (kind === "file" || kind === "directory") {
        if (description !== (kind === "file" ? "File " : "Folder ") + JSON.stringify(id))
          return undefined;
        references.set(token, { type: "mention", kind, id, label: id.split("/").at(-1) || id });
      }
    } catch {
      return undefined;
    }
  }
  const mentions = tokenPositions(body, references);
  return mentions.length ? displayParts(body, mentions) : undefined;
}

function workspaceReference(mention: Exclude<PromptMention, { type: "skill" }>): string {
  const { id, type } = mention;
  try {
    if (
      parse(id).root ||
      (process.platform === "win32" && /[\\:]/.test(id)) ||
      id.split("/").some((segment) => segment === "" || segment === "." || segment === "..")
    ) {
      throw new Error("Expected a workspace-relative path");
    }
    const resolve = createToolPathResolver(mention.meta.workingDirectory);
    const stat = statSync(resolve(id));
    if (type === "file" ? !stat.isFile() : !stat.isDirectory()) {
      throw new Error("Workspace entry type changed");
    }
  } catch (error) {
    throw new Error("所选文件或文件夹已不可用，请重新选择。", { cause: error });
  }
  return `${type === "file" ? "File" : "Folder"} ${JSON.stringify(id)}`;
}

export function prepareMentionPrompt(
  input: PromptInput,
  acceptsDirectory: (directory: string) => boolean,
  skillsDir: string,
): PreparedPrompt {
  if (input.mentions.length === 0) return { text: input.text, skillInstructions: [] };

  const skills = input.mentions.some(({ type }) => type === "skill")
    ? scanSkills(skillsDir, [])
    : [];
  const references = new Map<string, string>();
  const skillInstructions: string[] = [];
  const anchored = new Map<number, DisplayMention>();
  const unanchored = new Map<string, DisplayMention["part"]>();
  for (const mention of input.mentions) {
    const token = mentionToken(mention);
    const { offset } = mention;
    if (
      offset === undefined
        ? !input.text.includes(token)
        : anchored.has(offset) || !input.text.startsWith(token, offset)
    ) {
      throw new Error("消息中的引用已变更，请重新选择。");
    }
    const part: DisplayMention["part"] = {
      type: "mention",
      kind: mention.type,
      id: mention.id,
      label: mention.label,
    };
    if (mention.type === "skill") {
      const skill = skills.find(({ id }) => id === mention.id);
      if (!skill) throw new Error("所选技能已不可用，请重新选择。");
      part.label = skill.name;
      if (!references.has(token)) {
        const body = loadSkillBody(skillsDir, skill.id);
        if (!body) throw new Error("所选技能已不可用，请重新选择。");
        references.set(token, "Use skill " + JSON.stringify(skill.name));
        skillInstructions.push(skillSection(skill.name, body));
      }
    } else {
      if (!acceptsDirectory(mention.meta.workingDirectory)) {
        throw new Error("工作目录已变更，请重新选择文件引用。");
      }
      if (!references.has(token)) references.set(token, workspaceReference(mention));
      part.workingDirectory = mention.meta.workingDirectory;
    }
    if (offset === undefined) unanchored.set(token, part);
    else anchored.set(offset, { offset, token, part });
  }

  const mentions = [
    ...anchored.values(),
    ...tokenPositions(input.text, unanchored).filter(({ offset }) => !anchored.has(offset)),
  ].sort((left, right) => left.offset - right.offset);

  return {
    text: input.text,
    reference: {
      context: [
        MENTION_CONTEXT_HEADING,
        ...Array.from(references, ([token, value]) => "- " + token + ": " + value),
      ].join("\n"),
      parts: displayParts(input.text, mentions),
    },
    skillInstructions,
  };
}
