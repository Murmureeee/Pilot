// @env node
import { z } from "zod";

import type { SubtaskTrace } from "@shared/contract";

import { MAX_SUBTASK_STEPS } from "./constants";

const subtaskDetails = z.object({
  pilotSubtask: z.object({
    question: z.string(),
    status: z.enum(["running", "success", "error", "stopped", "interrupted"]),
    steps: z
      .array(
        z.object({
          id: z.string(),
          toolName: z.string(),
          label: z.string(),
          inputSummary: z.string(),
          state: z.enum(["running", "success", "error"]),
          output: z.string().optional(),
          durationMs: z.number().nonnegative().optional(),
        }),
      )
      .max(MAX_SUBTASK_STEPS),
    usage: z.object({
      input: z.number().nonnegative(),
      output: z.number().nonnegative(),
      cacheRead: z.number().nonnegative(),
      cacheWrite: z.number().nonnegative(),
      costTotal: z.number().nonnegative(),
    }),
  }),
}) satisfies z.ZodType<{ pilotSubtask: SubtaskTrace }>;

export function readSubtaskTrace(details: unknown): SubtaskTrace | undefined {
  return subtaskDetails.safeParse(details).data?.pilotSubtask;
}

export function finishSubtaskTrace(
  trace: SubtaskTrace,
  status: Exclude<SubtaskTrace["status"], "running">,
  reason?: string,
): SubtaskTrace {
  return {
    ...trace,
    status,
    steps: trace.steps.map((step) =>
      step.state === "running" ? { ...step, state: "error", output: reason } : step,
    ),
  };
}
