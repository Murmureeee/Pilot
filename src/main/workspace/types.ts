// @env node
import type { FileChangeSummary, FileDiff, GitChange } from "@shared/contract";

export type RecordedFileChange = {
  summary: FileChangeSummary;
  absolutePath: string;
  workingDirectory?: string;
  snapshot?: { before: string | null; afterHash: string; diff: FileDiff };
};

export interface GitEntry extends Omit<GitChange, "origin" | "resolved"> {
  fingerprint: string | null;
  indexBlob?: string;
  indexMode?: string;
  worktreeMode?: string;
  worktree?: WorktreeFingerprint;
}

export type GitSnapshot =
  | { root: string; head: string; entries: GitEntry[] }
  | { unavailable: true }
  | null;

export type GitObjectFormat = "sha1" | "sha256";

export interface WorktreeFingerprint {
  blob: string;
  mode: "file" | "symlink";
  lfBlob?: string;
}
