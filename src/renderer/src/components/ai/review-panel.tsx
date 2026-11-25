// @env browser
import { Tabs } from "@base-ui/react/tabs";
import { cn } from "cn";
import { ArrowLeftIcon, XIcon } from "lucide-react";
import { useLayoutEffect, useRef, useState, type JSX, type ReactNode } from "react";

import { Button } from "@renderer/components/ui/button";
import { REVIEW_PANEL_ID, REVIEW_TABS } from "@renderer/lib/constants";
import { t, useLocale } from "@renderer/lib/i18n";
import type { ReviewResizeRange, ReviewTab } from "@renderer/lib/types";
import { closeReview, useReviewStore } from "@renderer/stores/review";
import type { VerificationStatus } from "@shared/contract";

import { ChangeCount, VerificationMark } from "./review-indicators";

const RESIZE_STEP = 16;

function ResizeHandle({
  width,
  range,
  onResize,
  onSave,
}: {
  width: number;
  range: ReviewResizeRange;
  onResize(width: number): void;
  onSave(width: number): void;
}): JSX.Element {
  const locale = useLocale();
  const drag = useRef<{ pointerId: number; x: number; width: number; changed?: number }>(null);
  const clamp = (value: number): number => Math.max(range.min, Math.min(range.max, value));
  const label = t("调整审查面板宽度", locale);
  return (
    <div
      role="separator"
      aria-label={label}
      title={label}
      aria-controls={REVIEW_PANEL_ID}
      aria-orientation="vertical"
      aria-valuemin={range.min}
      aria-valuemax={range.max}
      aria-valuenow={width}
      tabIndex={0}
      className="absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize touch-none outline-none hover:bg-muted-foreground/25 focus-visible:bg-ring/45"
      onKeyDown={(event) => {
        const values: Record<string, number> = {
          ArrowLeft: width + RESIZE_STEP,
          ArrowRight: width - RESIZE_STEP,
          Home: range.min,
          End: range.max,
        };
        const next = values[event.key];
        if (next === undefined) return;
        event.preventDefault();
        const resized = clamp(next);
        if (resized === width) return;
        onResize(resized);
        onSave(resized);
      }}
      onPointerDown={(event) => {
        if (event.button !== 0 || drag.current) return;
        event.preventDefault();
        drag.current = { pointerId: event.pointerId, x: event.clientX, width };
        event.currentTarget.setPointerCapture(event.pointerId);
      }}
      onPointerMove={(event) => {
        const start = drag.current;
        if (start?.pointerId !== event.pointerId) return;
        const resized = clamp(Math.round(start.width + start.x - event.clientX));
        if (resized === (start.changed ?? start.width)) return;
        start.changed = resized;
        onResize(resized);
      }}
      onLostPointerCapture={(event) => {
        const start = drag.current;
        if (start?.pointerId !== event.pointerId) return;
        drag.current = null;
        if (start.changed !== undefined) onSave(start.changed);
      }}
    />
  );
}

export function ReviewPanel({
  open,
  overlay,
  inert,
  width,
  range,
  onResize,
  onSave,
  count,
  verificationStatus,
  feedback,
  changes,
  files,
  verification,
  terminal,
}: {
  open: boolean;
  overlay: boolean;
  inert: boolean;
  width: number;
  range: ReviewResizeRange;
  onResize(width: number): void;
  onSave(width: number): void;
  count?: number;
  verificationStatus?: VerificationStatus;
  feedback: ReactNode;
  changes: ReactNode;
  files: ReactNode;
  verification: ReactNode;
  terminal: ReactNode;
}): JSX.Element {
  const locale = useLocale();
  const tab = useReviewStore((state) => state.tab);
  const focusRequest = useReviewStore((state) => state.focusRequest);
  const selectTab = useReviewStore((state) => state.selectTab);
  const [visited, setVisited] = useState<ReviewTab[]>([]);
  const panel = useRef<HTMLElement>(null);
  const focusedRequest = useRef(0);
  const closeLabel = t("关闭审查面板", locale);
  const backLabel = t("返回对话", locale);
  const showStatus =
    verificationStatus &&
    verificationStatus !== "success" &&
    verificationStatus !== "stopped" &&
    verificationStatus !== "interrupted";
  const contents = { changes, files, verification, terminal };

  useLayoutEffect(() => {
    if (open) setVisited((tabs) => (tabs.includes(tab) ? tabs : [...tabs, tab]));
  }, [open, tab]);

  useLayoutEffect(() => {
    if (!open || inert || !panel.current) return;
    const focused = document.activeElement;
    if (focusedRequest.current !== focusRequest || (overlay && focused === document.body)) {
      focusedRequest.current = focusRequest;
      panel.current
        .querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
        ?.focus({ preventScroll: true });
    }
  }, [focusRequest, open, overlay, inert]);

  return (
    <aside
      ref={panel}
      id={REVIEW_PANEL_ID}
      hidden={!open}
      inert={inert}
      aria-label={t("审查面板", locale)}
      data-review-layout={overlay ? "overlay" : "split"}
      className={cn(
        "flex min-h-0 min-w-0 shrink-0 flex-col bg-background",
        overlay ? "absolute inset-0 z-10" : "relative border-s border-border",
        open && "motion-safe:animate-in motion-safe:slide-in-from-right-2",
      )}
      style={overlay ? undefined : { width }}
      onKeyDown={(event) => {
        if (
          event.key !== "Escape" ||
          event.defaultPrevented ||
          !event.currentTarget.contains(event.target as Node)
        )
          return;
        event.preventDefault();
        event.stopPropagation();
        closeReview();
      }}
    >
      {!overlay && <ResizeHandle width={width} range={range} onResize={onResize} onSave={onSave} />}
      <Tabs.Root
        value={tab}
        onValueChange={(value) => {
          const selected = REVIEW_TABS.find((item) => item.value === value);
          if (selected) selectTab(selected.value);
        }}
        className="flex min-h-0 flex-1 flex-col"
      >
        <header className="flex h-10 shrink-0 items-center gap-1.5 border-b border-border/65 px-2">
          {overlay && (
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={backLabel}
              title={backLabel}
              onClick={closeReview}
            >
              <ArrowLeftIcon aria-hidden="true" />
            </Button>
          )}
          <Tabs.List
            activateOnFocus
            aria-label={t("审查面板", locale)}
            className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto"
          >
            {REVIEW_TABS.map(({ value, label }) => (
              <Tabs.Tab
                key={value}
                value={value}
                className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[13px] whitespace-nowrap text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring data-active:bg-secondary data-active:text-secondary-foreground"
              >
                {t(label, locale)}
                {value === "changes" && count !== undefined && <ChangeCount count={count} />}
                {value === "verification" && showStatus && (
                  <VerificationMark status={verificationStatus} />
                )}
              </Tabs.Tab>
            ))}
          </Tabs.List>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={closeLabel}
            title={closeLabel}
            onClick={closeReview}
          >
            <XIcon aria-hidden="true" />
          </Button>
        </header>
        {feedback}
        {REVIEW_TABS.map(({ value }) => (
          <Tabs.Panel
            key={value}
            value={value}
            keepMounted
            className="flex min-h-0 min-w-0 flex-1 flex-col focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          >
            {((open && value === tab) || visited.includes(value)) && contents[value]}
          </Tabs.Panel>
        ))}
      </Tabs.Root>
    </aside>
  );
}
