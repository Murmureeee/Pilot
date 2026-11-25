// @env browser
import { useCallback, useEffect, useRef, useState } from "react";

import type { GitReview } from "@renderer/lib/types";
import type { GitChangesView } from "@shared/contract";

export function useGitReview(
  composerId: string | null,
  directory: string | null,
  live = true,
): GitReview {
  const requestRefresh = useRef<() => void>(null);
  const [response, setResponse] = useState<{
    composerId: string;
    directory: string;
    view: GitChangesView | null | undefined;
    error: string | null;
  }>();
  const refresh = useCallback((): void => requestRefresh.current?.(), []);

  useEffect(() => {
    if (!composerId || !directory) return;
    let disposed = false;
    let reading = false;
    let queued = false;
    const read = async (): Promise<void> => {
      if (reading) {
        queued = true;
        return;
      }
      reading = true;
      do {
        queued = false;
        try {
          const view = await window.pi.sessionGitChanges(composerId, live);
          if (disposed) break;
          if (!queued) setResponse({ composerId, directory, view, error: null });
        } catch (cause) {
          if (disposed) break;
          if (!queued) {
            const error = cause instanceof Error ? cause.message : String(cause);
            setResponse((previous) => ({
              composerId,
              directory,
              view:
                previous?.composerId === composerId && previous.directory === directory
                  ? previous.view
                  : undefined,
              error,
            }));
          }
        }
      } while (queued);
      reading = false;
    };
    const onFocus = (): void => void read();
    requestRefresh.current = onFocus;
    const unsubscribe = window.pi.onAgentEvent((event) => {
      if (
        "run" in event &&
        event.run.sessionId === composerId &&
        (event.type === "run_started" ||
          event.type === "tool_end" ||
          (event.type === "status" && event.status === "idle"))
      )
        void read();
    });
    window.addEventListener("focus", onFocus);
    void read();
    return () => {
      disposed = true;
      requestRefresh.current = null;
      unsubscribe();
      window.removeEventListener("focus", onFocus);
    };
  }, [composerId, directory, live]);

  const current =
    response?.composerId === composerId && response.directory === directory ? response : undefined;
  return { view: current?.view, error: current?.error ?? null, refresh };
}
