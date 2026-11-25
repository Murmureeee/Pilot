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
