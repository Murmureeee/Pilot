// @env all
export const SCHEDULE_FREQUENCIES = ["once", "daily", "weekly"] as const;
export const SCHEDULE_RUN_STATUSES = [
  "running",
  "success",
  "failed",
  "interrupted",
  "missed",
] as const;

export interface ScheduledTaskInput {
  title: string;
  prompt: string;
  directory: string;
  frequency: (typeof SCHEDULE_FREQUENCIES)[number];
  start: string;
  timeZone: string;
  paused: boolean;
}

export interface ScheduledTaskRun {
  id: string;
  at: number;
  trigger: "schedule" | "manual" | "retry";
  status: (typeof SCHEDULE_RUN_STATUSES)[number];
  sessionId?: string;
  error?: string;
}

export interface ScheduledTask extends ScheduledTaskInput {
  id: string;
  nextAt: number | null;
  runs: ScheduledTaskRun[];
}

const DAY = 86_400_000;

function localClock(format: Intl.DateTimeFormat, instant: number): number {
  const parts = new Map(format.formatToParts(instant).map(({ type, value }) => [type, value]));
  return Date.parse(
    `${parts.get("year")}-${parts.get("month")}-${parts.get("day")}T${parts.get("hour")}:${parts.get("minute")}:00Z`,
  );
}

export function nextScheduledTime(
  task: Pick<ScheduledTaskInput, "start" | "timeZone" | "frequency">,
  after: number,
): number | null {
  const start = Date.parse(`${task.start}:00Z`);
  if (!Number.isFinite(start) || new Date(start).toISOString().slice(0, 16) !== task.start)
    throw new Error("请输入有效的计划时间。");
  let format: Intl.DateTimeFormat;
  try {
    format = new Intl.DateTimeFormat("en-CA", {
      timeZone: task.timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    });
  } catch {
    throw new Error("请输入有效的时区。");
  }
  const step = task.frequency === "weekly" ? 7 * DAY : DAY;
  const firstIndex =
    task.frequency === "once"
      ? 0
      : Math.max(0, Math.floor((localClock(format, after) - start) / step) - 1);
  for (let index = firstIndex; index < firstIndex + 4; index++) {
    if (task.frequency === "once" && index > 0) return null;
    const wall = start + index * step;
    const offsets = [wall - DAY, wall, wall + DAY].map(
      (sample) => localClock(format, sample) - sample,
    );
    const candidates = offsets.map((offset) => wall - offset);
    const exact = candidates.filter((candidate) => localClock(format, candidate) === wall);
    // Use the first occurrence on a fold and move forward by the gap on a spring transition.
    const instant = exact.length ? Math.min(...exact) : Math.max(...candidates);
    if (instant > after) return instant;
  }
  return null;
}
