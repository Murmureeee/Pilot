// @env node
import type { RenderProcessGoneDetails } from "electron";

import type { LogLevel } from "@shared/contract";

import type { SAFE_ERROR_CODES, SAFE_ERROR_NAMES } from "./constants";

export type LogSeverity = Exclude<LogLevel, "off">;
export type LogSource = "main" | "renderer" | "updater";
export interface LogDetails {
  errorName?: (typeof SAFE_ERROR_NAMES)[number];
  code?: (typeof SAFE_ERROR_CODES)[number] | number;
  line?: number;
  reason?: RenderProcessGoneDetails["reason"] | "unresponsive";
  version?: string;
}
