// @env node
import { IPC } from "../../shared/contract";
import type { ScheduledTasks } from "../scheduled-tasks";
import { handle } from "./transport";

export function registerScheduledTaskRoutes(tasks: ScheduledTasks): void {
  handle(IPC.scheduledTasksList, () => tasks.list());
  handle(IPC.scheduledTasksSave, (_event, input, id) => tasks.saveTask(input, id ?? undefined));
  handle(IPC.scheduledTasksDelete, (_event, id) => tasks.deleteTask(id));
  handle(IPC.scheduledTasksRun, (_event, id, retryId) => tasks.runNow(id, retryId ?? undefined));
}
