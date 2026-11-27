import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ScheduledTasks } from "../src/main/scheduled-tasks";
import { nextScheduledTime, type ScheduledTaskInput } from "../src/shared/scheduled-tasks";

const start = Date.parse("2026-11-27T08:00:00Z");
const reportError = vi.fn<() => void>();
let directory: string;
let file: string;
let input: ScheduledTaskInput;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(start);
  directory = mkdtempSync(join(tmpdir(), "pilot-schedule-test-"));
  file = join(directory, "scheduled-tasks.json");
  input = {
    directory,
    title: "Daily check",
    prompt: "Summarize README",
    frequency: "daily",
    start: "2026-11-27T08:01",
    timeZone: "UTC",
    paused: false,
  };
  reportError.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
  rmSync(directory, { recursive: true, force: true });
});

describe("scheduled tasks", () => {
  it("saves and edits a schedule, fires once on time, and retains the session history", async () => {
    const run = vi.fn<(task: ScheduledTaskInput, sessionId: string) => Promise<"success">>(() =>
      Promise.resolve("success"),
    );
    const tasks = new ScheduledTasks({ file, run, reportError });
    const [task] = tasks.saveTask(input);
    expect(task.nextAt).toBe(start + 60_000);
    tasks.saveTask({ ...input, prompt: "Check the documentation." }, task.id);
    tasks.start();
    await vi.advanceTimersByTimeAsync(63_000);
    tasks.stop();
    expect(run).toHaveBeenCalledTimes(1);
    expect(run.mock.calls[0]).toEqual([
      expect.objectContaining({ prompt: "Check the documentation." }),
      expect.any(String),
    ]);
    const reloaded = new ScheduledTasks({ file, run, reportError }).list()[0];
    expect(reloaded.nextAt).toBe(start + 86_460_000);
    expect(reloaded.runs).toEqual([
      expect.objectContaining({
        status: "success",
        trigger: "schedule",
        sessionId: expect.any(String),
      }),
    ]);
    expect(tasks.deleteTask(task.id)).toEqual([]);
    expect(reportError).not.toHaveBeenCalled();
  });

  it("does not execute a paused schedule and allows manual execution with a guarded retry", async () => {
    const run = vi
      .fn<() => Promise<"success">>()
      .mockRejectedValueOnce(new Error("Fixture failed"))
      .mockResolvedValueOnce("success");
    const tasks = new ScheduledTasks({ file, run, reportError });
    const [task] = tasks.saveTask({ ...input, paused: true });
    tasks.start();
    await vi.advanceTimersByTimeAsync(61_000);
    expect(run).not.toHaveBeenCalled();
    tasks.runNow(task.id);
    expect(() => tasks.runNow(task.id)).toThrow("正在运行");
    await vi.advanceTimersByTimeAsync(0);
    const [failure] = tasks.list()[0].runs;
    expect(failure).toMatchObject({ status: "failed", error: "Fixture failed" });
    tasks.runNow(task.id, failure.id);
    await vi.advanceTimersByTimeAsync(0);
    expect(tasks.list()[0].runs[0]).toMatchObject({ status: "success", trigger: "retry" });
    tasks.stop();
  });

  it("previews a one-time or weekly schedule in its stored time zone", () => {
    const timing = { start: "2026-11-27T22:30", timeZone: "Asia/Shanghai" };
    const first = Date.parse("2026-11-27T14:30:00Z");
    expect(nextScheduledTime({ ...timing, frequency: "once" }, start)).toBe(first);
    expect(nextScheduledTime({ ...timing, frequency: "once" }, first)).toBeNull();
    expect(nextScheduledTime({ ...timing, frequency: "weekly" }, first)).toBe(
      Date.parse("2026-12-04T14:30:00Z"),
    );
  });

  it("records every missed clock slot across restart and wake without replaying it", async () => {
    const run = vi.fn<() => Promise<"success">>().mockResolvedValue("success");
    const tasks = new ScheduledTasks({ file, run, reportError });
    tasks.saveTask(input);
    const twoDaysLater = Date.parse("2026-11-29T08:01:02Z");
    vi.setSystemTime(twoDaysLater);
    const restarted = new ScheduledTasks({ file, run, reportError });
    restarted.start();
    expect(restarted.list()[0].runs.map(({ status }) => status)).toEqual([
      "missed",
      "missed",
      "missed",
    ]);
    vi.setSystemTime(Date.parse("2026-11-30T08:01:01Z"));
    restarted.resume();
    restarted.resume();
    expect(restarted.list()[0].runs.map(({ status }) => status)).toEqual([
      "missed",
      "missed",
      "missed",
      "missed",
    ]);
    vi.setSystemTime(Date.parse("2026-11-29T08:01:05Z"));
    await vi.advanceTimersByTimeAsync(2_000);
    expect(run).not.toHaveBeenCalled();
    restarted.stop();
  });

  it("marks a stale reservation interrupted and recovers a completed session commit", () => {
    const run = vi.fn<() => Promise<"success">>(() => new Promise(() => {}));
    const tasks = new ScheduledTasks({ file, run, reportError });
    const [first] = tasks.saveTask(input);
    const [, second] = tasks.saveTask({ ...input, title: "Other task" });
    const [reserved] = tasks.runNow(first.id);
    tasks.runNow(second.id);
    const restarted = new ScheduledTasks({
      file,
      run,
      reportError,
      settled: (id) => ({ status: id === reserved.runs[0].sessionId ? "success" : undefined }),
    });
    restarted.start();
    expect(restarted.list().map(({ runs }) => runs[0].status)).toEqual(["success", "interrupted"]);
    expect(run).toHaveBeenCalledTimes(2);
    restarted.stop();
  });

  it("keeps the active reservation when missed slots fill the run history", async () => {
    const running = Promise.withResolvers<"success">();
    const run = vi.fn<() => Promise<"success">>(() => running.promise);
    const tasks = new ScheduledTasks({ file, run, reportError });
    const [task] = tasks.saveTask(input);
    tasks.start();
    tasks.runNow(task.id);
    vi.setSystemTime(Date.parse("2027-06-01T08:02:00Z"));
    tasks.resume();
    expect(tasks.list()[0].runs).toHaveLength(100);
    expect(() => tasks.runNow(task.id)).toThrow("正在运行");
    running.resolve("success");
    await vi.advanceTimersByTimeAsync(0);
    expect(tasks.list()[0].runs.at(-1)?.status).toBe("success");
    tasks.stop();
  });

  it("preserves local wall time across daylight saving and picks just one occurrence of a repeated time", () => {
    const task = {
      start: "2026-03-07T02:30",
      timeZone: "America/New_York",
      frequency: "daily",
    } as const;
    const gap = nextScheduledTime(task, Date.parse("2026-03-07T07:30:00Z"));
    expect(gap).toBe(Date.parse("2026-03-08T07:30:00Z"));
    expect(nextScheduledTime(task, gap!)).toBe(Date.parse("2026-03-09T06:30:00Z"));
    const fall = { ...task, start: "2026-10-31T01:30" };
    const early = nextScheduledTime(fall, Date.parse("2026-10-31T05:30:00Z"));
    expect(early).toBe(Date.parse("2026-11-01T05:30:00Z"));
    expect(nextScheduledTime(fall, early!)).toBe(Date.parse("2026-11-02T06:30:00Z"));
  });
});
