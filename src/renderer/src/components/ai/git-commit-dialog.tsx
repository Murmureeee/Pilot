// @env browser
import { GitCommitHorizontalIcon } from "lucide-react";
import { useId, useRef, useState, type JSX } from "react";

import { Button } from "@renderer/components/ui/button";
import { CodeBlock, CodeBlockContent } from "@renderer/components/ui/code-block";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@renderer/components/ui/dialog";
import { Textarea } from "@renderer/components/ui/textarea";
import { localizeError, t, useLocale } from "@renderer/lib/i18n";
import type { GitCommitPreview, GitCommitResult, GitPatchSelection } from "@shared/contract";

export function GitCommitDialog({
  composerId,
  selections,
  disabled,
  onApplied,
  onRefresh,
}: {
  composerId: string;
  selections: GitPatchSelection[];
  disabled: boolean;
  onApplied(result: GitCommitResult): void;
  onRefresh(): void;
}): JSX.Element {
  const locale = useLocale();
  const messageId = useId();
  const [preview, setPreview] = useState<GitCommitPreview>();
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState("");
  const trigger = useRef<HTMLButtonElement>(null);
  const messageField = useRef<HTMLTextAreaElement>(null);
  const committed = useRef<GitCommitResult>(null);
  const review = async (): Promise<void> => {
    if (waiting || disabled || !selections.length) return;
    setWaiting(true);
    setError("");
    committed.current = null;
    try {
      setPreview(await window.pi.sessionPreviewGitCommit(composerId, selections));
      setOpen(true);
    } catch (reason) {
      setError(String(reason));
      onRefresh();
    } finally {
      setWaiting(false);
    }
  };
  const commit = async (): Promise<void> => {
    if (!preview || waiting || disabled || !message.trim() || error) return;
    setWaiting(true);
    try {
      committed.current = await window.pi.sessionCommitGit(composerId, preview.token, message);
      setOpen(false);
    } catch (reason) {
      setError(String(reason));
      onRefresh();
    } finally {
      setWaiting(false);
    }
  };
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !waiting) {
          setError("");
          setOpen(false);
        }
      }}
      onOpenChangeComplete={(next) => {
        if (next) return;
        setPreview(undefined);
        if (committed.current) {
          setMessage("");
          onApplied(committed.current);
        }
      }}
    >
      <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-2">
        {selections.length > 0 && (
          <span className="text-xs text-muted-foreground" role="status">
            {t("已选 {0} 个文件", locale, [selections.length])}
          </span>
        )}
        <DialogTrigger
          render={<Button ref={trigger} variant="outline" size="xs" />}
          disabled={disabled || waiting || !selections.length}
          onClick={() => void review()}
        >
          <GitCommitHorizontalIcon data-icon="inline-start" aria-hidden="true" />
          {t(waiting && !preview ? "正在生成预览…" : "预览提交", locale)}
        </DialogTrigger>
      </div>
      {error && !preview && (
        <p role="alert" className="basis-full text-xs wrap-anywhere text-destructive">
          {localizeError(error, locale)}
        </p>
      )}
      {preview && (
        <DialogContent
          showCloseButton={false}
          className="max-h-[calc(100dvh-2rem)] min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-3 sm:max-w-3xl"
          initialFocus={messageField}
          finalFocus={() =>
            committed.current
              ? trigger.current
                  ?.closest("[data-review-layout]")
                  ?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
              : trigger.current
          }
        >
          <DialogHeader>
            <DialogTitle>{t("预览提交", locale)}</DialogTitle>
            <DialogDescription className="wrap-anywhere">
              {preview.branch
                ? t("提交到分支 {0}", locale, [preview.branch])
                : t("提交到游离 HEAD", locale)}
            </DialogDescription>
          </DialogHeader>
          <form
            className="flex min-h-0 min-w-0 flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              void commit();
            }}
          >
            <CodeBlock size="sm" className="min-h-0 flex-1">
              <CodeBlockContent
                tabIndex={0}
                aria-label={t("本次提交的差异", locale)}
                data-git-commit-patch
              >
                {preview.patch}
              </CodeBlockContent>
            </CodeBlock>
            <div className="flex shrink-0 flex-col gap-1.5">
              <label htmlFor={messageId} className="text-sm font-medium">
                {t("提交信息", locale)}
              </label>
              <Textarea
                ref={messageField}
                id={messageId}
                className="max-h-28"
                rows={3}
                required
                value={message}
                disabled={waiting}
                onChange={(event) => setMessage(event.currentTarget.value)}
              />
            </div>
            {error && (
              <p
                role="alert"
                className="max-h-20 overflow-y-auto text-xs wrap-anywhere text-destructive"
              >
                {localizeError(error, locale)}
              </p>
            )}
            <DialogFooter className="shrink-0">
              <Button
                type="button"
                variant="outline"
                disabled={waiting}
                onClick={() => {
                  setError("");
                  setOpen(false);
                }}
              >
                {t(error ? "返回选择" : "取消", locale)}
              </Button>
              <Button
                type="submit"
                disabled={disabled || waiting || !message.trim() || Boolean(error)}
              >
                {t(waiting ? "正在提交…" : "确认提交", locale)}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      )}
    </Dialog>
  );
}
