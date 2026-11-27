// @env node
import {
  appendFileSync,
  existsSync,
  lstatSync,
  mkdirSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";

import {
  DIAGNOSTIC_EVENTS,
  LOG_FILE_COUNT,
  LOG_FILE_MAX_BYTES,
  LOG_LEVELS,
} from "../../shared/constants";
import type { DiagnosticEvent, DiagnosticSource, LogLevel } from "../../shared/contract";
import { LOG_FILE_NAME, RUN_MARKER_NAME, SAFE_ERROR_CODES, SAFE_ERROR_NAMES } from "./constants";
import { readEventLines, readRecentEvents, safeDetails, safeVersion } from "./events";
import type { DiagnosticReport, LogDetails } from "./types";

export function errorDetails(error: unknown): LogDetails {
  if (!(error instanceof Error)) return {};
  const code = (error as NodeJS.ErrnoException).code;
  return {
    errorName: SAFE_ERROR_NAMES.find((name) => name === error.name) ?? "Error",
    code: SAFE_ERROR_CODES.find((value) => value === code),
  };
}

export class DiagnosticLog {
  private writeFailed = false;
  private readonly file: string;
  private readonly marker: string;
  private running = false;

  constructor(
    private readonly directory: string,
    private level: LogLevel,
    private readonly maxBytes = LOG_FILE_MAX_BYTES,
  ) {
    this.file = join(directory, LOG_FILE_NAME);
    this.marker = join(directory, RUN_MARKER_NAME);
  }

  setLevel(level: LogLevel): void {
    const wasOff = this.level === "off";
    this.level = level;
    if (this.running && wasOff !== (level === "off")) this.trackRun();
  }

  startRun(version: string): void {
    this.running = true;
    if (existsSync(this.marker)) this.write("error", "main", "previous-run-interrupted");
    this.trackRun();
    this.write("info", "main", "startup", { version });
  }

  finishRun(): void {
    this.running = false;
    this.trackRun();
    this.write("info", "main", "quit");
  }

  private trackRun(): void {
    try {
      if (this.running && this.level !== "off") {
        mkdirSync(this.directory, { recursive: true, mode: 0o700 });
        if (!existsSync(this.marker)) writeFileSync(this.marker, "", { flag: "wx", mode: 0o600 });
      } else {
        rmSync(this.marker, { force: true });
      }
    } catch {
      console.warn("[diagnostics] Unable to update the local run marker");
    }
  }

  async events(limit = Infinity): Promise<DiagnosticEvent[]> {
    const files = await Promise.all(
      Array.from({ length: LOG_FILE_COUNT }, (_, index) =>
        readEventLines(index === 0 ? this.file : `${this.file}.${index}`, this.maxBytes),
      ),
    );
    return readRecentEvents(files, limit);
  }

  async report(version: string): Promise<DiagnosticReport> {
    return {
      runtime: {
        app: safeVersion(version),
        electron: safeVersion(process.versions.electron),
        node: safeVersion(process.versions.node),
        platform: process.platform,
        arch: process.arch,
      },
      events: await this.events(),
    };
  }

  write<S extends DiagnosticSource>(
    level: DiagnosticEvent["level"],
    source: S,
    event: (typeof DIAGNOSTIC_EVENTS)[S][number],
    details: LogDetails = {},
  ): void {
    if (LOG_LEVELS.indexOf(level) > LOG_LEVELS.indexOf(this.level)) return;

    const entry =
      JSON.stringify({
        time: new Date().toISOString(),
        level,
        source,
        event,
        ...safeDetails(details),
      }) + "\n";
    const bytes = Buffer.byteLength(entry);
    if (bytes > this.maxBytes) return;

    try {
      mkdirSync(this.directory, { recursive: true, mode: 0o700 });
      const current = lstatSync(this.file, { throwIfNoEntry: false });
      if (current && !current.isFile()) throw new Error("The diagnostic log is not a file");
      if (current && current.size + bytes > this.maxBytes) {
        for (let index = LOG_FILE_COUNT - 1; index >= 1; index -= 1) {
          const previous = index === 1 ? this.file : `${this.file}.${index - 1}`;
          if (existsSync(previous)) renameSync(previous, `${this.file}.${index}`);
        }
      }
      appendFileSync(this.file, entry, { mode: 0o600 });
      this.writeFailed = false;
    } catch {
      if (!this.writeFailed) console.warn("[diagnostics] Unable to write the local log");
      this.writeFailed = true;
    }
  }
}
