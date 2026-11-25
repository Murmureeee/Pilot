// @env browser
import { cn } from "cn";
import { LoaderCircleIcon, Undo2Icon } from "lucide-react";
import { Fragment, useEffect, useRef, useState, type JSX, type ReactNode } from "react";

import { Button } from "@renderer/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@renderer/components/ui/dialog";
import { loadHighlighter } from "@renderer/lib/highlighter";
import { localizeError, t, useLocale } from "@renderer/lib/i18n";
import { useFileChangesStore } from "@renderer/stores/file-changes";
import type { FileChangeSummary, FileDiff, FileDiffLine } from "@shared/contract";

function hunkHeader(lines: FileDiffLine[]): string {
  const before = lines.find((line) => line.before !== undefined)?.before ?? 0;
  const after = lines.find((line) => line.after !== undefined)?.after ?? 0;
  return (
    "@@ -" +
    before +
    "," +
    lines.filter((line) => line.before !== undefined).length +
    " +" +
    after +
    "," +
    lines.filter((line) => line.after !== undefined).length +
    " @@"
  );
}

async function highlightDiff(diff: FileDiff, path: string): Promise<ReactNode[][] | null> {
  const extension = path.match(/\.([a-z\d]+)$/i)?.[1];
  if (!extension) return null;
  const highlighter = await loadHighlighter(extension);
  if (!highlighter) return null;

  return diff.hunks.map((hunk) => {
    const original = hunk.filter((line) => line.kind !== "added");
    const modified = hunk.filter((line) => line.kind !== "removed");
    // Highlight each version separately so deleted text can't change how added lines are parsed.
    const before = highlighter.highlight(original.map((line) => line.text).join("\n")).lines;
    const after = highlighter.highlight(modified.map((line) => line.text).join("\n")).lines;
    let beforeIndex = 0;
    let afterIndex = 0;
    return hunk.map((line) => {
      if (line.kind === "removed") return before[beforeIndex++];
      if (line.kind === "context") beforeIndex++;
      return after[afterIndex++];
    });
  });
}

