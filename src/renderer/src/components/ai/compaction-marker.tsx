// @env browser
import { Minimize2Icon } from "lucide-react";
import type { JSX } from "react";

import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@renderer/components/ui/trace";
import { t, useLocale } from "@renderer/lib/i18n";
import type { ContextCompaction } from "@shared/contract";

export function CompactionMarker({ compaction }: { compaction: ContextCompaction }): JSX.Element {
  const locale = useLocale();
  return (
    <Trace data-context-compaction>
      <TraceCollapsible>
        <TraceCollapsibleTrigger>
          <TraceLine>
            <TraceIcon>
              <Minimize2Icon />
            </TraceIcon>
            <TraceTitle>{t("已压缩上下文", locale)}</TraceTitle>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent>
          <div className="grid gap-2 pl-5 text-xs leading-5 text-muted-foreground">
            {compaction.summary && (
              <p className="max-h-48 overflow-auto overscroll-contain wrap-anywhere whitespace-pre-wrap">
                {compaction.summary}
              </p>
            )}
            {compaction.trimmedTools > 0 && (
              <p>
                {t("上下文中已缩短 {0} 条工具输出，可在对应工具步骤查看原文。", locale, [
                  compaction.trimmedTools,
                ])}
              </p>
            )}
          </div>
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}
