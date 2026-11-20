// @env all
import type { PromptMention, UiPart } from "./contract";

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
