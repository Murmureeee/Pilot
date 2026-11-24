// @env node
import type { ChildProcessWithoutNullStreams } from "node:child_process";

import type {
  CommandShell,
  StartVerification,
  VerificationResult,
  VerificationTask,
} from "@shared/contract";

export interface VerificationRequest extends StartVerification {
  sessionId: string;
  shell: CommandShell;
  task?: VerificationTask;
  rerunOf?: string;
}

export interface ActiveVerification {
  result: VerificationResult;
  child: ChildProcessWithoutNullStreams;
  started: number;
  done: PromiseWithResolvers<VerificationResult>;
  update?: ReturnType<typeof setTimeout>;
  stopReason?: "stopped" | "interrupted";
}
