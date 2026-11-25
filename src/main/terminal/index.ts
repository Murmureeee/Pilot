// @env node
import { randomUUID } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { stripVTControlCharacters } from "node:util";

import type {
  CommandShell,
  RunRef,
  TerminalEvent,
  TerminalOutput,
  TerminalRecord,
  TerminalSize,
} from "../../shared/contract";
import {
  TERMINAL_BACKLOG_LIMIT,
  TERMINAL_FINISHED_LIMIT,
  TERMINAL_FLUSH_MS,
  TERMINAL_JOB_READ_LIMIT,
  TERMINAL_STOP_TIMEOUT_MS,
} from "./constants";
import { launchBackgroundCommand, launchInteractiveShell } from "./process";
import type { TerminalEntry, TerminalExit, TerminalProcess } from "./types";

export class TerminalManager {
  private readonly entries = new Map<string, TerminalEntry>();
  private readonly removing = new Set<string>();
  private starts = 0;

  constructor(
    private readonly broadcast: (event: TerminalEvent) => void,
    private readonly onActivityChanged: () => void,
  ) {}

  get startedProcesses(): number {
    return this.starts;
  }

  hasActiveProcesses(): boolean {
    return [...this.entries.values()].some(({ process }) => process !== null);
  }

  list(composerId: string): TerminalRecord[] {
    return [...this.entries.values()].flatMap(({ record }) =>
      record.composerId === composerId ? [record] : [],
    );
  }

  open(
    composerId: string,
    workingDirectory: string,
    shell: CommandShell,
    size: TerminalSize,
  ): TerminalRecord {
    const existing = this.list(composerId).find(
      (item) =>
        item.source === "user" &&
        item.status === "running" &&
        item.workingDirectory === workingDirectory &&
        item.shell === shell,
    );
    if (existing) return existing;
    return this.start({ composerId, workingDirectory, shell, source: "user" }, (append) =>
      launchInteractiveShell(shell, workingDirectory, size, append),
    ).record;
  }

  async startBackground(
    run: RunRef,
    workingDirectory: string,
    shell: CommandShell,
    command: string,
    signal?: AbortSignal,
  ): Promise<TerminalRecord> {
    signal?.throwIfAborted();
    const entry = this.start(
      { composerId: run.sessionId, workingDirectory, shell, source: "agent", command },
      (append) => launchBackgroundCommand(shell, workingDirectory, command, append),
      run.runId,
    );
    await entry.process?.ready;
    signal?.throwIfAborted();
    return entry.record;
  }

  output(composerId: string, id: string): TerminalOutput {
    const entry = this.requested(composerId, id);
    return { offset: entry.offset - entry.data.length, data: entry.data };
  }

  write(composerId: string, id: string, data: string): void {
    const entry = this.requested(composerId, id);
    if (entry.record.source !== "user") throw new Error("后台命令没有交互输入。");
    if (entry.record.status === "running") entry.process?.write?.(data);
  }

  resize(composerId: string, id: string, size: TerminalSize): void {
    const entry = this.requested(composerId, id);
    if (entry.record.status === "running") entry.process?.resize?.(size);
  }

  stop(composerId: string, id: string): Promise<void> {
    return this.stopEntry(this.requested(composerId, id));
  }

  readBackground(run: RunRef, id: string): { record: TerminalRecord; output: string } {
    const entry = this.ownedBackground(run, id);
    const output = stripVTControlCharacters(entry.data).slice(-TERMINAL_JOB_READ_LIMIT);
    return { record: entry.record, output };
  }

  stopBackground(run: RunRef, id: string): Promise<void> {
    return this.stopEntry(this.ownedBackground(run, id));
  }

  stopRun(run: RunRef): Promise<void> {
    return this.stopWhere(
      (entry) => entry.runId === run.runId && entry.record.composerId === run.sessionId,
    );
  }

  async removeComposer(composerId: string): Promise<void> {
    this.removing.add(composerId);
    try {
      await this.stopWhere((entry) => entry.record.composerId === composerId);
      for (const record of this.list(composerId)) this.remove(record);
    } finally {
      this.removing.delete(composerId);
    }
  }

  stopAll(): Promise<void> {
    return this.stopWhere(() => true);
  }

