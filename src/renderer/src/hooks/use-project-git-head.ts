// @env browser
import { useEffect, useState } from "react";

import { useAgentStore } from "@renderer/stores/agent";
import type { ProjectGitHead } from "@shared/contract";

/** 分支可能在应用外被切换，所以任务结束和窗口重新获得焦点时都重新读取。 */
export function useProjectGitHead(directory: string | null): ProjectGitHead | null {
  const [state, setState] = useState<{ directory: string; head: ProjectGitHead | null }>();

  useEffect(() => {
    if (!directory) return;
    let request = 0;
    const refresh = (): void => {
      const current = ++request;
      void window.pi.sessionGitHead(directory).then(
        (head) => {
          if (current === request) setState({ directory, head });
        },
        () => {
          if (current === request) setState({ directory, head: null });
        },
      );
    };
    refresh();
    window.addEventListener("focus", refresh);
    const unsubscribe = useAgentStore.subscribe((next, previous) => {
      if (next.status === "idle" && previous.status !== "idle") refresh();
    });
    return () => {
      request++;
      window.removeEventListener("focus", refresh);
      unsubscribe();
    };
  }, [directory]);

  return state?.directory === directory ? state.head : null;
}
