// @env browser
import { cn } from "cn";
import {
  ChevronRightIcon,
  ChevronsDownUpIcon,
  FileDiffIcon,
  FilePlusIcon,
  FolderTreeIcon,
} from "lucide-react";
import { useId, useLayoutEffect, useMemo, useRef, useState, type JSX } from "react";

import { Button } from "@renderer/components/ui/button";
import { FILE_CHANGES_TREE_MIN_WIDTH } from "@renderer/lib/constants";
import { changesForReply, fileChangeLabel, summarizeChanges } from "@renderer/lib/file-changes";
import { t, useLocale } from "@renderer/lib/i18n";
import type { FileChangesReview } from "@renderer/lib/types";
import { useAgentStore } from "@renderer/stores/agent";
import { useFileChangesStore } from "@renderer/stores/file-changes";
import type { FileChangeSummary } from "@shared/contract";

import { DiffStats } from "./diff-stats";
import { FileChangesNavigator } from "./file-changes-navigator";
import { FileDiffPreview } from "./file-diff-preview";

function ChangedFile({
  change,
  review,
  busy,
  active,
}: {
  change: FileChangeSummary;
  review: FileChangesReview;
  busy: boolean;
  active: boolean;
}): JSX.Element {
  const locale = useLocale();
  const { directory, name } = fileChangeLabel(change.path);
  const expanded = review.expanded.includes(change.id);
  const selected = review.selectedId === change.id;
  const headerId = "change-file-" + change.id;
  const contentId = headerId + "-diff";
  const Icon = change.kind === "created" ? FilePlusIcon : FileDiffIcon;

  return (
    <li className="min-w-0 border-b border-border/70">
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
            "size-3 text-muted-foreground transition-transform motion-reduce:transition-none",
            expanded && "rotate-90",
          )}
        />
        <Icon aria-hidden="true" className="size-3.5 text-primary/80" />
        <span className="flex min-w-0 flex-1">
          {directory && (
            <span className="max-w-[65%] truncate text-muted-foreground">{directory}</span>
          )}
          <span className="min-w-0 truncate">{name}</span>
        </span>
        {change.reverted ? (
          <span className="shrink-0 text-xs text-muted-foreground">{t("已撤销", locale)}</span>
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
            active={active}
            confirming={review.undoChangeId === change.id}
          />
        </div>
      )}
    </li>
  );
}

export function FileChangesPanel({
  review,
  active,
}: {
  review: FileChangesReview;
  active: boolean;
}): JSX.Element {
  const locale = useLocale();
  const messages = useAgentStore((state) => state.messages);
  const busy = useAgentStore((state) => state.status !== "idle");
  const collapseFiles = useFileChangesStore((state) => state.collapseFiles);
  const { jump, replyId } = review;
  const changes = useMemo(() => changesForReply(messages, replyId), [messages, replyId]);
  const { count, stats } = useMemo(() => summarizeChanges(changes), [changes]);
  const panel = useRef<HTMLDivElement>(null);
  const scrollArea = useRef<HTMLDivElement>(null);
  const lastJump = useRef<typeof jump>(null);
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
    if (!active || !viewport || lastJump.current === jump) return;
    lastJump.current = jump;
    const header = jump.changeId ? document.getElementById("change-file-" + jump.changeId) : null;
    if (header && viewport.contains(header)) {
      const offset = header.getBoundingClientRect().top - viewport.getBoundingClientRect().top;
      viewport.scrollTop += offset - 8;
      header.focus({ preventScroll: true });
    } else viewport.scrollTop = 0;
  }, [active, jump]);

  const selectFile = (change: FileChangeSummary): void => {
    if (!wide) setNarrowNavigatorOpen(false);
    useFileChangesStore.getState().open({
      sessionId: review.sessionId,
      replyId,
      changeId: change.id,
      changePath: change.path,
    });
  };

  return (
    <div
      ref={panel}
      data-file-changes-panel
      className="flex min-h-0 min-w-0 flex-1 flex-col"
      onKeyDown={(event) => {
        if (
          event.key !== "Escape" ||
          wide ||
          !showNavigator ||
          !event.currentTarget.contains(event.target as Node)
        )
          return;
        setNarrowNavigatorOpen(false);
        navigatorToggle.current?.focus();
        event.preventDefault();
        event.stopPropagation();
      }}
    >
      <div className="flex min-h-10 shrink-0 flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-border/70 bg-muted/40 px-2.5 py-1">
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
          className="min-h-0 min-w-0 [scrollbar-width:thin] [scrollbar-color:var(--border)_transparent] overflow-x-hidden overflow-y-auto overscroll-contain"
        >
          {changes.length ? (
            <ol className="min-w-0">
              {changes.map((change) => (
                <ChangedFile
                  key={change.id}
                  change={change}
                  review={review}
                  busy={busy}
                  active={active}
                />
              ))}
            </ol>
          ) : (
            <p className="px-3 py-4 text-xs text-muted-foreground">{t("暂无文件变更", locale)}</p>
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
  );
}