export function DiffLines({
  diff,
  path,
  onOpenLine,
  lineTargets,
  hunkAction,
}: {
  diff: FileDiff;
  path: string;
  onOpenLine?(line: number): void;
  lineTargets?: Record<number, number>;
  hunkAction?(index: number): ReactNode;
}): JSX.Element {
  const locale = useLocale();
  const [highlighted, setHighlighted] = useState<ReactNode[][] | null>(null);

  useEffect(() => {
    if (!diff.hunks.length) return;
    let active = true;
    void highlightDiff(diff, path).then(
      (result) => {
        if (active) setHighlighted(result);
      },
      () => {
        if (active) setHighlighted(null);
      },
    );
    return () => {
      active = false;
    };
  }, [diff, path]);

  if (diff.hunks.length === 0) {
    return <p className="px-4 py-5 text-xs text-muted-foreground">{t("没有文本行变更", locale)}</p>;
  }
  return (
    <table className="min-w-full border-collapse text-left font-mono text-xs leading-5">
      <caption className="sr-only">{t("逐行差异", locale)}</caption>
      <tbody>
        {diff.hunks.map((hunk, hunkIndex) => (
          <Fragment key={hunkIndex}>
            <tr className="bg-secondary/65 text-muted-foreground">
              <td colSpan={4} className="px-3 py-0.5">
                <div className="flex flex-wrap items-center gap-x-3">
                  {hunkHeader(hunk)}
                  {hunkAction?.(hunkIndex)}
                </div>
              </td>
            </tr>
            {hunk.map((line, lineIndex) => {
              const target =
                line.after === undefined || !lineTargets ? line.after : lineTargets[line.after];
              return (
                <tr
                  key={lineIndex}
                  data-diff-line={line.kind}
                  className={cn(
                    line.kind === "added" && "bg-emerald-500/10 dark:bg-emerald-500/15",
                    line.kind === "removed" && "bg-destructive/10 dark:bg-destructive/15",
                  )}
                >
                  <td className="w-9 min-w-9 px-1.5 text-right text-muted-foreground tabular-nums select-none">
                    {line.before}
                  </td>
                  <td className="w-9 min-w-9 px-1.5 text-right text-muted-foreground tabular-nums select-none">
                    {target !== undefined && onOpenLine ? (
                      <button
                        type="button"
                        title={t("在 VS Code 中打开第 {0} 行", locale, [target])}
                        aria-label={t("在 VS Code 中打开第 {0} 行", locale, [target])}
                        className="rounded-sm underline underline-offset-2 outline-none hover:text-brand focus-visible:ring-2 focus-visible:ring-ring/50"
                        onClick={() => onOpenLine(target)}
                      >
                        {line.after}
                      </button>
                    ) : (
                      line.after
                    )}
                  </td>
                  <td
                    className={cn(
                      "w-5 min-w-5 text-center select-none",
                      line.kind === "added" && "text-emerald-700 dark:text-emerald-400",
                      line.kind === "removed" && "text-destructive",
                    )}
                  >
                    {line.kind === "added" ? "+" : line.kind === "removed" ? "−" : " "}
                  </td>
                  <td className="pr-4 whitespace-pre">
                    {line.text ? (highlighted?.[hunkIndex]?.[lineIndex] ?? line.text) : " "}
                    {line.noNewline && (
                      <span className="ml-3 text-muted-foreground select-none">
                        {t("末尾无换行", locale)}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </Fragment>
        ))}
      </tbody>
    </table>
  );
}

export function FileDiffPreview({
  sessionId,
  change,
  busy,
  confirming,
  active,
}: {
  sessionId: string;
  change: FileChangeSummary;
  busy: boolean;
  confirming: boolean;
  active: boolean;
}): JSX.Element {
  const locale = useLocale();
  const [diff, setDiff] = useState<FileDiff | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [undoError, setUndoError] = useState<string | null>(null);
  const [undoing, setUndoing] = useState(false);
  const [retry, setRetry] = useState(0);
  const undoButton = useRef<HTMLButtonElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const confirmUndo = useFileChangesStore((state) => state.confirmUndo);
  const cancelUndo = useFileChangesStore((state) => state.cancelUndo);
  const available = change.stats !== undefined;

  useEffect(() => {
    if (!available) return;
    let mounted = true;
    void window.pi.sessionFileDiff(sessionId, change.id).then(
      (result) => {
        if (mounted) setDiff(result);
      },
      (error: unknown) => {
        if (mounted) setLoadError(String(error instanceof Error ? error.message : error));
      },
    );
    return () => {
      mounted = false;
    };
  }, [available, change.id, retry, sessionId]);

  const undo = async (): Promise<void> => {
    setUndoing(true);
    setUndoError(null);
    try {
      await window.pi.sessionUndoFileChange(sessionId, change.id);
      cancelUndo(change.id);
    } catch (error) {
      setUndoError(error instanceof Error ? error.message : String(error));
    } finally {
      setUndoing(false);
    }
  };

  return (
    <div className="min-w-0 border-t" data-file-diff>
      <div
        className="relative [scrollbar-width:thin] overflow-x-auto"
        tabIndex={diff ? 0 : undefined}
        aria-label={diff ? t("逐行差异", locale) : undefined}
      >
        {diff ? (
          <DiffLines diff={diff} path={change.path} />
        ) : loadError ? (
          <div className="flex flex-wrap items-center justify-between gap-2 px-4 py-3">
            <p role="alert" className="text-xs wrap-anywhere text-destructive">
              {localizeError(loadError, locale)}
            </p>
            <Button
              variant="outline"
              size="xs"
              onClick={() => {
                setLoadError(null);
                setRetry((value) => value + 1);
              }}
            >
              {t("重试", locale)}
            </Button>
          </div>
        ) : !available ? (
          <p className="px-4 py-5 text-xs text-muted-foreground">
            {t("此文件没有可用的差异预览。", locale)}
          </p>
        ) : (
          <p
            role="status"
            className="flex items-center gap-2 px-4 py-5 text-xs text-muted-foreground"
          >
            <LoaderCircleIcon aria-hidden="true" className="size-3.5 motion-safe:animate-spin" />
            {t("加载中…", locale)}
          </p>
        )}
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-2 border-t border-border px-3 py-2">
        <div className="min-w-0 flex-1 text-xs">
          {change.reverted && (
            <p role="status" className="text-muted-foreground">
              {t("已撤销", locale)}
            </p>
          )}
          {diff?.truncated && (
            <p className="text-muted-foreground">{t("仅显示部分差异", locale)}</p>
          )}
        </div>
        {available && !change.reverted && (
          <Dialog
            open={active && confirming}
            onOpenChange={(open) => {
              if (!open && !undoing) cancelUndo(change.id);
            }}
          >
            <Button
              ref={undoButton}
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => {
                setUndoError(null);
                confirmUndo(change.id);
              }}
            >
              <Undo2Icon data-icon="inline-start" aria-hidden="true" />
              {t("撤销…", locale)}
            </Button>
            {active && confirming && (
              <DialogContent
                showCloseButton={false}
                initialFocus={cancelButton}
                finalFocus={() =>
                  undoButton.current ?? document.getElementById("change-file-" + change.id)
                }
              >
                <DialogHeader>
                  <DialogTitle>{t("预览撤销范围", locale)}</DialogTitle>
                  <DialogDescription className="wrap-anywhere">
                    {t(
                      change.kind === "created"
                        ? "撤销会删除 Agent 新建的文件。"
                        : "撤销会将文件还原到本次写入之前。",
                      locale,
                    )}
                  </DialogDescription>
                </DialogHeader>
                <p className="font-mono text-sm wrap-anywhere">{change.path}</p>
                {undoError && (
                  <p role="alert" className="text-xs wrap-anywhere text-destructive">
                    {localizeError(undoError, locale)}
                  </p>
                )}
                <DialogFooter>
                  <Button
                    ref={cancelButton}
                    variant="outline"
                    disabled={undoing}
                    onClick={() => cancelUndo(change.id)}
                  >
                    {t("取消", locale)}
                  </Button>
                  <Button
                    variant="destructive"
                    disabled={busy || undoing}
                    onClick={() => void undo()}
                  >
                    {t(undoing ? "正在撤销…" : "确认撤销", locale)}
                  </Button>
                </DialogFooter>
              </DialogContent>
            )}
          </Dialog>
        )}
      </div>
    </div>
  );
}
