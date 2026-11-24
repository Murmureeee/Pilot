// @env node
import { randomUUID } from "node:crypto";
import { stripVTControlCharacters } from "node:util";
import type {
  RunRef,
  VerificationResult,
  VerificationState,
  VerificationStatus,
} from "@shared/contract";
import { launchVerification, stopVerificationProcess, verificationCommands } from "./commands";
import { VERIFICATION_OUTPUT_LIMIT, VERIFICATION_UPDATE_INTERVAL_MS } from "./constants";
import { VerificationHistory } from "./history";
import type { ActiveVerification, VerificationRequest } from "./types";

export class VerificationManager {
  private readonly history: VerificationHistory;
  private readonly active = new Map<string, ActiveVerification>();

  constructor(
    directory: string,
    private readonly broadcast: (result: VerificationResult) => void,
    private readonly onActivityChanged?: () => void,
  ) {
    this.history = new VerificationHistory(directory);
  }

  state(sessionId: string | null, workingDirectory: string | null): VerificationState {
    return {
      workingDirectory,
      commands: verificationCommands(workingDirectory),
      runs: sessionId ? this.history.list(sessionId) : [],
    };
  }

  result(ref: RunRef): VerificationResult {
    const result = this.history.get(ref);
    if (!result) throw new Error("找不到这次验证。");
    return result;
  }

  start(request: VerificationRequest): VerificationResult {
    const { sessionId } = request;
    if (this.active.has(sessionId)) throw new Error("此会话已有验证命令在运行。");
    const runId = randomUUID();
    const initial: VerificationResult = {
      ...request,
      runId,
      task: request.task ?? { taskId: runId },
      status: "running",
      startedAt: Date.now(),
      durationMs: 0,
      exitCode: null,
      output: "",
      revision: 0,
    };
    this.history.save(initial);
    const started = performance.now();
    const done = Promise.withResolvers<VerificationResult>();
    let entry: ActiveVerification;
    try {
      entry = { result: initial, child: launchVerification(request), started, done };
    } catch (cause) {
      return this.publish({
        ...initial,
        durationMs: Math.round(performance.now() - started),
        status: "failed",
        error: cause instanceof Error ? cause.message : String(cause),
      });
    }
    this.active.set(sessionId, entry);
    this.onActivityChanged?.();
    this.broadcast(initial);

    const collect = (chunk: string): void => {
      const output = entry.result.output + chunk;
      entry.result = {
        ...entry.result,
        output: output.slice(-VERIFICATION_OUTPUT_LIMIT),
        truncated: output.length > VERIFICATION_OUTPUT_LIMIT ? true : entry.result.truncated,
      };
      entry.update ??= setTimeout(() => {
        entry.update = undefined;
        this.flush(entry);
      }, VERIFICATION_UPDATE_INTERVAL_MS);
    };
    const finish = (exitCode: number | null, error?: string): void => {
      if (this.active.get(sessionId) !== entry) return;
      this.active.delete(sessionId);
      clearTimeout(entry.update);
      this.onActivityChanged?.();
      const status = entry.stopReason ?? (exitCode === 0 ? "success" : "failed");
      done.resolve(this.flush(entry, { status, exitCode, error }));
    };
    entry.child.stdout.setEncoding("utf8").on("data", collect);
    entry.child.stderr.setEncoding("utf8").on("data", collect);
    entry.child.once("error", (error) => finish(null, error.message));
    entry.child.once("close", (code, signal) =>
      finish(code, signal && !entry.stopReason ? signal : undefined),
    );
    return initial;
  }

  rerun(ref: RunRef): VerificationResult {
    const { sessionId, shell, task, kind, workingDirectory, command } = this.result(ref);
    return this.start({
      sessionId,
      shell,
      task,
      kind,
      workingDirectory,
      command,
      rerunOf: ref.runId,
    });
  }

  private publish(result: VerificationResult): VerificationResult {
    const saved: VerificationResult = {
      ...result,
      output: stripVTControlCharacters(result.output),
      revision: result.revision + 1,
      saveError: undefined,
    };
    try {
      this.history.save(saved);
    } catch {
      saved.saveError = "无法保存此验证结果。";
      this.history.remember(saved);
    }
    this.broadcast(saved);
    return saved;
  }

  private flush(
    entry: ActiveVerification,
    changes?: Pick<VerificationResult, "status" | "exitCode" | "error">,
  ): VerificationResult {
    const updated = this.publish({
      ...entry.result,
      ...changes,
      durationMs: Math.round(performance.now() - entry.started),
    });
    // Preserve any partial escape sequence until the next stream chunk arrives.
    entry.result = { ...updated, output: entry.result.output };
    return updated;
  }

  async stop(ref: RunRef): Promise<VerificationResult> {
    const entry = this.active.get(ref.sessionId);
    if (entry?.result.runId !== ref.runId) return this.result(ref);
    return this.stopEntry(entry, "stopped");
  }

  private async stopEntry(
    entry: ActiveVerification,
    reason: Extract<VerificationStatus, "stopped" | "interrupted">,
  ): Promise<VerificationResult> {
    if (entry.stopReason) return entry.done.promise;
    if (entry.child.exitCode !== null || entry.child.signalCode !== null) return entry.done.promise;
    entry.stopReason = reason;
    clearTimeout(entry.update);
    entry.update = undefined;
    this.flush(entry, { status: "stopping", exitCode: null });
    try {
      await stopVerificationProcess(entry.child);
    } catch (error) {
      if (this.active.get(entry.result.sessionId) !== entry) return entry.done.promise;
      entry.stopReason = undefined;
      this.flush(entry, { status: "running", exitCode: null });
      throw error;
    }
    return entry.done.promise;
  }

  async remove(sessionId: string): Promise<void> {
    const entry = this.active.get(sessionId);
    if (entry) await this.stopEntry(entry, "stopped");
    this.history.remove(sessionId);
  }

  hasActiveRuns(): boolean {
    return this.active.size > 0;
  }

  async stopAll(): Promise<void> {
    const stopped = await Promise.allSettled(
      [...this.active.values()].map((entry) => this.stopEntry(entry, "interrupted")),
    );
    for (const result of stopped) {
      if (result.status === "rejected") throw result.reason;
      if (result.value.saveError) throw new Error(result.value.saveError);
    }
  }
}
