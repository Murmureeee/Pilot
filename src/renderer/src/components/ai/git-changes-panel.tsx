// @env browser
import { CheckIcon, ChevronRightIcon, HistoryIcon } from "lucide-react";
import { useState, type JSX } from "react";

import { Badge } from "@renderer/components/ui/badge";
import { Button } from "@renderer/components/ui/button";
import { useGitReview } from "@renderer/hooks/use-git-review";
import {
  GIT_CHANGE_AREAS,
  GIT_CHANGE_AREA_LABELS,
  GIT_CHANGE_KIND_LABELS,
  GIT_CHANGE_ORIGIN_LABELS,
  GIT_ROLLBACK_CONFLICT_LABELS,
  GIT_REVIEW_PHASE_LABELS,
} from "@renderer/lib/constants";
import { localizeError, t, useLocale } from "@renderer/lib/i18n";
import type { AppendGitAnnotations, GitAnnotationSource, GitReview } from "@renderer/lib/types";
import { selectWorkspaceRun, useAgentStore } from "@renderer/stores/agent";
import { useGitAnnotationStore } from "@renderer/stores/git-annotations";
import type {
  GitChange,
  GitCommitResult,
  GitPatchSelection,
  GitStageSelection,
} from "@shared/contract";

import { GitAnnotationEditor, GitAnnotationQueue } from "./git-annotations";
import { GitBranchActions } from "./git-branch-actions";
import { GitCommitDialog } from "./git-commit-dialog";
import { GitCheckpointFilePreview, GitDiffPreview } from "./git-diff-preview";
import { GitWorktreeDialog } from "./git-worktree-dialog";

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
  workingDirectory,
  onAnnotate,
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
  workingDirectory: string | null;
  onAnnotate(source: GitAnnotationSource): void;
}): JSX.Element {
  const locale = useLocale();
  return (
    <li
      data-git-file={change.path}
      data-git-origin={change.origin}
      className="min-w-0 border-b border-border/65"
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
              className="truncate text-xs text-muted-foreground"
            >
              {t("原路径 {0}", locale, [change.previousPath])}
            </span>
          )}
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
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
          workingDirectory={workingDirectory}
          onAnnotate={onAnnotate}
        />
      )}
    </li>
  );
}

export function GitChangesPanel({
  composerId,
  workingDirectory,
  liveReview,
  onAppendAnnotations,
}: {
  composerId: string;
  workingDirectory: string | null;
  liveReview: GitReview;
  onAppendAnnotations?: AppendGitAnnotations;
}): JSX.Element {
  const locale = useLocale();
  const [showCheckpoint, setShowCheckpoint] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [expanded, setExpanded] = useState<string>();
  const [revision, setRevision] = useState(0);
  const [selections, setSelections] = useState<GitPatchSelection[]>([]);
  const [staging, setStaging] = useState(false);
  const [stageError, setStageError] = useState("");
  const [commit, setCommit] = useState<GitCommitResult>();
  const [annotation, setAnnotation] = useState<GitAnnotationSource>();
  const annotationScope = JSON.stringify([composerId, workingDirectory]);
  const busy = useAgentStore((state) => selectWorkspaceRun(state) !== null);
  const live = !showCheckpoint && !showHistory;
  const history = useGitReview(live ? null : composerId, workingDirectory, false);
  const review = live ? liveReview : history;
  const view = review.view;
  const phase = (view ?? liveReview.view)?.phase;
  const changes = view?.changes;
  const staged = new Set(
    changes?.filter((change) => change.area === "staged").map((change) => change.path),
  );
  const selected = selections.filter((item) => staged.has(item.path));
  const checkpoint = showCheckpoint ? view?.checkpoint : undefined;
  const refresh = (): void => {
    liveReview.refresh();
    if (!live) history.refresh();
    setRevision((value) => value + 1);
  };
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
    view === undefined ? "加载中…" : !view ? "当前目录没有 Git 工作树" : "暂无文件变更";
  return (
    <div data-git-changes className="flex min-h-0 flex-1 flex-col">
      {phase && (
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-2 gap-y-1.5 border-b border-border/70 bg-muted/40 px-3 py-1.5">
          <p className="text-xs text-muted-foreground">
            {t(GIT_REVIEW_PHASE_LABELS[phase], locale)}
          </p>
          <div className="flex flex-wrap items-center gap-1.5">
            {(liveReview.view?.hasHistory || showHistory) && (
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
            {liveReview.view?.checkpoint && (
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
      {live && (
        <div className="flex shrink-0 flex-col gap-2 border-b border-border/65 px-3 py-2">
          <GitBranchActions
            key={composerId + ":" + workingDirectory}
            composerId={composerId}
            disabled={busy || staging}
            otherActions={
              <GitWorktreeDialog composerId={composerId} onChanged={refreshSelection} />
            }
            onBranchChanged={() => {
              setExpanded(undefined);
              setStageError("");
              setCommit(undefined);
              refreshSelection();
            }}
          />
        </div>
      )}
      {workingDirectory && (
        <GitAnnotationQueue scope={annotationScope} onAppend={onAppendAnnotations} />
      )}
      {annotation && (
        <GitAnnotationEditor
          key={annotation.id}
          source={annotation}
          onClose={() => setAnnotation(undefined)}
          onSave={(note) => useGitAnnotationStore.getState().save(annotationScope, note)}
        />
      )}
      {(review.error || changes === null) && (
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border/65 px-3 py-2">
          <p role="alert" className="min-w-0 text-xs wrap-anywhere text-destructive">
            {review.error ? localizeError(review.error, locale) : t("无法读取 Git 变更", locale)}
          </p>
          <Button variant="outline" size="xs" onClick={refresh}>
            {t("重试", locale)}
          </Button>
        </div>
      )}
      <div
        data-git-changes-scroll
        className="min-h-0 flex-1 [scrollbar-width:thin] [scrollbar-color:var(--border)_transparent] overflow-y-auto overscroll-contain"
      >
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
                  className="min-w-0 border-b border-border/65"
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
                        <span className="text-xs wrap-anywhere text-muted-foreground">
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
                      onApplied={refresh}
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
                  className="border-b border-border/65 bg-muted/45 px-3 py-1.5 text-xs font-medium"
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
                        workingDirectory={workingDirectory}
                        onAnnotate={setAnnotation}
                      />
                    );
                  })}
                </ul>
              </section>
            );
          })
        ) : (
          !(review.error || changes === null) && (
            <p role="status" className="px-3 py-4 text-xs text-muted-foreground">
              {t(emptyMessage, locale)}
            </p>
          )
        )}
      </div>
      {live && changes && (
        <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-t border-border/70 px-3 py-2">
          <p className="text-xs text-muted-foreground">
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
            <div className="flex basis-full flex-wrap items-center justify-between gap-2">
              <p role="alert" className="text-xs wrap-anywhere text-destructive">
                {localizeError(stageError, locale)}
              </p>
              <Button
                size="xs"
                variant="outline"
                onClick={() => {
                  setStageError("");
                  refresh();
                }}
              >
                {t("刷新变更", locale)}
              </Button>
            </div>
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
                <p className="font-mono break-all text-muted-foreground select-all">
                  {commit.commit}
                </p>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
