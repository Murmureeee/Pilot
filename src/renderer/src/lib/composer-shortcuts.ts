// @env browser
import type { ApprovalMode, PromptInput } from "@shared/contract";

import type { ComposerTrigger, SendKey } from "./types";

export function composerTrigger(text: string, start: number, end: number): ComposerTrigger | null {
  if (start !== end) return null;
  const before = text.slice(0, end);
  const after = text.slice(end);
  const mention = /(^|[\s(（、，。！？\p{Script=Han}])@([^\s@),;!?）、，。！？]*)$/u.exec(before);
  if (mention) {
    const suffix = /^[^\s@),;!?）、，。！？]*/u.exec(after)?.[0] ?? "";
    return {
      kind: "mention",
      start: mention.index + mention[1].length,
      end: end + suffix.length,
      query: mention[2],
    };
  }

  const command = /(^|[\s(（、，。！？])\/([\p{L}\p{N}_-]*)$/u.exec(before);
  if (command && !/^[\p{L}\p{N}_-]*[./\\:]/u.test(after)) {
    const suffix = /^[\p{L}\p{N}_-]*/u.exec(after)?.[0] ?? "";
    return {
      kind: "command",
      start: command.index + command[1].length,
      end: end + suffix.length,
      query: command[2],
    };
  }
  return null;
}

export function matchesComposerQuery(label: string, query: string): boolean {
  const value = label.normalize("NFKC").toLowerCase();
  let index = 0;
  for (const character of query.normalize("NFKC").toLowerCase().trim()) {
    const match = value.indexOf(character, index);
    if (match === -1) return false;
    index = match + character.length;
  }
  return true;
}

export function trimPrompt(input: PromptInput): PromptInput {
  const text = input.text.trimStart();
  const removed = input.text.length - text.length;
  return {
    text: text.trimEnd(),
    mentions: input.mentions.map((mention) =>
      mention.offset === undefined ? mention : { ...mention, offset: mention.offset - removed },
    ),
  };
}

export function composerEnterAction(
  event: { key: string; shiftKey: boolean; ctrlKey: boolean; metaKey: boolean },
  sendKey: SendKey,
): "send" | "newline" | null {
  if (event.key !== "Enter") return null;
  if (sendKey === "enter") return event.shiftKey ? null : "send";
  if (event.ctrlKey || event.metaKey) return "send";
  return event.shiftKey ? null : "newline";
}

export function composerEditingShortcut(
  event: { key: string; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean },
  empty: boolean,
): "cycle-approval-mode" | "recall-message" | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  if (event.key === "Tab" && event.shiftKey) return "cycle-approval-mode";
  return event.key === "ArrowUp" && !event.shiftKey && empty ? "recall-message" : null;
}

export function nextApprovalMode(mode: ApprovalMode): ApprovalMode {
  if (mode === "standard") return "read-only";
  if (mode === "read-only") return "full-access";
  return mode === "full-access" ? "plan" : "standard";
}
