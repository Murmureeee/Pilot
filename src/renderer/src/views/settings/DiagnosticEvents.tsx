// @env browser
import { cn } from "cn";
import { RefreshCwIcon } from "lucide-react";
import { useRef, useState, type JSX } from "react";

import { ListEmpty } from "@renderer/components/ai/list-empty";
import { Button } from "@renderer/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@renderer/components/ui/dialog";
import {
  DIAGNOSTIC_EVENT_LABELS,
  DIAGNOSTIC_REASON_LABELS,
  DIAGNOSTIC_SOURCE_LABELS,
  LOG_LEVEL_LABELS,
} from "@renderer/lib/constants";
import { t, useLocale } from "@renderer/lib/i18n";
import { LOCALE_DETAILS } from "@shared/constants";
import type { DiagnosticEvent, Locale } from "@shared/contract";

function EventRow({
  event,
  locale,
  date,
}: {
  event: DiagnosticEvent;
  locale: Locale;
  date: Intl.DateTimeFormat;
}): JSX.Element {
  const { errorName, code, line, reason, version, processType } = event;
  const details = [
    reason && t(DIAGNOSTIC_REASON_LABELS[reason], locale),
    processType,
    errorName,
    code !== undefined && t("代码 {0}", locale, [code]),
    line !== undefined && t("第 {0} 行", locale, [line]),
    version && t("版本 {0}", locale, [version]),
  ].filter(Boolean);
  return (
    <li className="flex flex-col gap-0.5 py-2.5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3">
        <p
          className={cn(
            "text-sm font-medium",
            event.level === "error" && "text-destructive",
            event.level === "warn" && "text-amber-700 dark:text-amber-400",
          )}
        >
          {t(DIAGNOSTIC_EVENT_LABELS[event.event], locale)}
        </p>
        <time dateTime={event.time} className="text-xs text-muted-foreground">
          {date.format(new Date(event.time))}
        </time>
      </div>
      <p className="text-xs leading-5 text-muted-foreground">
        {t(DIAGNOSTIC_SOURCE_LABELS[event.source], locale)} ·{" "}
        {t(event.level === "error" ? "错误" : LOG_LEVEL_LABELS[event.level], locale)}
      </p>
      {details.length > 0 && (
        <p className="text-xs leading-5 wrap-anywhere text-muted-foreground">
          {details.join(" · ")}
        </p>
      )}
    </li>
  );
}

export function DiagnosticEvents(): JSX.Element {
  const locale = useLocale();
  const scrollRegion = useRef<HTMLElement>(null);
  const [events, setEvents] = useState<DiagnosticEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(false);
  const title = t("诊断事件", locale);
  const date = new Intl.DateTimeFormat(LOCALE_DETAILS[locale].htmlLang, {
    dateStyle: "short",
    timeStyle: "medium",
  });

  const refresh = async (): Promise<void> => {
    if (loading) return;
    setLoading(true);
    setError(false);
    try {
      setEvents(await window.pi.diagnosticEvents());
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog
      onOpenChange={(open) => {
        if (open) void refresh();
      }}
    >
      <DialogTrigger render={<Button variant="outline" size="sm" />}>
        {t("查看事件", locale)}
      </DialogTrigger>
      <DialogContent
        initialFocus={scrollRegion}
        showCloseButton={false}
        className="flex max-h-[85vh] flex-col gap-4 sm:max-w-lg"
      >
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{t("事件按记录顺序从新到旧显示。", locale)}</DialogDescription>
        </DialogHeader>
        {/* oxlint-disable jsx-a11y/no-noninteractive-tabindex -- The focus trap needs an explicit tab stop for keyboard scrolling. */}
        <section
          ref={scrollRegion}
          tabIndex={0}
          aria-label={title}
          className="min-h-0 overflow-y-auto overscroll-contain rounded-lg border px-3 outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {loading ? (
            <output className="block py-3 text-sm text-muted-foreground">
              {t("加载中…", locale)}
            </output>
          ) : error ? (
            <p role="alert" className="py-3 text-sm text-destructive">
              {t("无法读取诊断事件。请刷新重试。", locale)}
            </p>
          ) : events.length ? (
            <ul className="divide-y divide-border">
              {events.map((event, index) => (
                <EventRow key={index} event={event} locale={locale} date={date} />
              ))}
            </ul>
          ) : (
            <ListEmpty
              title={t("暂无诊断事件", locale)}
              description={t("开启日志记录后，新的事件会显示在这里。", locale)}
            />
          )}
        </section>
        {/* oxlint-enable jsx-a11y/no-noninteractive-tabindex */}
        <DialogFooter className="shrink-0">
          <Button
            variant="outline"
            disabled={loading}
            focusableWhenDisabled
            onClick={() => void refresh()}
          >
            <RefreshCwIcon data-icon="inline-start" />
            {t("刷新事件", locale)}
          </Button>
          <DialogClose render={<Button />}>{t("关闭", locale)}</DialogClose>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
