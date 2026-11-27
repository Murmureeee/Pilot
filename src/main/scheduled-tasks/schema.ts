// @env node
import { z } from "zod";

import { SCHEDULE_FREQUENCIES, SCHEDULE_RUN_STATUSES } from "../../shared/scheduled-tasks";

export const scheduledTaskInput = z.strictObject({
  title: z.string().trim().min(1).max(120),
  prompt: z.string().trim().min(1).max(20_000),
  directory: z
    .string()
    .min(1)
    .max(4096)
    .refine((value) => !value.includes("\0")),
  frequency: z.enum(SCHEDULE_FREQUENCIES),
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/),
  timeZone: z.string().min(1).max(100),
  paused: z.boolean(),
});

export const scheduledTaskStore = z.strictObject({
  formatVersion: z.literal(1),
  tasks: z.array(
    scheduledTaskInput.extend({
      id: z.uuid(),
      nextAt: z.number().int().nullable(),
      runs: z.array(
        z.strictObject({
          id: z.uuid(),
          at: z.number().int(),
          trigger: z.enum(["schedule", "manual", "retry"]),
          status: z.enum(SCHEDULE_RUN_STATUSES),
          sessionId: z.uuid().optional(),
          error: z.string().optional(),
        }),
      ),
    }),
  ),
});
