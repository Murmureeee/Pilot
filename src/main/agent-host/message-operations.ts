// @env node
import type { AgentMessage } from "@earendil-works/pi-agent-core";

import type { ComposerDraft } from "@shared/contract";

import { messageParts } from "./session-store";

export function messageIndex(messages: readonly AgentMessage[], id: string): number {
  const target = Number(id.slice(2));
  let visible = 0;
  const index = messages.findIndex(
    ({ role }) => (role === "assistant" || role === "user") && visible++ === target,
  );
  if (!/^s-(0|[1-9]\d*)$/.test(id) || index < 0) throw new Error("消息已变更，请重新选择。");
  return index;
}

export function draftFromMessage(message: AgentMessage, directory?: string): ComposerDraft {
  const draft: ComposerDraft = [];
  for (const part of messageParts(message)) {
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
