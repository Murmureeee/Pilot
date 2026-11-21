// @env browser
import { useEffect, useState, type JSX } from "react";
import { Button } from "@renderer/components/ui/button";
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
import type {
  GitCheckpointDiff,
  GitDiffRequest,
  GitFileDiff,
  GitRollbackPreview,
} from "@shared/contract";
import { DiffLines } from "./file-diff-preview";

function DiffStatus({ message, error = false }: { message: string; error?: boolean }): JSX.Element {
  const locale = useLocale();
  return (
    <p
      role={error ? "alert" : "status"}
      className={
        error
          ? "text-destructive wrap-anywhere px-3 py-2 text-xs"
          : "text-muted-foreground px-3 py-2 text-xs"
      }
    >
      {localizeError(message, locale)}
    </p>
  );
}

export function GitDiffPreview({
  composerId,
  request,
}: {
  composerId: string;
  request: GitDiffRequest;
}): JSX.Element {
  const locale = useLocale();
  const { area, path } = request;
  const [data, setData] = useState<GitFileDiff>();
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void window.pi.sessionGitDiff(composerId, { area, path }).then(
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
  }, [area, path, composerId]);
  return (
    <div className="min-w-0 border-t" data-git-diff>
      {data?.diff && (
        <div
          className="overflow-x-auto [scrollbar-width:thin]"
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
                      .sessionOpenGitLine(composerId, { area, path }, line)
                      .catch((reason: unknown) => setError(String(reason)))
                : undefined
            }
          />
        </div>
      )}
      {error ? (
        <DiffStatus error message={error} />
      ) : (
        !data?.diff && <DiffStatus message={data ? "此文件没有可用的差异预览。" : "加载中…"} />
      )}
      {data?.diff?.truncated && <DiffStatus message="仅显示部分差异" />}
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
  const [error, setError] = useState("");
  const [waiting, setWaiting] = useState(false);
  const [applyError, setApplyError] = useState("");

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

  const review = async (hunks?: number[]): Promise<void> => {
    if (!data || waiting || busy) return;
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
      setPreview(undefined);
      onApplied();
    } catch (reason) {
      setApplyError(String(reason));
    } finally {
      setWaiting(false);
    }
  };
  return (
    <div className="border-border min-w-0 border-t" data-git-checkpoint-diff>
      {data?.diff && (
        <div
          className="overflow-x-auto [scrollbar-width:thin]"
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
                <label className="text-foreground flex items-center gap-1.5 font-sans text-xs">
                  <input
                    type="checkbox"
                    data-rollback-hunk={index}
                    className="accent-primary size-3.5"
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
        <div className="border-border flex flex-wrap justify-end gap-2 border-t px-3 py-2">
          {data.wholeFile && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy || waiting}
              onClick={() => void review()}
            >
              {t("预览撤销文件", locale)}
            </Button>
          )}
          {data.hunks.some(Boolean) && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy || waiting || selection.length === 0}
              onClick={() => void review(selection)}
            >
              {t("预览撤销所选区块", locale)}
            </Button>
          )}
        </div>
      )}
      <Dialog
        open={Boolean(preview)}
        onOpenChange={(open) => {
          if (!open && !waiting) setPreview(undefined);
        }}
      >
        {preview && (
          <DialogContent
            className="max-h-[calc(100dvh-2rem)] min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] gap-3 sm:max-w-2xl"
            showCloseButton={false}
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
              className="border-border min-h-0 overflow-auto rounded-md border"
              tabIndex={0}
              aria-label={t("预览撤销范围", locale)}
            >
              <DiffLines diff={preview.diff} path={preview.path} />
              {preview.diff.truncated && <DiffStatus message="仅显示部分差异" />}
            </div>
            <div>
              {applyError && <DiffStatus error message={applyError} />}
              <DialogFooter>
                <Button variant="outline" disabled={waiting} onClick={() => setPreview(undefined)}>
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
