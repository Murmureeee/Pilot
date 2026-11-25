// @env node
import type { AgentMessage } from "@earendil-works/pi-agent-core";

export function messageIndex(messages: readonly AgentMessage[], id: string): number {
  const target = Number(id.slice(2));
  let visible = 0;
  const index = messages.findIndex(
    ({ role }) => (role === "assistant" || role === "user") && visible++ === target,
  );
  if (!/^s-(0|[1-9]\d*)$/.test(id) || index < 0) throw new Error("消息已变更，请重新选择。");
  return index;
}
