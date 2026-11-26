// @env browser
import { MessageSquarePlusIcon } from "lucide-react";
import { useEffect, useRef, useState, type JSX } from "react";

import { Button } from "@renderer/components/ui/button";
import { CodeBlock, CodeBlockContent } from "@renderer/components/ui/code-block";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@renderer/components/ui/dialog";
import { GIT_ROLLBACK_CONFLICT_LABELS } from "@renderer/lib/constants";
import { localizeError, t, useLocale } from "@renderer/lib/i18n";
import type { GitAnnotationSource } from "@renderer/lib/types";
import type {
  GitCheckpointDiff,
  GitDiffRequest,
  GitFileDiff,
  GitPatchSelection,
  GitRollbackPreview,
  GitStageSelection,
} from "@shared/contract";

import { DiffLines } from "./file-diff-preview";

function DiffStatus({ message, error = false }: { message: string; error?: boolean }): JSX.Element {
  const locale = useLocale();
  return (
    <p
      role={error ? "alert" : "status"}
      className={
        error
          ? "px-3 py-2 text-xs wrap-anywhere text-destructive"
          : "px-3 py-2 text-xs text-muted-foreground"
      }
    >
      {localizeError(message, locale)}
    </p>
  );
}

export function GitDiffPreview({
  composerId,
  request,
  blocked,
  selection,
  onSelect,
  onStage,
  workingDirectory,
  onAnnotate,
}: {
  composerId: string;
  request: GitDiffRequest;
  blocked: boolean;
  selection?: GitPatchSelection;
  onSelect(selection?: GitPatchSelection): void;
  onStage(selection: GitStageSelection): void;
  workingDirectory: string | null;
  onAnnotate(source: GitAnnotationSource): void;
}): JSX.Element {
  const locale = useLocale();
  const { area, path, live } = request;
  const [data, setData] = useState<GitFileDiff>();
  const [error, setError] = useState("");
  const [stageHunks, setStageHunks] = useState<number[]>([]);
  useEffect(() => {
    let active = true;
    void window.pi.sessionGitDiff(composerId, { area, path, live }).then(
      (result) => {
        if (active) setData(result);
      },
      (reason: unknown) => {
        if (active) setError(String(reason));
      },
    );
    return () => {
      active = false;
    };
  }, [area, path, live, composerId]);
  const selected = selection?.revision === data?.revision ? selection : undefined;
  const revision = data?.revision;
  const hunks = data?.diff?.hunks;
  const referencePaths = data?.referencePaths;
  const annotate = (index: number, trigger: HTMLButtonElement): void => {
    const rows = hunks?.[index];
    if (!rows?.length || !workingDirectory || !referencePaths) return;
    onAnnotate({
      id: crypto.randomUUID(),
      area,
      paths: referencePaths,
      diff: { hunks: [rows], truncated: false },
      canOpen: data.canOpen,
      lineTargets: data.lineTargets,
      workingDirectory,
      trigger,
    });
  };
  const selectedHunks =
    area === "staged"
      ? (selected?.hunks ?? (selected && hunks ? hunks.map((_, index) => index) : []))
      : stageHunks;
  const toggleHunk = (index: number, checked: boolean): void => {
    if (!revision) return;
    const next = checked
      ? [...selectedHunks, index]
      : selectedHunks.filter((hunk) => hunk !== index);
    if (area === "staged") onSelect(next.length ? { path, revision, hunks: next } : undefined);
    else setStageHunks(next);
  };
  const stage = (hunks?: number[]): void => {
    if (area !== "staged" && revision) onStage({ path, area, revision, hunks });
  };
  return (
    <div className="min-w-0 border-t" data-git-diff>
      {data?.patch ? (
        <CodeBlock size="sm" className="rounded-none">
          <CodeBlockContent aria-label={t("逐行差异", locale)}>{data.patch}</CodeBlockContent>
        </CodeBlock>
      ) : (
        data?.diff && (
          <div
            className="[scrollbar-width:thin] overflow-x-auto outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
            tabIndex={0}
            aria-label={t("逐行差异", locale)}
          >
            <DiffLines
              diff={data.diff}
              path={path}
              lineTargets={data.lineTargets}
              onOpenLine={
                data.canOpen
                  ? (line) =>
                      void window.pi
                        .sessionOpenGitLine(composerId, { area, path, live }, line)
                        .catch((reason: unknown) => setError(String(reason)))
                  : undefined
              }
              hunkAction={(index) => (
                <>
                  {revision && data.selectableHunks && (
                    <label className="flex items-center gap-1.5 font-sans text-xs text-foreground">
                      <input
                        type="checkbox"
                        className="size-3.5 rounded-sm accent-brand focus-visible:ring-2 focus-visible:ring-ring"
                        data-git-select-hunk={index}
                        checked={selectedHunks.includes(index)}
                        disabled={blocked}
                        onChange={(event) => toggleHunk(index, event.currentTarget.checked)}
                      />
                      {t("选择区块 {0}", locale, [index + 1])}
                    </label>
                  )}
                  {referencePaths && workingDirectory && (
                    <Button
                      type="button"
                      size="xs"
                      variant="ghost"
                      className="font-sans"
                      onClick={(event) => annotate(index, event.currentTarget)}
                    >
                      <MessageSquarePlusIcon data-icon="inline-start" aria-hidden="true" />
                      {t("批注行…", locale)}
                    </Button>
                  )}
                </>
              )}
            />
          </div>
        )
      )}
      {error ? (
        <DiffStatus error message={error} />
      ) : (
        !data?.diff &&
        !data?.patch && <DiffStatus message={data ? "此文件没有可用的差异预览。" : "加载中…"} />
      )}
      {data?.diff?.truncated && <DiffStatus message="仅显示部分差异" />}
      {revision && (
        <div className="flex flex-wrap justify-end gap-2 border-t border-border px-3 py-2">
          {area === "staged" ? (
            <label className="flex items-center gap-1.5 text-xs">
              <input
                type="checkbox"
                className="size-3.5 rounded-sm accent-brand focus-visible:ring-2 focus-visible:ring-ring"
                disabled={blocked}
                checked={Boolean(selected && !selected.hunks)}
                onChange={(event) =>
                  onSelect(event.currentTarget.checked ? { path, revision } : undefined)
                }
              />
              {t("提交整个文件", locale)}
            </label>
          ) : (
            <>
              <Button size="sm" variant="outline" disabled={blocked} onClick={() => stage()}>
                {t("暂存文件", locale)}
              </Button>
              {data.selectableHunks && (
                <Button
                  size="sm"
                  variant="outline"
                  disabled={blocked || !stageHunks.length}
                  onClick={() => stage(stageHunks)}
                >
                  {t("暂存所选区块", locale)}
                </Button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}

export function GitCheckpointFilePreview({
  composerId,
  checkpointId,
  request,
  busy,
  onApplied,
}: {
  composerId: string;
  checkpointId: string;
  request: GitDiffRequest;
  busy: boolean;
  onApplied(): void;
}): JSX.Element {
  const locale = useLocale();
  const { path } = request;
  const [data, setData] = useState<GitCheckpointDiff>();
  const [selection, setSelection] = useState<number[]>([]);
  const [preview, setPreview] = useState<GitRollbackPreview>();
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [waiting, setWaiting] = useState(false);
  const [applyError, setApplyError] = useState("");
  const trigger = useRef<HTMLButtonElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const applied = useRef(false);

  useEffect(() => {
    let active = true;
    void window.pi.sessionGitCheckpointDiff(composerId, checkpointId, path).then(
      (result) => {
        if (active) setData(result);
      },
      (reason: unknown) => {
        if (active) setError(String(reason));
      },
    );
    return () => {
      active = false;
    };
  }, [checkpointId, path, composerId]);

  const review = async (button: HTMLButtonElement, hunks?: number[]): Promise<void> => {
    if (!data || waiting || busy) return;
    trigger.current = button;
    applied.current = false;
    setWaiting(true);
    setError("");
    setApplyError("");
    try {
      setPreview(
        await window.pi.sessionPreviewGitRollback(composerId, {
          checkpointId,
          path,
          hunks,
          revision: data.revision,
        }),
      );
      setOpen(true);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setWaiting(false);
    }
  };
  const apply = async (): Promise<void> => {
    if (waiting || !preview || applyError) return;
    setWaiting(true);
    try {
      await window.pi.sessionApplyGitRollback(composerId, preview.token);
      applied.current = true;
      setOpen(false);
    } catch (reason) {
      setApplyError(String(reason));
    } finally {
      setWaiting(false);
    }
  };
  return (
    <div className="min-w-0 border-t border-border" data-git-checkpoint-diff>
      {data?.diff && (
        <div
          className="[scrollbar-width:thin] overflow-x-auto outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          tabIndex={0}
          aria-label={t("逐行差异", locale)}
        >
          <DiffLines
            diff={data.diff}
            path={path}
            onOpenLine={
              data.canOpen
                ? (line) =>
                    void window.pi
                      .sessionOpenGitLine(composerId, request, line)
                      .catch((reason: unknown) => setError(String(reason)))
                : undefined
            }
            hunkAction={(index) =>
              data.hunks[index] ? (
                <label className="flex items-center gap-1.5 font-sans text-xs text-foreground">
                  <input
                    type="checkbox"
                    data-rollback-hunk={index}
                    className="size-3.5 rounded-sm accent-brand focus-visible:ring-2 focus-visible:ring-ring"
                    checked={selection.includes(index)}
                    onChange={(event) => {
                      const checked = event.currentTarget.checked;
                      setSelection((items) =>
                        checked ? [...items, index] : items.filter((item) => item !== index),
                      );
                    }}
                  />
                  {t("选择区块 {0}", locale, [index + 1])}
                </label>
              ) : null
            }
          />
        </div>
      )}
      {error && <DiffStatus error message={error} />}
      {data?.conflict && <DiffStatus error message={GIT_ROLLBACK_CONFLICT_LABELS[data.conflict]} />}
      {!data && !error && <DiffStatus message="加载中…" />}
      {data?.diff?.truncated && <DiffStatus message="仅显示部分差异" />}
      {(data?.wholeFile || data?.hunks.some(Boolean)) && (
        <div className="flex flex-wrap justify-end gap-2 border-t border-border px-3 py-2">
          {data.wholeFile && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy || waiting}
              onClick={(event) => void review(event.currentTarget)}
            >
              {t("预览撤销文件", locale)}
            </Button>
          )}
          {data.hunks.some(Boolean) && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy || waiting || selection.length === 0}
              onClick={(event) => void review(event.currentTarget, selection)}
            >
              {t("预览撤销所选区块", locale)}
            </Button>
          )}
        </div>
      )}
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next && !waiting) setOpen(false);
        }}
        onOpenChangeComplete={(next) => {
          if (next) return;
          setPreview(undefined);
          if (applied.current) onApplied();
        }}
      >
        {preview && (
          <DialogContent
            className="max-h-[calc(100dvh-2rem)] min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] gap-3 sm:max-w-2xl"
            showCloseButton={false}
            initialFocus={cancel}
            finalFocus={() =>
              applied.current
                ? trigger.current
                    ?.closest("[data-checkpoint-file]")
                    ?.querySelector<HTMLButtonElement>("button[aria-expanded]")
                : trigger.current
            }
          >
            <DialogHeader>
              <DialogTitle>{t("预览撤销范围", locale)}</DialogTitle>
              <DialogDescription className="wrap-anywhere">
                {t(
                  preview.operation === "delete"
                    ? "将删除 {0}"
                    : preview.operation === "create"
                      ? "将恢复 {0}"
                      : "将修改 {0}",
                  locale,
                  [preview.path],
                )}
              </DialogDescription>
            </DialogHeader>
            <div
              className="min-h-0 overflow-auto rounded-md border border-border outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
              tabIndex={0}
              aria-label={t("预览撤销范围", locale)}
            >
              <DiffLines diff={preview.diff} path={preview.path} />
              {preview.diff.truncated && <DiffStatus message="仅显示部分差异" />}
            </div>
            <div>
              {applyError && <DiffStatus error message={applyError} />}
              <DialogFooter>
                <Button
                  ref={cancel}
                  variant="outline"
                  disabled={waiting}
                  onClick={() => setOpen(false)}
                >
                  {t("取消", locale)}
                </Button>
                <Button
                  variant="destructive"
                  disabled={busy || waiting || Boolean(applyError)}
                  onClick={() => void apply()}
                >
                  {t(waiting ? "正在撤销…" : "确认撤销", locale)}
                </Button>
              </DialogFooter>
            </div>
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}
