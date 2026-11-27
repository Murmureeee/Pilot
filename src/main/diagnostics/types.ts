// @env node
import type { DiagnosticEvent } from "@shared/contract";

import type {
  SAFE_CHILD_PROCESS_TYPES,
  SAFE_ERROR_CODES,
  SAFE_ERROR_NAMES,
  SAFE_PROCESS_REASONS,
} from "./constants";

export interface LogDetails {
  errorName?: (typeof SAFE_ERROR_NAMES)[number];
  code?: (typeof SAFE_ERROR_CODES)[number] | number;
  line?: number;
  reason?: (typeof SAFE_PROCESS_REASONS)[number];
  version?: string;
  processType?: (typeof SAFE_CHILD_PROCESS_TYPES)[number];
}

export interface DiagnosticReport {
  runtime: {
    app: string | undefined;
    electron: string | undefined;
    node: string | undefined;
    platform: string;
    arch: string;
  };
  events: DiagnosticEvent[];
}
