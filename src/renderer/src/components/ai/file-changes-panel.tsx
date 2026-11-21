// @env browser
import { useId, useLayoutEffect, useMemo, useRef, useState, type JSX } from "react";
import {
  ChevronRightIcon,
  ChevronsDownUpIcon,
  FileDiffIcon,
  FilePlusIcon,
  FolderTreeIcon,
  XIcon,
} from "lucide-react";
import { Button } from "@renderer/components/ui/button";
import { FILE_CHANGES_PANEL_CLASS, FILE_CHANGES_TREE_MIN_WIDTH } from "@renderer/lib/constants";
import { changesForReply, fileChangeLabel, summarizeChanges } from "@renderer/lib/file-changes";
import { t, useLocale } from "@renderer/lib/i18n";
import type { FileChangesReview } from "@renderer/lib/types";
import { useAgentStore } from "@renderer/stores/agent";
import { useFileChangesStore } from "@renderer/stores/file-changes";
import type { FileChangeSummary } from "@shared/contract";
import { cn } from "cn";
import { DiffStats } from "./diff-stats";
import { FileChangesNavigator } from "./file-changes-navigator";
import { FileDiffPreview } from "./file-diff-preview";

function ChangedFile({
  change,
  review,
  busy,
}: {
  change: FileChangeSummary;
  review: FileChangesReview;
  busy: boolean;
}): JSX.Element {
  const locale = useLocale();
  const { directory, name } = fileChangeLabel(change.path);
  const expanded = review.expanded.includes(change.id);
  const selected = review.selectedId === change.id;
  const headerId = "change-file-" + change.id;
  const contentId = headerId + "-diff";
  const Icon = change.kind === "created" ? FilePlusIcon : FileDiffIcon;

  return (
    <li className="border-border/70 min-w-0 border-b">
      <Button
        id={headerId}
        type="button"
        variant="ghost"
        size="sm"
        aria-expanded={expanded}
        aria-controls={expanded ? contentId : undefined}
        title={change.path}
        onClick={() => useFileChangesStore.getState().toggleFile(change.id)}
        className={cn(
          "h-9 w-full min-w-0 justify-start gap-2 rounded-none border-s-2 border-transparent px-2.5 text-left text-xs font-normal",
          expanded && "bg-muted/55",
          selected && "border-s-primary/65 bg-accent/45",
        )}
      >
        <ChevronRightIcon
          aria-hidden="true"
          className={cn(
            "text-muted-foreground size-3 transition-transform motion-reduce:transition-none",
            expanded && "rotate-90",
          )}
        />
        <Icon aria-hidden="true" className="text-primary/80 size-3.5" />
        <span className="flex min-w-0 flex-1">
          {directory && (
            <span className="text-muted-foreground max-w-[65%] truncate">{directory}</span>
          )}
          <span className="min-w-0 truncate">{name}</span>
        </span>
        {change.reverted ? (
          <span className="text-muted-foreground shrink-0 text-xs">{t("已撤销", locale)}</span>
        ) : (
          change.stats && <DiffStats stats={change.stats} />
        )}
      </Button>
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
}

export function FileChangesPanel({ review }: { review: FileChangesReview }): JSX.Element {
  const locale = useLocale();
  const messages = useAgentStore((state) => state.messages);
  const busy = useAgentStore((state) => state.status !== "idle");
  const close = useFileChangesStore((state) => state.close);
  const cancelUndo = useFileChangesStore((state) => state.cancelUndo);
  const collapseFiles = useFileChangesStore((state) => state.collapseFiles);
  const { jump, replyId } = review;
  const changes = useMemo(() => changesForReply(messages, replyId), [messages, replyId]);
  const { count, stats } = useMemo(() => summarizeChanges(changes), [changes]);
  const panel = useRef<HTMLElement>(null);
  const scrollArea = useRef<HTMLDivElement>(null);
  const tab = useRef<HTMLButtonElement>(null);
  const navigatorToggle = useRef<HTMLButtonElement>(null);
  const navigatorId = useId();
  const [wide, setWide] = useState(false);
  const [wideNavigatorOpen, setWideNavigatorOpen] = useState(true);
  const [narrowNavigatorOpen, setNarrowNavigatorOpen] = useState(false);
  const showNavigator = changes.length > 0 && (wide ? wideNavigatorOpen : narrowNavigatorOpen);
  const navigatorLabel = t(showNavigator ? "隐藏文件目录" : "显示文件目录", locale);

  useLayoutEffect(() => {
    const node = panel.current;
    if (!node) return;
    const resize = (): void => setWide(node.clientWidth >= FILE_CHANGES_TREE_MIN_WIDTH);
    const observer = new ResizeObserver(resize);
    resize();
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

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

  const selectFile = (change: FileChangeSummary): void => {
    if (!wide) setNarrowNavigatorOpen(false);
    useFileChangesStore.getState().open({
      sessionId: review.sessionId,
      replyId,
      changeId: change.id,
      changePath: change.path,
    });
  };

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
      ref={panel}
      data-file-changes-panel
      aria-label={t("文件更改", locale)}
      className={FILE_CHANGES_PANEL_CLASS}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        if (review.undoChangeId) cancelUndo(review.undoChangeId);
        else if (!wide && showNavigator) {
          setNarrowNavigatorOpen(false);
          navigatorToggle.current?.focus();
        } else closePanel();
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
        <div className="border-border/70 bg-muted/40 flex min-h-10 shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b px-2.5 py-1">
          <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
            <h2 className="text-xs font-medium">{t("变更了 {0} 个文件", locale, [count])}</h2>
            {stats && <DiffStats stats={stats} />}
          </div>
          <div className="flex items-center gap-1">
            <Button
              type="button"
              variant="ghost"
              size="icon-xs"
              aria-label={t("收起所有差异", locale)}
              title={t("收起所有差异", locale)}
              disabled={review.expanded.length === 0}
              onClick={collapseFiles}
            >
              <ChevronsDownUpIcon aria-hidden="true" />
            </Button>
            <Button
              ref={navigatorToggle}
              type="button"
              variant={showNavigator ? "secondary" : "ghost"}
              size="icon-xs"
              disabled={changes.length === 0}
              aria-label={navigatorLabel}
              title={navigatorLabel}
              aria-expanded={showNavigator}
              aria-controls={showNavigator ? navigatorId : undefined}
              onClick={() => {
                if (wide) setWideNavigatorOpen(!showNavigator);
                else setNarrowNavigatorOpen(!showNavigator);
              }}
            >
              <FolderTreeIcon aria-hidden="true" />
            </Button>
          </div>
        </div>
        <div
          className={cn(
            "grid min-h-0 min-w-0 flex-1",
            wide && showNavigator
              ? "grid-cols-[minmax(0,1fr)_clamp(11rem,32%,15rem)]"
              : "grid-cols-[minmax(0,1fr)]",
            !wide && showNavigator ? "grid-rows-[auto_minmax(0,1fr)]" : "grid-rows-[minmax(0,1fr)]",
          )}
        >
          <div
            ref={scrollArea}
            data-file-changes-scroll
            className="min-h-0 min-w-0 overflow-x-hidden overflow-y-auto overscroll-contain [scrollbar-color:var(--border)_transparent] [scrollbar-width:thin]"
          >
            {changes.length ? (
              <ol className="min-w-0">
                {changes.map((change) => (
                  <ChangedFile key={change.id} change={change} review={review} busy={busy} />
                ))}
              </ol>
            ) : (
              <p className="text-muted-foreground px-3 py-4 text-xs">{t("暂无文件变更", locale)}</p>
            )}
          </div>
          {showNavigator && (
            <FileChangesNavigator
              key={replyId}
              id={navigatorId}
              changes={changes}
              review={review}
              wide={wide}
              onSelect={selectFile}
            />
          )}
        </div>
      </div>
    </aside>
  );
}
