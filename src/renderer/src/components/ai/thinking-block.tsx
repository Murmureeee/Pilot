// @env browser
import { cn } from "cn";
import { BrainIcon } from "lucide-react";
import { useState, type JSX } from "react";

import {
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@renderer/components/ui/trace";
import { t, useLocale } from "@renderer/lib/i18n";
import type { UiPart } from "@shared/contract";

import { Response } from "./response";

export function ThinkingBlock({
  part,
}: {
  part: Extract<UiPart, { type: "thinking" }>;
}): JSX.Element {
  const locale = useLocale();
  const [open, setOpen] = useState<boolean | null>(null);
  const streaming = part.streaming === true;
  const seconds =
    part.durationMs === undefined ? null : Math.max(0.1, Math.round(part.durationMs / 100) / 10);
  const label = streaming
    ? t("思考中…", locale)
    : seconds === null
      ? t("已完成思考", locale)
      : t("已完成思考，用时 {0} 秒", locale, [seconds]);
  const line = (
    <TraceLine
      status={streaming ? "running" : undefined}
      data-thinking-state={streaming ? "streaming" : "complete"}
    >
      <TraceIcon>
        <BrainIcon />
      </TraceIcon>
      <TraceTitle>{label}</TraceTitle>
    </TraceLine>
  );
  if (!part.text) return line;

  return (
    <TraceCollapsible open={open ?? streaming} onOpenChange={setOpen}>
      <TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
      <TraceCollapsibleContent>
        <div
          className={cn(
            "min-w-0 text-[13px] leading-6",
            !streaming && "max-h-80 overflow-y-auto overscroll-contain",
          )}
        >
          <Response content={part.text} />
        </div>
      </TraceCollapsibleContent>
    </TraceCollapsible>
  );
}
