// @env browser
import { useEffect, useRef, useState, type JSX } from "react";
import { CheckIcon, ChevronRightIcon, FileDiffIcon, HistoryIcon, XIcon } from "lucide-react";
import { Badge } from "@renderer/components/ui/badge";
import { Button } from "@renderer/components/ui/button";
import {
  FILE_CHANGES_PANEL_CLASS,
  GIT_CHANGE_AREAS,
  GIT_CHANGE_AREA_LABELS,
  GIT_CHANGE_KIND_LABELS,
  GIT_CHANGE_ORIGIN_LABELS,
  GIT_ROLLBACK_CONFLICT_LABELS,
  GIT_REVIEW_PHASE_LABELS,
} from "@renderer/lib/constants";
import { localizeError, t, useLocale } from "@renderer/lib/i18n";
import { useAgentStore } from "@renderer/stores/agent";
import { useFileChangesStore } from "@renderer/stores/file-changes";
import type {
  GitChange,
  GitChangesView,
  GitCommitResult,
  GitPatchSelection,
  GitStageSelection,
} from "@shared/contract";
import { GitCommitDialog } from "./git-commit-dialog";
import { GitCheckpointFilePreview, GitDiffPreview } from "./git-diff-preview";

function GitChangeRow({
  change,
  composerId,
  expanded,
  live,
  revision,
  blocked,
  selection,
  onToggle,
  onSelect,
  onStage,
}: {
  change: GitChange;
  composerId: string;
  expanded: boolean;
  live: boolean;
  revision: number;
  blocked: boolean;
  selection?: GitPatchSelection;
  onToggle(): void;
  onSelect(selection?: GitPatchSelection): void;
  onStage(selection: GitStageSelection): void;
}): JSX.Element {
  const locale = useLocale();
  return (
    <li
      data-git-file={change.path}
      data-git-origin={change.origin}
      className="border-border/65 min-w-0 border-b"
    >
      <Button
        type="button"
        variant="ghost"
        aria-expanded={expanded}
        onClick={onToggle}
        title={change.path}
        data-git-diff-toggle
        className="h-auto w-full min-w-0 items-start justify-start gap-2 rounded-none px-3 py-2 text-left font-normal"
      >
        <ChevronRightIcon aria-hidden="true" className={expanded ? "mt-0.5 rotate-90" : "mt-0.5"} />
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span dir="auto" className="truncate font-mono text-sm">
            {change.path}
          </span>
          {change.previousPath && (
            <span
              dir="auto"
              title={change.previousPath}
              className="text-muted-foreground truncate text-xs"
            >
              {t("原路径 {0}", locale, [change.previousPath])}
            </span>
          )}
          <span className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            <span>
              {t(
                change.resolved ? "任务期间移出清单" : GIT_CHANGE_KIND_LABELS[change.kind],
                locale,
              )}
            </span>
            <Badge variant={change.origin === "mixed" ? "outline" : "secondary"}>
              {t(
                change.taskReverted ? "任务改动已撤销" : GIT_CHANGE_ORIGIN_LABELS[change.origin],
                locale,
              )}
            </Badge>
          </span>
        </span>
        {selection && live && (
          <span className="flex items-center">
            <CheckIcon aria-hidden="true" className="mt-0.5" />
            <span className="sr-only">{t("已选入提交", locale)}</span>
          </span>
        )}
      </Button>
      {expanded && (
        <GitDiffPreview
          key={revision}
          composerId={composerId}
          request={{ path: change.path, area: change.area, live }}
          blocked={blocked}
          selection={selection}
          onSelect={onSelect}
          onStage={onStage}
        />
      )}
    </li>
  );
}

