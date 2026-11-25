// @env node
import { afterEach, expect, it, vi } from "vitest";

import { TerminalManager } from "../src/main/terminal";
import { TERMINAL_BACKLOG_LIMIT, TERMINAL_FLUSH_MS } from "../src/main/terminal/constants";
import { launchBackgroundCommand, launchInteractiveShell } from "../src/main/terminal/process";
import type { TerminalExit, TerminalProcess } from "../src/main/terminal/types";
import type { TerminalEvent } from "../src/shared/contract";

vi.mock("../src/main/terminal/process", () => ({
  launchInteractiveShell: vi.fn<typeof launchInteractiveShell>(),
  launchBackgroundCommand: vi.fn<typeof launchBackgroundCommand>(),
}));

const run = { runId: "run", sessionId: "chat" };
const directory = "E:/project";
const size = { columns: 80, rows: 24 };

function createProcess() {
  const exit = Promise.withResolvers<TerminalExit>();
  const process = {
    done: exit.promise,
    stop: vi.fn<() => void>(() => exit.resolve({ exitCode: 1 })),
    write: vi.fn<TerminalProcess["write"] & ((input: string) => void)>(),
    resize: vi.fn<TerminalProcess["resize"] & ((value: typeof size) => void)>(),
  };
  return { exit, process };
}

afterEach(() => {
  vi.resetAllMocks();
  vi.useRealTimers();
});

it("retains a bounded output snapshot with non-overlapping stream offsets", async () => {
  vi.useFakeTimers();
  const events: TerminalEvent[] = [];
  const activity = vi.fn<() => void>();
  const manager = new TerminalManager((event) => events.push(event), activity);
  const { process, exit } = createProcess();
  let append: ((data: string) => void) | undefined;
  vi.mocked(launchInteractiveShell).mockImplementation((_shell, _cwd, _size, output) => {
    append = output;
    return process;
  });
  const record = manager.open(run.sessionId, directory, "bash", size);
  expect(manager.open(run.sessionId, directory, "bash", size)).toBe(record);
  expect(manager.hasActiveProcesses()).toBe(true);
  manager.write(run.sessionId, record.id, "\x03");
  manager.resize(run.sessionId, record.id, { columns: 130, rows: 32 });
  expect(process.write).toHaveBeenCalledWith("\x03");
  expect(process.resize).toHaveBeenCalledWith({ columns: 130, rows: 32 });

  append?.("first");
  expect(manager.output(run.sessionId, record.id)).toEqual({ offset: 0, data: "first" });
  await vi.advanceTimersByTimeAsync(TERMINAL_FLUSH_MS);
  expect(events.at(-1)).toEqual({
    type: "output",
    composerId: run.sessionId,
    id: record.id,
    output: { offset: 0, data: "first" },
  });

  const tail = "x".repeat(TERMINAL_BACKLOG_LIMIT);
  append?.("skipped" + tail);
  exit.resolve({ exitCode: 0 });
  await exit.promise;
  expect(events.at(-2)).toMatchObject({ output: { offset: 12, data: tail } });
  expect(manager.output(run.sessionId, record.id)).toEqual({ offset: 12, data: tail });
  expect(manager.list(run.sessionId)[0].status).toBe("success");
  expect(manager.hasActiveProcesses()).toBe(false);
  expect(activity).toHaveBeenCalledTimes(2);
});

it("limits background reads and stops to the owning run and preserves interactive shells at settlement", async () => {
  const manager = new TerminalManager(
    () => {},
    () => {},
  );
  const shell = createProcess().process;
  const command = createProcess().process;
  vi.mocked(launchInteractiveShell).mockReturnValue(shell);
  vi.mocked(launchBackgroundCommand).mockImplementation((_shell, _cwd, _command, append) => {
    queueMicrotask(() => append("\x1b[32mready\x1b[0m"));
    return command;
  });
  const interactive = manager.open(run.sessionId, directory, "powershell", size);
  const job = await manager.startBackground(run, directory, "powershell", "job");
  const otherRun = { ...run, runId: "other-run" };
  expect(manager.readBackground(run, job.id).output).toBe("ready");
  expect(() => manager.readBackground(otherRun, job.id)).toThrow(/different task/);
  expect(() => manager.stopBackground(otherRun, job.id)).toThrow(/different task/);
  expect(() => manager.readBackground(run, interactive.id)).toThrow(/different task/);
  expect(() => manager.output("other-chat", job.id)).toThrow("该终端已不可用");
  expect(() => manager.write(run.sessionId, job.id, "stdin")).toThrow("后台命令没有交互输入");

  await manager.stopRun(run);
  expect(command.stop).toHaveBeenCalledOnce();
  expect(manager.readBackground(run, job.id)).toMatchObject({
    output: "ready",
    record: { status: "stopped" },
  });
  expect(shell.stop).not.toHaveBeenCalled();
  await manager.removeComposer(run.sessionId);
  expect(shell.stop).toHaveBeenCalledOnce();
  expect(manager.hasActiveProcesses()).toBe(false);
  expect(manager.list(run.sessionId)).toEqual([]);
});

it("retains a process after a failed stop so the user can retry", async () => {
  const manager = new TerminalManager(
    () => {},
    () => {},
  );
  const { process } = createProcess();
  process.stop.mockImplementationOnce(() => {
    throw new Error("stop failed");
  });
  vi.mocked(launchInteractiveShell).mockReturnValue(process);
  const record = manager.open(run.sessionId, directory, "bash", size);

  await expect(manager.stop(run.sessionId, record.id)).rejects.toThrow("stop failed");
  expect(manager.list(run.sessionId)[0]).toMatchObject({
    status: "running",
    error: expect.any(String),
  });
  await manager.stop(run.sessionId, record.id);
  expect(manager.list(run.sessionId)[0]).toMatchObject({ status: "stopped", error: undefined });
});
