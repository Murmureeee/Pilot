// @env node
import { z } from "zod";

import { HOOK_TRACE_TOOL, TURN_HOOK_TRACE_TOOL } from "../../shared/constants";
import type { UiPart } from "../../shared/contract";

const hookTraceSchema = z.object({
  type: z.literal("tool"),
  callId: z.string(),
  toolName: z.enum([HOOK_TRACE_TOOL, TURN_HOOK_TRACE_TOOL]),
  label: z.string(),
  inputSummary: z.string(),
  state: z.enum(["success", "error"]),
  output: z.string().optional(),
  error: z.string().optional(),
  durationMs: z.number().nonnegative(),
});

export function savedHookTraces(input: unknown): Extract<UiPart, { type: "tool" }>[] {
  if (!Array.isArray(input)) return [];
  return input.flatMap((item) => {
    const trace = hookTraceSchema.safeParse(item);
    return trace.success ? [trace.data] : [];
  });
}
