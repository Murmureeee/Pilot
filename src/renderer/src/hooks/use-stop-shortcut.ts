// @env browser
import { useCallback, useEffect, useRef, useState } from "react";

import { STOP_SHORTCUT_WINDOW_MS } from "@renderer/lib/constants";
import { useAgentStore } from "@renderer/stores/agent";
import type { RunRef } from "@shared/contract";

export function useStopShortcut(runId: string | null): {
  showHint: boolean;
  press(run: RunRef): void;
  clear(): void;
} {
  const [armedRun, setArmedRun] = useState<string | null>(null);
  const pending = useRef<{ runId: string; deadline: number; timer: number }>(null);

  const clear = useCallback((): void => {
    if (!pending.current) return;
    window.clearTimeout(pending.current.timer);
    pending.current = null;
    setArmedRun(null);
  }, []);

  const press = useCallback(
    (run: RunRef): void => {
      const now = performance.now();
      if (pending.current?.runId === run.runId && pending.current.deadline >= now) {
        clear();
        useAgentStore.getState().abort(run);
        return;
      }
      clear();
      pending.current = {
        runId: run.runId,
        deadline: now + STOP_SHORTCUT_WINDOW_MS,
        timer: window.setTimeout(clear, STOP_SHORTCUT_WINDOW_MS),
      };
      setArmedRun(run.runId);
    },
    [clear],
  );

  useEffect(() => {
    if (runId === null) return;
    const reset = (): void => clear();
    window.addEventListener("blur", reset);
    window.addEventListener("pointerdown", reset);
    return () => {
      clear();
      window.removeEventListener("blur", reset);
      window.removeEventListener("pointerdown", reset);
    };
  }, [runId, clear]);

  return { showHint: runId !== null && armedRun === runId, press, clear };
}
