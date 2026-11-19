// @env all
import type { PlanStep, UiMessage } from "./contract";

export function applyPlanUpdate(messages: UiMessage[], steps: PlanStep[]): UiMessage[] {
  const latest = messages.at(-1);
  if (latest?.role !== "assistant") return messages;

  // 同一轮的后续工具调用更新原位置，使实时界面和转录恢复一致。
  for (let index = messages.length - 1; index >= 0; index--) {
    const message = messages[index];
    if (message.role === "user") break;
    const partIndex = message.parts.findIndex((part) => part.type === "plan");
    if (partIndex === -1) continue;
    const parts = message.parts.with(partIndex, { type: "plan", steps });
    return messages.with(index, { ...message, parts });
  }
  return messages.with(messages.length - 1, {
    ...latest,
    parts: [...latest.parts, { type: "plan", steps }],
  });
}
