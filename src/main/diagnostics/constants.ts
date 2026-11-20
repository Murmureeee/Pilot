// @env node
export const LOG_FILE_NAME = "pilot.log";
export const SAFE_ERROR_NAMES = [
  "Error",
  "TypeError",
  "ReferenceError",
  "SyntaxError",
  "RangeError",
  "AggregateError",
  "AbortError",
  "TimeoutError",
] as const;
export const SAFE_ERROR_CODES = [
  "EACCES",
  "EBUSY",
  "ECONNREFUSED",
  "ECONNRESET",
  "EEXIST",
  "EISDIR",
  "ENOENT",
  "ENOSPC",
  "ENOTDIR",
  "EPERM",
  "ETIMEDOUT",
  "ERR_ABORTED",
  "ERR_FAILED",
  "ERR_FILE_NOT_FOUND",
  "ERR_UPDATER_CHECKSUM_MISMATCH",
] as const;
