// @env node
import type { PowerSaveBlocker } from "electron";
import { beforeEach, expect, it, vi } from "vitest";

import type { DiagnosticLog } from "../src/main/diagnostics";
import { createSleepBlocker } from "../src/main/sleep-blocker";

const { start, stop } = vi.hoisted(() => ({
  start: vi.fn<PowerSaveBlocker["start"]>(),
  stop: vi.fn<PowerSaveBlocker["stop"]>(),
}));

vi.mock("electron", () => ({ powerSaveBlocker: { start, stop } }));

const log = { write: vi.fn<DiagnosticLog["write"]>() };

beforeEach(() => {
  vi.resetAllMocks();
  start.mockReturnValue(0);
  stop.mockReturnValue(true);
});

it("keeps one system sleep blocker for active work and releases it on idle", () => {
  const setSleepBlocked = createSleepBlocker(log);
  setSleepBlocked(false);
  expect(start).not.toHaveBeenCalled();
  expect(stop).not.toHaveBeenCalled();

  setSleepBlocked(true);
  setSleepBlocked(true);
  expect(start).toHaveBeenCalledExactlyOnceWith("prevent-app-suspension");
  expect(stop).not.toHaveBeenCalled();

  setSleepBlocked(false);
  setSleepBlocked(false);
  expect(stop).toHaveBeenCalledExactlyOnceWith(0);

  start.mockReturnValue(1);
  setSleepBlocked(true);
  setSleepBlocked(false);
  expect(start).toHaveBeenCalledTimes(2);
  expect(stop).toHaveBeenLastCalledWith(1);
});

it("logs a startup failure and can acquire a blocker for later work", () => {
  const setSleepBlocked = createSleepBlocker(log);
  start.mockImplementationOnce(() => {
    throw new Error("Unable to start a sleep blocker");
  });

  setSleepBlocked(true);
  expect(log.write).toHaveBeenCalledWith(
    "warn",
    "main",
    "sleep-blocker-start-failed",
    expect.objectContaining({ errorName: "Error" }),
  );
  setSleepBlocked(false);
  expect(stop).not.toHaveBeenCalled();

  setSleepBlocked(true);
  setSleepBlocked(false);
  expect(stop).toHaveBeenCalledExactlyOnceWith(0);
});

it("keeps the blocker ID available to retry a failed release", () => {
  const setSleepBlocked = createSleepBlocker(log);
  stop.mockImplementationOnce(() => {
    throw new Error("Unable to stop a sleep blocker");
  });

  setSleepBlocked(true);
  setSleepBlocked(false);
  expect(log.write).toHaveBeenCalledWith(
    "warn",
    "main",
    "sleep-blocker-stop-failed",
    expect.objectContaining({ errorName: "Error" }),
  );
  setSleepBlocked(true);
  expect(start).toHaveBeenCalledOnce();
  setSleepBlocked(false);
  setSleepBlocked(false);
  expect(stop.mock.calls).toEqual([[0], [0]]);
});