export function GitChangesPanel({ composerId }: { composerId: string }): JSX.Element {
  const locale = useLocale();
  const heading = useRef<HTMLHeadingElement>(null);
  const [view, setView] = useState<GitChangesView | null>();
  const [showCheckpoint, setShowCheckpoint] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [expanded, setExpanded] = useState<string>();
  const [revision, setRevision] = useState(0);
  const [selections, setSelections] = useState<GitPatchSelection[]>([]);
  const [staging, setStaging] = useState(false);
  const [stageError, setStageError] = useState("");
  const [commit, setCommit] = useState<GitCommitResult>();
  const busy = useAgentStore((state) => state.activeRun !== null);
  const live = !showCheckpoint && !showHistory;

  useEffect(() => {
    heading.current?.focus();
  }, []);

  useEffect(() => {
    let disposed = false;
    let reading = false;
    let queued = false;
    const refresh = async (): Promise<void> => {
      if (reading) {
        queued = true;
        return;
      }
      reading = true;
      do {
        queued = false;
        const next = await window.pi
          .sessionGitChanges(composerId, live)
          .catch((): GitChangesView => ({
            phase: "workspace",
            changes: null,
          }));
        if (!disposed && !queued) setView(next);
      } while (!disposed && queued);
      reading = false;
    };
    const refreshOnFocus = (): void => void refresh();
    const unsubscribe = window.pi.onAgentEvent((event) => {
      if (
        "run" in event &&
        event.run.sessionId === composerId &&
        (event.type === "run_started" ||
          event.type === "tool_end" ||
          (event.type === "status" && event.status === "idle"))
      )
        void refresh();
    });
    window.addEventListener("focus", refreshOnFocus);
    void refresh();
    return () => {
      disposed = true;
      unsubscribe();
      window.removeEventListener("focus", refreshOnFocus);
    };
  }, [composerId, live, revision]);

  const close = (): void => {
    useFileChangesStore.getState().close();
    document.getElementById("git-changes-trigger")?.focus();
  };
  const changes = view?.changes;
  const staged = new Set(
    changes?.filter((change) => change.area === "staged").map((change) => change.path),
  );
  const selected = selections.filter((item) => staged.has(item.path));
  const checkpoint = showCheckpoint ? view?.checkpoint : undefined;
  const refresh = (): void => setRevision((value) => value + 1);
  const refreshSelection = (): void => {
    setSelections([]);
    refresh();
  };
  const select = (path: string, selection?: GitPatchSelection): void =>
    setSelections((current) => [
      ...current.filter((item) => item.path !== path),
      ...(selection ? [selection] : []),
    ]);
  const stage = async (selection: GitStageSelection): Promise<void> => {
    if (busy || staging) return;
    setStaging(true);
    setStageError("");
    try {
      await window.pi.sessionStageGit(composerId, selection);
      select(selection.path);
      const change = changes?.find(
        ({ area, path }) => area === selection.area && path === selection.path,
      );
      if (change?.previousPath) select(change.previousPath);
      setExpanded(
        selection.hunks ? selection.area + ":" + selection.path : "staged:" + selection.path,
      );
    } catch (error) {
      setStageError(String(error));
    } finally {
      refresh();
      setStaging(false);
    }
  };
  const toggle = (key: string): void =>
    setExpanded((current) => (current === key ? undefined : key));
  const emptyMessage =
    view === undefined
      ? "加载中…"
      : !view
        ? "当前目录没有 Git 工作树"
        : changes === null
          ? "无法读取 Git 变更"
          : "暂无文件变更";
  return (
    <aside
      id="git-changes-panel"
      aria-labelledby="git-changes-heading"
      className={FILE_CHANGES_PANEL_CLASS}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !event.currentTarget.contains(event.target as Node)) return;
        event.stopPropagation();
        close();
      }}
    >
      <div className="border-border/65 flex h-12 shrink-0 items-center justify-between gap-2 border-b px-3">
        <h2
          id="git-changes-heading"
          ref={heading}
          tabIndex={-1}
          className="flex min-w-0 items-center gap-2 text-[13px] font-medium outline-none"
        >
          <FileDiffIcon aria-hidden="true" className="size-3.5 shrink-0" />
          {t("Git 变更", locale)}
        </h2>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t("关闭变更标签页", locale)}
          title={t("关闭变更标签页", locale)}
          onClick={close}
        >
          <XIcon aria-hidden="true" />
        </Button>
      </div>
      {view && (
        <div className="border-border/70 bg-muted/40 flex shrink-0 flex-wrap items-center justify-between gap-x-2 gap-y-1.5 border-b px-3 py-1.5">
          <p className="text-muted-foreground text-xs">
            {t(GIT_REVIEW_PHASE_LABELS[view.phase], locale)}
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            {(view.hasHistory || showHistory) && (
              <Button
                size="xs"
                variant={showHistory ? "secondary" : "outline"}
                aria-pressed={showHistory}
                disabled={staging}
                onClick={() => {
                  setExpanded(undefined);
                  setShowCheckpoint(false);
                  setShowHistory(!showHistory);
                }}
              >
                {t("任务变更记录", locale)}
              </Button>
            )}
            {view.checkpoint && (
              <Button
                size="xs"
                variant={showCheckpoint ? "secondary" : "outline"}
                aria-pressed={showCheckpoint}
                disabled={staging}
                onClick={() => {
                  setExpanded(undefined);
                  setShowHistory(false);
                  setShowCheckpoint(!showCheckpoint);
                }}
              >
                <HistoryIcon data-icon="inline-start" />
                {t("任务检查点", locale)}
              </Button>
            )}
          </div>
        </div>
      )}
      {live && changes && (
        <div className="border-border/70 flex shrink-0 flex-wrap items-center gap-2 border-b px-3 py-2">
          <p className="text-muted-foreground text-xs">
            {t("暂存区 {0} 个文件", locale, [staged.size])}
          </p>
          <GitCommitDialog
            composerId={composerId}
            selections={selected}
            disabled={busy || staging}
            onRefresh={refreshSelection}
            onApplied={(result) => {
              setCommit(result);
              setExpanded(undefined);
              setStageError("");
              refreshSelection();
            }}
          />
          {stageError && (
            <p role="alert" className="text-destructive basis-full text-xs wrap-anywhere">
              {localizeError(stageError, locale)}
            </p>
          )}
          {commit && (
            <div
              role="status"
              data-git-commit={commit.commit}
              className="flex basis-full items-start gap-1.5 text-xs text-emerald-700 dark:text-emerald-400"
            >
              <CheckIcon aria-hidden="true" className="mt-0.5 size-3 shrink-0" />
              <div className="min-w-0">
                <p className="wrap-anywhere">
                  {commit.branch
                    ? t("已提交到 {0}", locale, [commit.branch])
                    : t("已提交到游离 HEAD", locale)}
                </p>
                <p className="text-muted-foreground font-mono break-all select-all">
                  {commit.commit}
                </p>
              </div>
            </div>
          )}
        </div>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-color:var(--border)_transparent] [scrollbar-width:thin]">
        {checkpoint ? (
          <ul aria-label={t("任务检查点", locale)} data-git-checkpoint>
            {checkpoint.files.map((file) => {
              const key = "checkpoint:" + file.path;
              const selected = expanded === key;
              const change =
                changes?.find((item) => item.path === file.path && item.area !== "staged") ??
                changes?.find((item) => item.path === file.path);
              return (
                <li
                  key={file.path}
                  className="border-border/65 min-w-0 border-b"
                  data-checkpoint-file={file.path}
                >
                  <Button
                    type="button"
                    variant="ghost"
                    aria-expanded={selected}
                    title={file.path}
                    onClick={() => toggle(key)}
                    className="h-auto w-full min-w-0 items-start justify-start gap-2 rounded-none px-3 py-2 text-left font-normal"
                  >
                    <ChevronRightIcon
                      aria-hidden="true"
                      className={selected ? "mt-0.5 rotate-90" : "mt-0.5"}
                    />
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span dir="auto" className="truncate font-mono text-sm">
                        {file.path}
                      </span>
                      {(file.conflict || file.reverted) && (
                        <span className="text-muted-foreground text-xs wrap-anywhere">
                          {t(
                            file.conflict
                              ? GIT_ROLLBACK_CONFLICT_LABELS[file.conflict]
                              : "任务改动已撤销",
                            locale,
                          )}
                        </span>
                      )}
                    </span>
                    {selected && <CheckIcon aria-hidden="true" className="mt-0.5" />}
                  </Button>
                  {selected && change && (
                    <GitCheckpointFilePreview
                      key={checkpoint.id + ":" + revision}
                      composerId={composerId}
                      checkpointId={checkpoint.id}
                      request={{ path: file.path, area: change.area }}
                      busy={busy}
                      onApplied={() => setRevision((value) => value + 1)}
                    />
                  )}
                </li>
              );
            })}
          </ul>
        ) : changes?.length ? (
          GIT_CHANGE_AREAS.map((area) => {
            const files = changes.filter((change) => change.area === area);
            if (!files.length) return null;
            return (
              <section key={area} data-git-area={area} aria-labelledby={`git-area-${area}`}>
                <h3
                  id={`git-area-${area}`}
                  className="border-border/65 bg-muted/45 border-b px-3 py-1.5 text-xs font-medium"
                >
                  {t(GIT_CHANGE_AREA_LABELS[area], locale)}
                </h3>
                <ul>
                  {files.map((change) => {
                    const key = area + ":" + change.path;
                    return (
                      <GitChangeRow
                        key={change.path + ":" + view?.phase}
                        composerId={composerId}
                        change={change}
                        expanded={expanded === key}
                        live={live}
                        revision={revision}
                        blocked={busy || staging}
                        selection={
                          area === "staged"
                            ? selected.find((item) => item.path === change.path)
                            : undefined
                        }
                        onToggle={() => toggle(key)}
                        onSelect={(selection) => select(change.path, selection)}
                        onStage={(selection) => void stage(selection)}
                      />
                    );
                  })}
                </ul>
              </section>
            );
          })
        ) : (
          <p role="status" className="text-muted-foreground px-3 py-4 text-xs">
            {t(emptyMessage, locale)}
          </p>
        )}
      </div>
    </aside>
  );
}
