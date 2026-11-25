// @env all
import type { ComposerDraft, PromptInput, PromptMention, UiPart } from "./contract";

export function mentionToken({ type, id }: Pick<PromptMention, "type" | "id">): string {
  const escaped = id.replace(/[%[\]\r\n]/g, (character) => encodeURIComponent(character));
  return `@[${type}:${escaped}]`;
}

export function visibleMessageText(parts: readonly UiPart[]): string {
  return parts
    .map((part) => {
      if (part.type === "text") return part.text;
      if (part.type === "mention") return "@" + part.label;
      return "";
    })
    .join("");
}

export function draftFromMessageParts(
  parts: readonly UiPart[],
  directory?: string | null,
): ComposerDraft {
  const draft: ComposerDraft = [];
  for (const part of parts) {
    if (part.type === "text") draft.push(part.text);
    if (part.type !== "mention") continue;
    const workingDirectory = part.workingDirectory ?? directory;
    const reference = { id: part.id, label: part.label };
    if (part.kind === "skill") {
      draft.push({
        ...reference,
        type: "skill",
        meta: { description: "", workingDirectory: part.workingDirectory },
      });
    } else if (workingDirectory) {
      draft.push({ ...reference, type: part.kind, meta: { workingDirectory } });
    } else {
      draft.push("@" + part.label);
    }
  }
  return draft;
}

export function promptFromDraft(draft: ComposerDraft): PromptInput {
  const mentions: PromptInput["mentions"] = [];
  let text = "";
  for (const part of draft) {
    if (typeof part === "string") text += part;
    else {
      mentions.push({ ...part, offset: text.length });
      text += mentionToken(part);
    }
  }
  return { text, mentions };
}
