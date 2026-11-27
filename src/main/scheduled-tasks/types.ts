// @env node
import type { SessionRunResult } from "../../shared/contract";
import type { ScheduledTaskInput } from "../../shared/scheduled-tasks";

export interface ScheduledTasksDependencies {
  file: string;
  now?: () => number;
  run(task: ScheduledTaskInput, sessionId: string): Promise<"success" | "interrupted">;
  settled?(sessionId: string): { status?: SessionRunResult; error?: string };
  reportError(): void;
}
