// @env browser
import { useEffect, useState, type JSX } from "react";

import { Trace, TraceDescription, TraceLine, TraceTitle } from "@renderer/components/ui/trace";
import { formatElapsed } from "@renderer/lib/duration";
import { t, useLocale } from "@renderer/lib/i18n";
import { selectCurrentRun, useAgentStore } from "@renderer/stores/agent";

/** 对话流末尾的等待提示：模型还没有产出正文、思考或工具步骤时出现。 */
export function WorkingLine({ startedAt }: { startedAt?: number }): JSX.Element | null {
  const locale = useLocale();
  // 重试倒计时、压缩、审批和停止由输入坞状态行说明，这里不重复。
  const waiting = useAgentStore((state) => {
    const run = selectCurrentRun(state);
    return state.status === "streaming" && !run?.retry && !run?.compacting;
  });
  // 用户消息刚发出时还没有回合计时，从这一行出现时起算。
  const [mountedAt] = useState(Date.now);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!waiting) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [waiting]);
  if (!waiting) return null;
  const elapsed = now - (startedAt ?? mountedAt);
  return (
    <Trace data-reply-working>
      <TraceLine status="running" role="status">
        <TraceTitle>{t("正在思考…", locale)}</TraceTitle>
        {/* 每秒变化的读数不进读屏播报。 */}
        {elapsed >= 1000 && (
          <TraceDescription aria-hidden="true">{formatElapsed(elapsed, locale)}</TraceDescription>
        )}
      </TraceLine>
    </Trace>
  );
}
