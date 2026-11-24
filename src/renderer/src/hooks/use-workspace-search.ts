// @env browser
import { useEffect, useState } from "react";

import type { WorkspaceSearchResult } from "@renderer/lib/types";
import { WORKSPACE_QUERY_LENGTH } from "@shared/constants";
import type { WorkspaceEntry } from "@shared/contract";

export function useWorkspaceSearch(
  workingDirectory: string | null,
  query: string | null,
): { entries: WorkspaceEntry[]; pending: boolean; error?: string } {
  const [result, setResult] = useState<WorkspaceSearchResult | null>(null);
  const needle = query?.trim().slice(0, WORKSPACE_QUERY_LENGTH) ?? null;

  useEffect(() => {
    if (workingDirectory === null || needle === null) return;
    let cancelled = false;
    const timeout = window.setTimeout(() => {
      void window.pi.searchWorkspace(needle, workingDirectory).then(
        (entries) => {
          if (!cancelled) setResult({ workingDirectory, query: needle, entries });
        },
        (error: unknown) => {
          if (!cancelled) {
            setResult({
              workingDirectory,
              query: needle,
              entries: [],
              error: error instanceof Error ? error.message : String(error),
            });
          }
        },
      );
    }, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(timeout);
    };
  }, [workingDirectory, needle]);

  if (workingDirectory === null || needle === null) return { entries: [], pending: false };
  if (result?.workingDirectory !== workingDirectory || result.query !== needle) {
    return { entries: [], pending: true };
  }
  return { entries: result.entries, pending: false, error: result.error };
}