  private requested(composerId: string, id: string): TerminalEntry {
    const entry = this.entries.get(id);
    if (!entry || entry.record.composerId !== composerId)
      throw new Error("该终端已不可用。请刷新终端页签。");
    return entry;
  }

  private ownedBackground(run: RunRef, id: string): TerminalEntry {
    const entry = this.requested(run.sessionId, id);
    if (entry.runId !== run.runId) throw new Error("This command belongs to a different task.");
    return entry;
  }

  private start(
    details: Omit<TerminalRecord, "id" | "status">,
    launch: (append: (data: string) => void) => TerminalProcess,
    runId?: string,
  ): TerminalEntry {
    if (this.removing.has(details.composerId)) throw new Error("终端正在清理，请重试。");
    const record: TerminalRecord = { ...details, id: randomUUID(), status: "running" };
    const process = launch((data) => this.append(record.id, data));
    const entry: TerminalEntry = { record, runId, process, data: "", offset: 0, emitted: 0 };
    this.entries.set(record.id, entry);
    this.starts++;
    this.sendRecord(record);
    this.onActivityChanged();
    void process.done.then((exit) => this.finish(entry, exit));
    return entry;
  }

  private sendRecord(record: TerminalRecord): void {
    this.broadcast({ type: "updated", record });
  }

  private append(id: string, data: string): void {
    const entry = this.entries.get(id);
    if (!entry || !data) return;
    entry.data = (entry.data + data.slice(-TERMINAL_BACKLOG_LIMIT)).slice(-TERMINAL_BACKLOG_LIMIT);
    entry.offset += data.length;
    entry.pending ??= setTimeout(() => this.flush(entry), TERMINAL_FLUSH_MS);
  }

  private flush(entry: TerminalEntry): void {
    clearTimeout(entry.pending);
    entry.pending = undefined;
    if (entry.offset === entry.emitted) return;
    const first = entry.offset - entry.data.length;
    const offset = Math.max(first, entry.emitted);
    entry.emitted = entry.offset;
    this.broadcast({
      type: "output",
      composerId: entry.record.composerId,
      id: entry.record.id,
      output: { offset, data: entry.data.slice(offset - first) },
    });
  }

  private finish(entry: TerminalEntry, { exitCode, error }: TerminalExit): void {
    this.flush(entry);
    const stopped = entry.record.status === "stopping";
    entry.process = null;
    entry.record = {
      ...entry.record,
      status: stopped ? "stopped" : exitCode === 0 ? "success" : "failed",
      exitCode,
      error: stopped ? undefined : error,
    };
    this.sendRecord(entry.record);
    this.onActivityChanged();
    const finished = [...this.entries.values()].filter((candidate) => !candidate.process);
    for (const { record } of finished.slice(
      0,
      Math.max(0, finished.length - TERMINAL_FINISHED_LIMIT),
    ))
      this.remove(record);
  }

  private remove({ composerId, id }: TerminalRecord): void {
    this.entries.delete(id);
    this.broadcast({ type: "removed", composerId, id });
  }

  private stopEntry(entry: TerminalEntry): Promise<void> {
    const process = entry.process;
    if (!process) return Promise.resolve();
    return (entry.stopping ??= this.terminate(entry, process).finally(() => {
      entry.stopping = undefined;
    }));
  }

  private async terminate(entry: TerminalEntry, process: TerminalProcess): Promise<void> {
    entry.record = { ...entry.record, status: "stopping", error: undefined };
    this.sendRecord(entry.record);
    const wait = new AbortController();
    try {
      await process.stop();
      await Promise.race([
        process.done,
        delay(TERMINAL_STOP_TIMEOUT_MS, undefined, { signal: wait.signal }).then(() => {
          throw new Error("未能确认终端进程已结束。请重试停止。");
        }),
      ]);
    } catch (error) {
      if (entry.process) {
        entry.record = {
          ...entry.record,
          status: "running",
          error: "未能确认终端进程已结束。请重试停止。",
        };
        this.sendRecord(entry.record);
        throw error;
      }
    } finally {
      wait.abort();
    }
  }

  private async stopWhere(matches: (entry: TerminalEntry) => boolean): Promise<void> {
    const results = await Promise.allSettled(
      [...this.entries.values()].filter(matches).map((entry) => this.stopEntry(entry)),
    );
    const failure = results.find((result) => result.status === "rejected");
    if (failure) throw failure.reason;
  }
}
