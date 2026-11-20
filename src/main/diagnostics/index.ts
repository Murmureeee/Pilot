// @env node
import { appendFileSync, existsSync, lstatSync, mkdirSync, renameSync } from "node:fs";
import { join } from "node:path";
import { LOG_FILE_COUNT, LOG_FILE_MAX_BYTES, LOG_LEVELS } from "../../shared/constants";
import type { LogLevel } from "../../shared/contract";
import { LOG_FILE_NAME, SAFE_ERROR_CODES, SAFE_ERROR_NAMES } from "./constants";
import type { LogDetails, LogSeverity, LogSource } from "./types";

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

  constructor(
    private readonly directory: string,
    private level: LogLevel,
    private readonly maxBytes = LOG_FILE_MAX_BYTES,
  ) {
    this.file = join(directory, LOG_FILE_NAME);
  }

  setLevel(level: LogLevel): void {
    this.level = level;
  }

  write(level: LogSeverity, source: LogSource, event: string, details: LogDetails = {}): void {
    if (LOG_LEVELS.indexOf(level) > LOG_LEVELS.indexOf(this.level)) return;

    // Store only diagnostic metadata. Error messages, URLs, and tool data can contain secrets.
    const { errorName, code, line, reason, version } = details;
    const entry =
      JSON.stringify({
        time: new Date().toISOString(),
        level,
        source,
        event,
        errorName,
        code,
        line,
        reason,
        version,
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
