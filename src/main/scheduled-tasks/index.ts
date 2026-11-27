// @env node
import { randomUUID } from "node:crypto";

import {
  nextScheduledTime,
  type ScheduledTask,
  type ScheduledTaskInput,
  type ScheduledTaskRun,
} from "../../shared/scheduled-tasks";
import {
  formatVersion,
  parseStoredJson,
  readStoredText,
  writeStorageAtomic,
} from "../storage-format";
import { normalizeWorkingDirectory } from "../workspace/paths";
import { SCHEDULE_GRACE_MS, SCHEDULE_HISTORY_LIMIT, SCHEDULE_INTERVAL_MS } from "./constants";
import { scheduledTaskStore } from "./schema";
import type { ScheduledTasksDependencies } from "./types";

export class ScheduledTasks {
  private tasks?: ScheduledTask[];
  private timer?: ReturnType<typeof setInterval>;
  private readonly now: () => number;

  constructor(private readonly deps: ScheduledTasksDependencies) {
    this.now = deps.now ?? Date.now;
  }

  list(): ScheduledTask[] {
    if (this.tasks) return this.tasks;
    const contents = readStoredText(this.deps.file);
    if (contents === undefined) return (this.tasks = []);
    const data = parseStoredJson(contents);
    formatVersion(data, 1, this.deps.file);
    const parsed = scheduledTaskStore.safeParse(data);
    if (!parsed.success) throw new Error("无法读取定时任务。请检查本地任务数据。");
    return (this.tasks = parsed.data.tasks);
  }

  private save(tasks: ScheduledTask[]): ScheduledTask[] {
    writeStorageAtomic(this.deps.file, JSON.stringify({ formatVersion: 1, tasks }), 0o600);
    this.tasks = tasks;
    return tasks;
  }

  private task(id: string): ScheduledTask {
    const task = this.list().find((entry) => entry.id === id);
    if (!task) throw new Error("找不到该定时任务。");
    return task;
  }

  private replace(task: ScheduledTask): ScheduledTask[] {
    return this.save(this.list().map((current) => (current.id === task.id ? task : current)));
  }

  saveTask(input: ScheduledTaskInput, id?: string): ScheduledTask[] {
    const previous = id === undefined ? undefined : this.task(id);
    const directory = normalizeWorkingDirectory(input.directory);
    const scheduleChanged =
      !previous ||
      input.start !== previous.start ||
      input.timeZone !== previous.timeZone ||
      input.frequency !== previous.frequency;
    const nextAt =
      scheduleChanged || (previous.paused && !input.paused)
        ? nextScheduledTime(input, this.now())
        : previous.nextAt;
    if (scheduleChanged && nextAt === null) throw new Error("请选择将来的执行时间。");
    const task = {
      ...input,
      directory,
      id: previous?.id ?? randomUUID(),
      nextAt,
      runs: previous?.runs ?? [],
    };
    return previous ? this.replace(task) : this.save([...this.list(), task]);
  }

  deleteTask(id: string): ScheduledTask[] {
    this.requireIdle(this.task(id));
    return this.save(this.list().filter((task) => task.id !== id));
  }

  private requireIdle(task: ScheduledTask): void {
    if (task.runs.some(({ status }) => status === "running"))
      throw new Error("该定时任务正在运行，请等待本次执行结束。");
  }

  runNow(id: string, retryId?: string): ScheduledTask[] {
    const task = this.task(id);
    this.requireIdle(task);
    if (
      retryId &&
      !task.runs.some(
        (run) => run.id === retryId && ["failed", "interrupted", "missed"].includes(run.status),
      )
    )
      throw new Error("找不到可重跑的执行记录。");
    return this.launch(task, this.now(), retryId ? "retry" : "manual");
  }

  private record(task: ScheduledTask, run: ScheduledTaskRun): ScheduledTask[] {
    return this.replace({ ...task, runs: [run, ...task.runs].slice(0, SCHEDULE_HISTORY_LIMIT) });
  }

  private launch(
    task: ScheduledTask,
    at: number,
    trigger: ScheduledTaskRun["trigger"],
  ): ScheduledTask[] {
    const sessionId = randomUUID();
    const run: ScheduledTaskRun = { id: randomUUID(), at, trigger, status: "running", sessionId };
    const saved = this.record(task, run);
    void this.execute(task, run, sessionId).catch(() => this.deps.reportError());
    return saved;
  }

  private async execute(
    task: ScheduledTask,
    run: ScheduledTaskRun,
    sessionId: string,
  ): Promise<void> {
    let result: ScheduledTaskRun;
    try {
      const status = await this.deps.run(task, sessionId);
      result = { ...run, status };
    } catch (error) {
      result = {
        ...run,
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
      };
    }
    const current = this.task(task.id);
    this.replace({
      ...current,
      runs: current.runs.map((entry) => (entry.id === run.id ? result : entry)),
    });
  }

  private tick(): void {
    const now = this.now();
    for (const task of this.list()) {
      const at = task.nextAt;
      if (task.paused || at === null || at > now) continue;
      const next = { ...task, nextAt: nextScheduledTime(task, now) };
      const busy = task.runs.some(({ status }) => status === "running");
      if (busy || now - at > SCHEDULE_GRACE_MS) {
        this.record(next, { id: randomUUID(), at, trigger: "schedule", status: "missed" });
      } else {
        this.launch(next, at, "schedule");
      }
    }
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => {
      try {
        this.tick();
      } catch {
        this.deps.reportError();
      }
    }, SCHEDULE_INTERVAL_MS);
    this.timer.unref();
  }

  stop(): void {
    clearInterval(this.timer);
    this.timer = undefined;
  }
}
