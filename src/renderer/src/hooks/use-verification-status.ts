// @env browser
import { useEffect, useState } from "react";

import type { VerificationIndicator } from "@renderer/lib/types";
import type { VerificationStatus } from "@shared/contract";

export function useVerificationStatus(composerId: string | null): VerificationStatus | undefined {
  const [current, setCurrent] = useState<{ composerId: string; status: VerificationStatus }>();

  useEffect(() => {
    if (!composerId) return;
    let disposed = false;
    let latest: VerificationIndicator | undefined;
    const receive = (run: VerificationIndicator): void => {
      if (disposed) return;
      if (
        latest &&
        (latest.runId === run.runId
          ? latest.revision > run.revision
          : latest.startedAt > run.startedAt)
      )
        return;
      const previous = latest?.status;
      latest = run;
      if (previous !== run.status) setCurrent({ composerId, status: run.status });
    };
    const unsubscribe = window.pi.onAgentEvent((event) => {
      if (event.type === "verification_updated" && event.result.sessionId === composerId)
        receive(event.result);
    });
    void window.pi.sessionVerification(composerId).then(
      ({ runs }) => {
        const run =
          runs.find(({ status }) => status === "running" || status === "stopping") ?? runs[0];
        if (run) receive(run);
      },
      () => {
        // The verification tab reports read errors alongside its retry action.
      },
    );
    return () => {
      disposed = true;
      unsubscribe();
    };
  }, [composerId]);

  return current?.composerId === composerId ? current.status : undefined;
}
