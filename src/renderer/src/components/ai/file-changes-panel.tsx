// @env browser
import { useLayoutEffect, useMemo, useRef, type JSX } from "react";
import { ChevronRightIcon, FileDiffIcon, XIcon } from "lucide-react";
import { Button } from "@renderer/components/ui/button";
import { changesForReply, summarizeChanges } from "@renderer/lib/file-changes";
import { t, useLocale } from "@renderer/lib/i18n";
import type { FileChangesReview } from "@renderer/lib/types";
import { useAgentStore } from "@renderer/stores/agent";
import { useFileChangesStore } from "@renderer/stores/file-changes";
import { cn } from "cn";
import { DiffStats } from "./diff-stats";
import { FileDiffPreview } from "./file-diff-preview";

export function FileChangesPanel({ review }: { review: FileChangesReview }): JSX.Element {
  const locale = useLocale();
  const messages = useAgentStore((state) => state.messages);
  const busy = useAgentStore((state) => state.status !== "idle");
  const close = useFileChangesStore((state) => state.close);
  const toggleFile = useFileChangesStore((state) => state.toggleFile);
  const cancelUndo = useFileChangesStore((state) => state.cancelUndo);
  const { jump, replyId } = review;
  const changes = useMemo(() => changesForReply(messages, replyId), [messages, replyId]);
  const { count, stats } = summarizeChanges(changes);
  const scrollArea = useRef<HTMLDivElement>(null);
  const tab = useRef<HTMLButtonElement>(null);

  useLayoutEffect(() => {
    const viewport = scrollArea.current;
    if (!viewport) return;
    const header = jump.changeId ? document.getElementById("change-file-" + jump.changeId) : null;
    if (header && viewport.contains(header)) {
      const offset = header.getBoundingClientRect().top - viewport.getBoundingClientRect().top;
      viewport.scrollTop += offset - 8;
      header.focus({ preventScroll: true });
    } else {
      viewport.scrollTop = 0;
      tab.current?.focus({ preventScroll: true });
    }
  }, [jump]);

  const closePanel = (): void => {
    close();
    requestAnimationFrame(() => {
      const file = jump.changeId
        ? document.querySelector<HTMLButtonElement>(
            '[data-review-file="' + CSS.escape(jump.changeId) + '"]',
          )
        : null;
      const overview = document.querySelector<HTMLButtonElement>(
        '[data-review-overview="' + CSS.escape(replyId) + '"]',
      );
      (file ?? overview)?.focus({ preventScroll: true });
    });
  };

  return (
    <aside
      data-file-changes-panel
      aria-label={t("文件更改", locale)}
      className="border-border bg-muted/35 flex w-[min(46%,42rem)] min-w-0 shrink-0 flex-col border-l"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        if (review.undoChangeId) cancelUndo(review.undoChangeId);
        else closePanel();
      }}
    >
      <div className="border-border/65 bg-background flex h-12 shrink-0 items-center justify-between gap-2 border-b px-3">
        <div role="tablist" aria-label={t("工作区标签页", locale)}>
          <button
            ref={tab}
            id="file-changes-tab"
            type="button"
            role="tab"
            aria-selected="true"
            aria-controls="file-changes-content"
            className="bg-secondary text-secondary-foreground focus-visible:ring-ring/45 flex h-7 items-center gap-2 rounded-lg px-2.5 text-[13px] font-medium outline-none focus-visible:ring-2"
          >
            <FileDiffIcon aria-hidden="true" className="size-3.5" />
            {t("变更", locale)}
          </button>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t("关闭变更标签页", locale)}
          title={t("关闭变更标签页", locale)}
          onClick={closePanel}
        >
          <XIcon aria-hidden="true" className="size-4" />
        </Button>
      </div>

      <div
        id="file-changes-content"
        role="tabpanel"
        aria-labelledby="file-changes-tab"
        className="flex min-h-0 flex-1 flex-col"
      >
        <div className="border-border/70 bg-background/60 flex shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b px-3 py-2.5">
          <h2 className="text-[13px] font-medium">{t("变更了 {0} 个文件", locale, [count])}</h2>
          {stats && <DiffStats stats={stats} />}
        </div>
        <div
          ref={scrollArea}
          data-file-changes-scroll
          className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto overscroll-contain [scrollbar-color:var(--border)_transparent] [scrollbar-width:thin]"
        >
          {changes.length === 0 ? (
            <p className="text-muted-foreground px-3 py-4 text-xs">{t("暂无文件变更", locale)}</p>
          ) : (
            <ul className="space-y-2 p-2.5">
              {changes.map((change) => {
                const expanded = review.expanded.includes(change.id);
                const headerId = "change-file-" + change.id;
                const contentId = headerId + "-diff";
                return (
                  <li
                    key={change.id}
                    className="border-border/80 bg-card min-w-0 overflow-hidden rounded-lg border"
                  >
                    <button
                      id={headerId}
                      type="button"
                      aria-expanded={expanded}
                      aria-controls={expanded ? contentId : undefined}
                      title={change.path}
                      onClick={() => toggleFile(change.id)}
                      className={cn(
                        "hover:bg-accent/55 focus-visible:ring-ring/45 flex min-h-9 w-full items-center gap-2 px-2.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset",
                        expanded && "bg-muted/55",
                      )}
                    >
                      <ChevronRightIcon
                        aria-hidden="true"
                        className={cn(
                          "text-muted-foreground size-3.5 shrink-0 transition-transform motion-reduce:transition-none",
                          expanded && "rotate-90",
                        )}
                      />
                      <span className="min-w-0 flex-1 truncate font-mono text-xs">
                        {change.path}
                      </span>
                      {change.reverted ? (
                        <span className="text-muted-foreground shrink-0 text-xs">
                          {t("已撤销", locale)}
                        </span>
                      ) : (
                        change.stats && <DiffStats stats={change.stats} />
                      )}
                    </button>
                    {expanded && (
                      <div id={contentId} aria-labelledby={headerId}>
                        <FileDiffPreview
                          sessionId={review.sessionId}
                          change={change}
                          busy={busy}
                          confirming={review.undoChangeId === change.id}
                        />
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      </div>
    </aside>
  );
}
