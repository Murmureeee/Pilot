// @env browser
import type { UiMessage } from "@shared/contract";
import { visibleMessageText } from "../../../shared/mentions";
import type { TurnPreview } from "./types";

export function messagePreview(text: string, max = 48): string {
  const firstLine = text.split("\n").find((l) => l.trim().length > 0) ?? "";
  const collapsed = firstLine.replace(/\s+/g, " ").trim();
  return collapsed.length <= max ? collapsed : `${collapsed.slice(0, max)}…`;
}

export function turnPreviews(messages: readonly UiMessage[]): TurnPreview[] {
  const turns: TurnPreview[] = [];
  for (const message of messages) {
    const turn = turns.at(-1);
    if (message.role !== "user" && (message.role !== "assistant" || !turn)) continue;
    const text = visibleMessageText(message.parts);
    if (message.role === "user") {
      turns.push({ id: message.id, question: text, answer: "" });
    } else if (turn) {
      const preview = messagePreview(text, 200);
      if (preview) turn.answer = preview;
    }
  }
  return turns;
}
