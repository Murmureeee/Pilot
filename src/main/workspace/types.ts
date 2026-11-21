// @env node
import type { FileChangeSummary, FileDiff, GitChange, GitRollbackConflict } from "@shared/contract";

export type RecordedFileChange = {
  summary: FileChangeSummary;
  absolutePath: string;
  workingDirectory?: string;
  snapshot?: { before: string | null; afterHash: string; diff: FileDiff };
};

export interface GitEntry extends Omit<GitChange, "origin" | "resolved"> {
  fingerprint: string | null;
  headBlob?: string;
  indexBlob?: string;
  indexMode?: string;
  worktreeMode?: string;
  worktree?: WorktreeFingerprint;
}

export type GitSnapshot = GitWorktree | { unavailable: true } | null;

export interface GitWorktree {
  root: string;
  head: string;
  format: GitObjectFormat;
  entries: GitEntry[];
}

export type GitObjectFormat = "sha1" | "sha256";

export interface WorktreeFingerprint {
  blob: string;
  mode: "file" | "symlink";
  lfBlob?: string;
}

export type GitFileState = { text: string; mode: number } | null;

export interface GitCheckpointBase {
  index: Map<string, string>;
  known: Set<string>;
  ignored: string[];
  files: Map<string, GitFileState>;
}

export interface GitCommandObservation {
  before: GitSnapshot;
  after: GitSnapshot;
}

export interface LineRange {
  start: number;
  end: number;
}

export interface GitCheckpointFile {
  path: string;
  before?: GitFileState;
  after?: GitFileState;
  index: string;
  revision: string;
  conflict?: GitRollbackConflict;
  userEdits?: LineRange[];
}

export interface GitTaskCheckpoint {
  id: string;
  snapshot: GitWorktree;
  files: GitCheckpointFile[];
  pending?: { path: string; after: GitFileState; revision: string };
}

export interface GitRollbackOperation {
  token: string;
  sessionId: string;
  checkpointId: string;
  file: GitCheckpointFile;
  after: GitFileState;
}
