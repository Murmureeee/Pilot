// @env browser
import type { ActiveRun, FailedRun, InterruptedRun, SessionMeta } from "@shared/contract";

import type { SessionRowStatus } from "./types";

/** 侧栏状态位每行只显示优先级最高的一种，顺序与 DESIGN 的状态模型一致。 */
export function sessionRowStatus(
  session: Pick<SessionMeta, "id" | "unread" | "lastRunResult" | "planMode">,
  activeRun: ActiveRun | null,
  interruptedRun: InterruptedRun | null,
  failedRun: FailedRun | null = null,
): SessionRowStatus | null {
  if (activeRun?.sessionId === session.id) {
    if (activeRun.status === "waiting_approval") return "approval";
    return activeRun.status === "stopping" ? "stopping" : "running";
  }
  if (failedRun?.sessionId === session.id || session.lastRunResult === "failed") return "failed";
  if (interruptedRun?.sessionId === session.id || session.lastRunResult === "interrupted")
    return "interrupted";
  if (session.planMode?.proposal) return "plan";
  return session.unread ? "unread" : null;
}

function segments(directory: string): string[] {
  return directory.replaceAll("\\", "/").replace(/\/+$/, "").split("/");
}

/** 只有文件夹同名的项目才需要上一级目录来区分，返回 目录 → 上一级目录名。 */
export function projectParents(directories: readonly string[]): Map<string, string> {
  const byName = Map.groupBy(directories, (directory) => segments(directory).at(-1) ?? "");
  const parents = new Map<string, string>();
  for (const group of byName.values()) {
    if (group.length < 2) continue;
    for (const directory of group) {
      const parent = segments(directory).at(-2);
      if (parent) parents.set(directory, parent);
    }
  }
  return parents;
}
