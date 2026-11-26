// @env all
import type {
  ComposerDraft,
  DiffLineSpan,
  ImageAttachment,
  PromptInput,
  PromptMention,
  UiPart,
} from "./contract";

export function diffLineLabel(span: DiffLineSpan): string {
  return span.first === span.last ? String(span.first) : span.first + "–" + span.last;
}

export function mentionToken(mention: PromptMention | Pick<PromptMention, "type" | "id">): string {
  const { type, id } = mention;
  if (mention.type === "file" && "meta" in mention && mention.meta.diff) {
    const { area, before, after, previousPath } = mention.meta.diff;
    const path = id.replace(/[%:[\]\r\n]/g, (character) => encodeURIComponent(character));
    const previous = previousPath?.replace(/[%:[\]\r\n]/g, (character) =>
      encodeURIComponent(character),
    );
    return (
      "@[diff:" +
      [path, area, previous, before && diffLineLabel(before), after && diffLineLabel(after)].join(
        ":",
      ) +
      "]"
    );
  }
  const escaped = id.replace(/[%[\]\r\n]/g, (character) => encodeURIComponent(character));
  return `@[${type}:${escaped}]`;
}

export function visibleMessageText(parts: readonly UiPart[]): string {
  const text = parts
    .map((part) => {
      if (part.type === "text") return part.text;
      if (part.type === "mention") return "@" + part.label;
      return "";
    })
    .join("");
  const names = parts.flatMap((part) => (part.type === "image" ? [part.name] : []));
  return [text, ...names].filter(Boolean).join("\n");
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
    } else if (part.kind === "file" && workingDirectory) {
      draft.push({
        ...reference,
        type: "file",
        meta: { workingDirectory, ...(part.diff ? { diff: part.diff } : {}) },
      });
    } else if (workingDirectory) {
      draft.push({ ...reference, type: part.kind, meta: { workingDirectory } });
    } else {
      draft.push("@" + part.label);
    }
  }
  return draft;
}

export function promptFromDraft(draft: ComposerDraft, images: ImageAttachment[] = []): PromptInput {
  const mentions: PromptInput["mentions"] = [];
  let text = "";
  for (const part of draft) {
    if (typeof part === "string") text += part;
    else {
      mentions.push({ ...part, offset: text.length });
      text += mentionToken(part);
    }
  }
  return images.length ? { text, mentions, images } : { text, mentions };
}
