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
});
