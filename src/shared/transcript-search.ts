// @env all
import type { TranscriptLocation, TranscriptSnippet, UiMessage, UiPart } from "./contract";
import { toolInput } from "./tool-input";

type TranscriptField = TranscriptLocation["field"];
type TranscriptSegment = Omit<TranscriptLocation, "occurrence"> & { text: string };
type TranscriptMatch = { location: TranscriptLocation; snippet: TranscriptSnippet };
type PartFields = Partial<Record<TranscriptField, string>>;

function partFields(part: UiPart): PartFields {
  switch (part.type) {
    case "text":
    case "thinking":
      return { text: part.text };
    case "mention":
      return { text: part.id.includes(part.label) ? part.id : part.label + " " + part.id };
    case "plan":
      return { text: part.steps.map(({ title }) => title).join("\n") };
    case "compaction":
      return { text: part.compaction.summary };
    case "tool": {
      const { preview } = toolInput(part.inputSummary);
      const path = part.fileChange?.path;
      return {
        input: preview,
        path: path && !preview.includes(path) ? path : undefined,
        output: part.output?.trim() || part.error,
      };
    }
  }
}

export function transcriptSegments(messages: readonly UiMessage[]): TranscriptSegment[] {
  const segments: TranscriptSegment[] = [];
  for (const message of messages) {
    for (const [partIndex, part] of message.parts.entries()) {
      if (message.role === "system" && part.type !== "compaction") continue;
      for (const [field, text] of Object.entries(partFields(part))) {
        if (text?.trim())
          segments.push({
            messageId: message.id,
            partIndex,
            field: field as TranscriptField,
            text,
          });
      }
    }
  }
  return segments;
}

export function transcriptPartKey(messageId: string, partIndex: number): string {
  return messageId + "/" + partIndex;
}

export function literalMatches(text: string, query: string): IterableIterator<RegExpExecArray> {
  return text.matchAll(new RegExp(RegExp.escape(query), "giu"));
}

export function* findTranscript(
  segments: readonly TranscriptSegment[],
  query: string,
): Generator<TranscriptMatch> {
  const term = query.trim();
  if (!term) return;
  const pattern = new RegExp(RegExp.escape(term), "giu");
  for (const { text, ...part } of segments) {
    let occurrence = 0;
    for (const match of text.matchAll(pattern)) {
      const start = match.index;
      const end = start + match[0].length;
      yield {
        location: { ...part, occurrence: occurrence++ },
        snippet: {
          before: (start > 64 ? "…" : "") + text.slice(Math.max(0, start - 64), start),
          match: match[0],
          after: text.slice(end, end + 96) + (end + 96 < text.length ? "…" : ""),
        },
      };
    }
  }
}
