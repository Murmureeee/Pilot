// @env browser
import { ListTreeIcon } from "lucide-react";
import { useState, type JSX, type ReactNode } from "react";

import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@renderer/components/ui/trace";
import { STEP_COUNT_LABELS } from "@renderer/lib/constants";
import { t, useLocale } from "@renderer/lib/i18n";
import type { StepCount } from "@renderer/lib/types";

/** 两段正文之间的连续步骤，折成一行「读取 5 个文件 · 运行 1 条命令」。 */
export function StepGroup({
  counts,
  failed,
  autoOpen,
  reveal,
  children,
}: {
  counts: readonly StepCount[];
  failed: number;
  autoOpen: boolean;
  reveal: boolean;
  children: ReactNode;
}): JSX.Element {
  const locale = useLocale();
  // 用户手动开合过就以用户为准，否则跟随回合进度自动收起。
  const [open, setOpen] = useState<boolean | null>(null);
  const title = counts
    .map(({ kind, count }) => t(STEP_COUNT_LABELS[kind][count === 1 ? 0 : 1], locale, [count]))
    .join(" · ");
  return (
    <TraceCollapsible open={reveal || (open ?? autoOpen)} onOpenChange={setOpen}>
      <TraceCollapsibleTrigger>
        <TraceLine>
          <TraceIcon>
            <ListTreeIcon />
          </TraceIcon>
          <TraceTitle title={title}>{title}</TraceTitle>
          {failed > 0 && (
            <TraceDescription className="text-destructive">
              {t("{0} 步失败", locale, [failed])}
            </TraceDescription>
          )}
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent>
        <Trace>{children}</Trace>
      </TraceCollapsibleContent>
    </TraceCollapsible>
  );
}
