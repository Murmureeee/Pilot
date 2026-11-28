// @env browser
import type { UiPart } from "@shared/contract";

import { TURN_HOOK_TRACE_TOOL } from "../../../shared/constants";
import { toolInput } from "../../../shared/tool-input";
import { STEP_KINDS } from "./constants";
import type { ReplyEntry, ReplySegment, StepCount, StepKind } from "./types";

/** 按时间顺序把回合切成正文和步骤组，相邻的思考与工具步骤归入同一组。 */
export function replySegments(entries: readonly ReplyEntry[]): ReplySegment[] {
  const segments: ReplySegment[] = [];
  for (const entry of entries) {
    const { part } = entry;
    if (part.type === "text") {
      // 空白正文不占位，也不打断前后的步骤。
      if (part.text.trim()) segments.push({ kind: "text", entry });
      continue;
    }
    // 回合结束的钩子在最终回答之后才运行，由回合末尾单独展示。
    const step =
      part.type === "thinking" || (part.type === "tool" && part.toolName !== TURN_HOOK_TRACE_TOOL);
    if (!step) continue;
    const last = segments.at(-1);
    if (last?.kind === "steps") last.entries.push(entry);
    else segments.push({ kind: "steps", entries: [entry] });
  }
  return segments;
}

/** 步骤组标题用的分类计数，按首次出现的顺序排列。读取和编辑按文件去重。 */
export function stepCounts(parts: readonly UiPart[]): StepCount[] {
  const targets = new Map<StepKind, Set<string>>();
  for (const part of parts) {
    if (part.type !== "tool") continue;
    const kind = Object.hasOwn(STEP_KINDS, part.toolName) ? STEP_KINDS[part.toolName] : "other";
    const file =
      kind === "read" || kind === "edit"
        ? (part.fileChange?.path ?? toolInput(part.inputSummary).preview)
        : "";
    const seen = targets.get(kind) ?? new Set<string>();
    targets.set(kind, seen.add(file || part.callId));
  }
  return [...targets].map(([kind, seen]) => ({ kind, count: seen.size }));
}

/** 回合里是否有正在输出的正文、思考，或等待与执行中的工具步骤。 */
export function replyInProgress(entries: readonly ReplyEntry[]): boolean {
  return entries.some(({ part, streaming }) =>
    part.type === "text"
      ? streaming && Boolean(part.text.trim())
      : part.type === "thinking"
        ? part.streaming === true
        : part.type === "tool" && (part.state === "pending" || part.state === "running"),
  );
}
