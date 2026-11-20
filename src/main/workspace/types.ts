// @env node
import type { FileChangeSummary, FileDiff } from "@shared/contract";

export type RecordedFileChange = {
  summary: FileChangeSummary;
  absolutePath: string;
  workingDirectory?: string;
  snapshot?: { before: string | null; afterHash: string; diff: FileDiff };
};
