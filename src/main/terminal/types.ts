// @env node
import type { TerminalRecord, TerminalSize } from "../../shared/contract";

export interface TerminalExit {
  exitCode?: number;
  error?: string;
}

export interface TerminalProcess {
  done: Promise<TerminalExit>;
  ready?: Promise<void>;
  stop(): void | Promise<void>;
  write?(data: string): void;
  resize?(size: TerminalSize): void;
}

export interface TerminalEntry {
  record: TerminalRecord;
  runId?: string;
  process: TerminalProcess | null;
  stopping?: Promise<void>;
  data: string;
  offset: number;
  emitted: number;
  pending?: ReturnType<typeof setTimeout>;
}
