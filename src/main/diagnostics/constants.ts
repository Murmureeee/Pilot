// @env node
export const LOG_FILE_NAME = "pilot.log";
export const RUN_MARKER_NAME = ".running";
export const SAFE_PROCESS_REASONS = [
  "clean-exit",
  "abnormal-exit",
  "killed",
  "crashed",
  "oom",
  "launch-failed",
  "integrity-failure",
  "memory-eviction",
  "unresponsive",
] as const;
export const SAFE_CHILD_PROCESS_TYPES = [
  "Utility",
  "Zygote",
  "Sandbox helper",
  "GPU",
  "Pepper Plugin",
  "Pepper Plugin Broker",
  "Unknown",
] as const;
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
