// @env browser
import { useId, useState, type JSX } from "react";
import { BrainIcon, ChevronRightIcon } from "lucide-react";
import { t, useLocale } from "@renderer/lib/i18n";
import type { UiPart } from "@shared/contract";
import { cn } from "cn";
import { Response } from "./response";

export function ThinkingBlock({
  part,
}: {
  part: Extract<UiPart, { type: "thinking" }>;
}): JSX.Element {
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const streaming = part.streaming === true;
  const expanded = streaming || open;
  const seconds =
    part.durationMs === undefined ? null : Math.max(0.1, Math.round(part.durationMs / 100) / 10);
  const label = streaming
    ? t("思考中…", locale)
    : seconds === null
      ? t("已完成思考", locale)
      : t("已完成思考，用时 {0} 秒", locale, [seconds]);
  const headingClass =
    "text-muted-foreground flex min-h-7 items-center gap-2 rounded-md px-1 text-left text-[13px]";
  const heading = (
    <>
      <BrainIcon aria-hidden="true" className="size-3.5 shrink-0" />
      <span>{label}</span>
      {streaming && (
        <span
          aria-hidden="true"
          className="text-emerald-600 flex items-center gap-0.5 dark:text-emerald-400"
        >
          <span className="size-1 rounded-full bg-current motion-safe:animate-bounce" />
          <span className="size-1 rounded-full bg-current [animation-delay:120ms] motion-safe:animate-bounce" />
          <span className="size-1 rounded-full bg-current [animation-delay:240ms] motion-safe:animate-bounce" />
        </span>
      )}
    </>
  );

  return (
    <section data-thinking-state={streaming ? "streaming" : "complete"} className="min-w-0">
      {streaming || !part.text ? (
        <div className={headingClass}>{heading}</div>
      ) : (
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={bodyId}
          onClick={() => setOpen((current) => !current)}
          className={cn(
            headingClass,
            "hover:bg-accent/60 focus-visible:ring-ring/40 outline-none focus-visible:ring-2",
          )}
        >
          {heading}
          <ChevronRightIcon
            aria-hidden="true"
            className={cn(
              "size-3.5 transition-transform motion-reduce:transition-none",
              expanded && "rotate-90",
            )}
          />
        </button>
      )}
      {expanded && part.text && (
        <div
          id={bodyId}
          className={cn(
            "border-border/80 text-muted-foreground ml-2 min-w-0 border-l py-1 pl-4 text-[13px] leading-6 wrap-anywhere",
            !streaming && "max-h-80 overflow-y-auto overscroll-contain",
          )}
        >
          <Response content={part.text} />
        </div>
      )}
    </section>
  );
}
