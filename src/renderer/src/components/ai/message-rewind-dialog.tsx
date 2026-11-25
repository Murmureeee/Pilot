// @env browser
import { useEffect, useRef, useState, type JSX, type RefObject } from "react";

import { Button } from "@renderer/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@renderer/components/ui/dialog";
import { showFeedback } from "@renderer/lib/feedback";
import { localizeError, t, useLocale } from "@renderer/lib/i18n";
import type { MessageRollbackPreview } from "@shared/contract";

import { DiffLines } from "./file-diff-preview";

export function MessageRewindDialog({
  composerId,
  messageId,
  open,
  trigger,
  onClose,
  onClosed,
}: {
  composerId: string;
  messageId: string;
  open: boolean;
  trigger: RefObject<HTMLButtonElement | null>;
  onClose(): void;
  onClosed(): void;
}): JSX.Element {
  const locale = useLocale();
  const cancel = useRef<HTMLButtonElement>(null);
  const applied = useRef(false);
  const [preview, setPreview] = useState<MessageRollbackPreview>();
  const [error, setError] = useState<string>();
  const [applying, setApplying] = useState(false);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!open) return;
    let active = true;
    applied.current = false;
    void window.pi.sessionPreviewMessageRollback(composerId, messageId).then(
      (result) => {
        if (active) setPreview(result);
      },
      (cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : String(cause));
      },
    );
    return () => {
      active = false;
    };
  }, [open, composerId, messageId, attempt]);

  const close = (): void => {
    setPreview(undefined);
    setError(undefined);
    onClose();
  };

  const confirm = async (): Promise<void> => {
    if (!preview?.token || applying || error) return;
    setApplying(true);
    try {
      await window.pi.sessionApplyMessageRollback(composerId, preview.token);
      applied.current = true;
      showFeedback("已回到所选回复");
      close();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setApplying(false);
    }
  };

  const refresh = (): void => {
    setError(undefined);
    setPreview(undefined);
    setAttempt((count) => count + 1);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next && !applying) close();
      }}
      onOpenChangeComplete={(next) => {
        if (!next) onClosed();
      }}
    >
      <DialogContent
        showCloseButton={false}
        initialFocus={cancel}
        finalFocus={() =>
          applied.current
            ? document.querySelector<HTMLElement>('main [contenteditable="true"]')
            : trigger.current
        }
        className="max-h-[calc(100dvh-2rem)] min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] gap-3 sm:max-w-2xl"
        data-message-rewind
      >
        <DialogHeader>
          <DialogTitle>{t("回到此处", locale)}</DialogTitle>
          <DialogDescription>
            {preview
              ? t("将从当前聊天移除所选回复之后的 {0} 条消息，并撤销下列任务改动。", locale, [
                  preview.removedMessages,
                ])
              : t("预览后续消息和任务改动。", locale)}
          </DialogDescription>
        </DialogHeader>
        <div
          className="min-h-0 min-w-0 overflow-auto overscroll-contain outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          tabIndex={0}
          aria-label={t("预览撤销范围", locale)}
        >
          {error && (
            <p role="alert" className="text-xs wrap-anywhere text-destructive">
              {localizeError(error, locale)}
            </p>
          )}
          {!preview && !error && (
            <p role="status" className="text-xs text-muted-foreground">
              {t("加载中…", locale)}
            </p>
          )}
          {preview && (
            <div className="grid gap-3">
              {preview.conflicts.length > 0 && (
                <ul role="alert" className="grid gap-1 text-xs wrap-anywhere text-destructive">
                  {preview.conflicts.map(({ path, reason }, index) => (
                    <li key={index}>
                      {path && <p className="font-mono">{path}</p>}
                      <p>{localizeError(reason, locale)}</p>
                    </li>
                  ))}
                </ul>
              )}
              {!preview.conflicts.length && !preview.files.length && (
                <p className="text-xs text-muted-foreground">{t("此范围只有会话消息。", locale)}</p>
              )}
              {preview.files.map(({ path, operation, diff }, index) => (
                <details
                  key={path}
                  open={index === 0}
                  className="min-w-0 rounded-lg border border-border"
                >
                  <summary className="cursor-pointer rounded-lg px-3 py-2 text-xs wrap-anywhere outline-none focus-visible:ring-2 focus-visible:ring-ring">
                    {t(
                      operation === "delete"
                        ? "将删除 {0}"
                        : operation === "create"
                          ? "将恢复 {0}"
                          : "将修改 {0}",
                      locale,
                      [path],
                    )}
                  </summary>
                  <div className="min-w-0 overflow-x-auto">
                    <DiffLines path={path} diff={diff} />
                    {diff.truncated && (
                      <p className="px-3 py-2 text-xs text-muted-foreground">
                        {t("仅显示部分差异", locale)}
                      </p>
                    )}
                  </div>
                </details>
              ))}
            </div>
          )}
        </div>
        <DialogFooter>
          {(error || Boolean(preview?.conflicts.length)) && (
            <Button variant="ghost" disabled={applying} onClick={refresh}>
              {t("重新预览", locale)}
            </Button>
          )}
          <Button ref={cancel} variant="outline" disabled={applying} onClick={close}>
            {t("取消", locale)}
          </Button>
          <Button
            variant="destructive"
            disabled={!preview?.token || applying || Boolean(error)}
            onClick={() => void confirm()}
          >
            {t(applying ? "正在撤销…" : "确认回到此处", locale)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
