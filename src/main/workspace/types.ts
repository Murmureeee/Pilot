// @env node
import type { FileChangeSummary, FileDiff, GitChange, GitRollbackConflict } from "@shared/contract";

export interface GitCommandOptions {
  index?: string;
  input?: Buffer;
  timeout?: number;
  noPrompt?: true;
}

export interface GitBranchState {
  root: string;
  ref: string | null;
  commit: string | null;
}

export interface GitPushTarget {
  branch: string;
  head: string;
  remote: string;
  url: string;
  ref: string;
  trackUpstream: boolean;
}

export interface GitPushPlan {
  root: string;
  target: GitPushTarget;
  remoteRevision: string;
}

export interface GitPullRequestPlan {
  root: string;
  target: GitPushTarget;
  sourceRepository: string;
  repository: string;
  head: string;
}

export interface GitPatchHunk {
  header: string;
  newStart: number;
  delta: number;
  lines: string[];
}

export interface GitSelectionReview {
  paths: string[];
  revision?: string;
  patch: Buffer;
  partial?: { header: string; hunks: GitPatchHunk[]; diff: FileDiff };
}

export interface GitCommitTarget {
  ref: string | null;
  head: string | null;
}

export interface GitCommitPlan extends GitCommitTarget {
  root: string;
  indexPath: string;
  indexTree: string;
  tree: string;
}

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
