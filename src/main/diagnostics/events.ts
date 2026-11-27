// @env node
import { constants } from "node:fs";
import { lstat, open } from "node:fs/promises";

import { DIAGNOSTIC_EVENTS, LOG_LEVELS } from "../../shared/constants";
import type { DiagnosticEvent, DiagnosticEventName, DiagnosticSource } from "../../shared/contract";
import {
  SAFE_CHILD_PROCESS_TYPES,
  SAFE_ERROR_CODES,
  SAFE_ERROR_NAMES,
  SAFE_PROCESS_REASONS,
} from "./constants";
import type { LogDetails } from "./types";

export function safeVersion(value: unknown): string | undefined {
  return typeof value === "string" &&
    /^\d{1,4}\.\d{1,4}\.\d{1,4}(?:-(?:alpha|beta|rc)\.\d{1,4})?$/.test(value)
    ? value
    : undefined;
}

function safeNumber(value: unknown, min: number, max: number): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max
    ? value
    : undefined;
}

export function safeDetails(details: Partial<Record<keyof LogDetails, unknown>>): LogDetails {
  return {
    errorName: SAFE_ERROR_NAMES.find((name) => name === details.errorName),
    code:
      SAFE_ERROR_CODES.find((code) => code === details.code) ??
      safeNumber(details.code, -0x80000000, 0xffffffff),
    line: safeNumber(details.line, 1, 0x7fffffff),
    reason: SAFE_PROCESS_REASONS.find((reason) => reason === details.reason),
    version: safeVersion(details.version),
    processType: SAFE_CHILD_PROCESS_TYPES.find((type) => type === details.processType),
  };
}

function parseEvent(line: string): DiagnosticEvent | undefined {
  if (line.length > 1024) return;
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch {
    return;
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return;
  const { time, level, source, event, ...details } = value as Record<string, unknown>;
  const severity = LOG_LEVELS.find((option) => option === level);
  if (
    !severity ||
    severity === "off" ||
    typeof source !== "string" ||
    !Object.hasOwn(DIAGNOSTIC_EVENTS, source)
  )
    return;
  const events: readonly DiagnosticEventName[] = DIAGNOSTIC_EVENTS[source as DiagnosticSource];
  const name = events.find((option) => option === event);
  if (!name || typeof time !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(time))
    return;
  const date = new Date(time);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== time) return;
  // Older records did not vet every value on write.
  return {
    time,
    level: severity,
    source: source as DiagnosticSource,
    event: name,
    ...safeDetails(details),
  };
}

export async function readEventLines(path: string, maxBytes: number): Promise<string[]> {
  try {
    const entry = await lstat(path);
    if (!entry.isFile()) return [];
    const flags =
      process.platform === "win32"
        ? constants.O_RDONLY
        : constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
    await using file = await open(path, flags);
    const stat = await file.stat();
    if (!stat.isFile() || stat.dev !== entry.dev || stat.ino !== entry.ino) return [];
    const start = Math.max(0, stat.size - maxBytes);
    const bytes = Buffer.alloc(stat.size - start);
    const { bytesRead } = await file.read(bytes, 0, bytes.length, start);
    const lines = bytes.toString("utf8", 0, bytesRead).split("\n");
    lines.pop();
    if (start > 0) lines.shift();
    return lines;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ELOOP") return [];
    throw error;
  }
}

export function readRecentEvents(files: string[][], limit: number): DiagnosticEvent[] {
  const events: DiagnosticEvent[] = [];
  for (const lines of files) {
    for (let i = lines.length - 1; i >= 0; i--) {
      const event = parseEvent(lines[i]);
      if (event) events.push(event);
      if (events.length === limit) return events;
    }
  }
  return events;
}
