// @env node
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  rmdirSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import type { RunRef, VerificationResult, VerificationRun } from "@shared/contract";

export class VerificationHistory {
  private readonly runs = new Map<string, Map<string, VerificationResult>>();

  constructor(private readonly directory: string) {}

  private session(id: string): Map<string, VerificationResult> {
    const cached = this.runs.get(id);
    if (cached) return cached;
    const directory = join(this.directory, id);
    const runs = new Map<string, VerificationResult>();
    if (existsSync(directory)) {
      for (const entry of readdirSync(directory, { withFileTypes: true })) {
        if (!entry.isFile() || !/^[a-f0-9-]{36}\.json$/i.test(entry.name)) continue;
        try {
          const run = JSON.parse(
            readFileSync(join(directory, entry.name), "utf8"),
          ) as VerificationResult;
          if (
            run.sessionId !== id ||
            run.runId + ".json" !== entry.name ||
            typeof run.output !== "string"
          )
            continue;
          if (run.status === "running" || run.status === "stopping") {
            run.status = "interrupted";
            run.revision++;
          }
          runs.set(run.runId, run);
        } catch {
          // A damaged run record does not hide the rest of the session history.
          continue;
        }
      }
    }
    this.runs.set(id, runs);
    return runs;
  }

  list(id: string): VerificationRun[] {
    return [...this.session(id).values()]
      .sort((a, b) => b.startedAt - a.startedAt)
      .map(({ output: _output, truncated: _truncated, ...run }) => run);
  }

  get({ sessionId, runId }: RunRef): VerificationResult | undefined {
    return this.session(sessionId).get(runId);
  }

  save(result: VerificationResult): void {
    const runs = this.session(result.sessionId);
    const directory = join(this.directory, result.sessionId);
    const path = join(directory, result.runId + ".json");
    const temporary = path + ".tmp";
    mkdirSync(directory, { recursive: true });
    writeFileSync(temporary, JSON.stringify(result), { encoding: "utf8", flush: true });
    renameSync(temporary, path);
    runs.set(result.runId, result);
  }

  remember(result: VerificationResult): void {
    this.session(result.sessionId).set(result.runId, result);
  }

  remove(sessionId: string): void {
    const directory = join(this.directory, sessionId);
    if (existsSync(directory)) {
      for (const name of readdirSync(directory)) {
        if (/^[a-f0-9-]{36}\.json(?:\.tmp)?$/i.test(name))
          rmSync(join(directory, name), { force: true });
      }
      rmdirSync(directory);
    }
    this.runs.delete(sessionId);
  }
}
