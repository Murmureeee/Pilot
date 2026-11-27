// @env node
import type { ScheduledTaskInput } from "../../shared/scheduled-tasks";

export interface ScheduledTasksDependencies {
  file: string;
  now?: () => number;
  run(task: ScheduledTaskInput, sessionId: string): Promise<"success" | "interrupted">;
  reportError(): void;
}
