// @env browser
import { CopyIcon, GitForkIcon, HistoryIcon, PencilIcon, RotateCcwIcon } from "lucide-react";
import { useRef, useState, type JSX } from "react";

import { Button } from "@renderer/components/ui/button";
import { MessageFooter } from "@renderer/components/ui/message";
import { showFeedback, showFeedbackError } from "@renderer/lib/feedback";
import { t, useLocale } from "@renderer/lib/i18n";
import type { MessageBranchAction } from "@shared/contract";

import { MessageRewindDialog } from "./message-rewind-dialog";

export function MessageActions({
  composerId,
  messageId,
  kind,
  text,
  busy = false,
  hasLaterMessages = false,
}: {
  composerId: string;
  messageId: string;
  kind: "user" | "assistant";
  text: string;
  busy?: boolean;
  hasLaterMessages?: boolean;
}): JSX.Element {
  const locale = useLocale();
  const rewind = useRef<HTMLButtonElement>(null);
  const [rewindState, setRewindState] = useState<"open" | "closing">();
  const [branching, setBranching] = useState(false);

  const copy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(text);
      showFeedback("已复制");
    } catch (error) {
      showFeedbackError("无法复制消息。请重试。", error);
    }
  };

  const branch = async (action: MessageBranchAction): Promise<void> => {
    if (branching) return;
    setBranching(true);
    try {
      await window.pi.sessionBranchMessage(composerId, messageId, action);
    } catch (error) {
      showFeedbackError("无法处理这条消息。请重试。", error);
    } finally {
      setBranching(false);
    }
  };

  const copyLabel = t(kind === "user" ? "复制消息" : "复制回复", locale);
  const editLabel = t("编辑并重发", locale);
  const forkLabel = t("从此处分叉", locale);
  const retryLabel = t("重试回复", locale);
  const rewindLabel = t("回到此处", locale);

  return (
    <MessageFooter
      className="gap-0.5 px-0 group-hover/message:opacity-100 focus-within:opacity-100 [@media(hover:hover)]:opacity-0"
      aria-label={t("消息操作", locale)}
      role="group"
      data-message-actions={kind}
    >
      {text && (
        <Button
          variant="ghost"
          size="icon-sm"
          aria-label={copyLabel}
          title={copyLabel}
          onClick={() => void copy()}
        >
          <CopyIcon aria-hidden="true" />
        </Button>
      )}
      {kind === "user" ? (
        <>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={editLabel}
            title={editLabel}
            disabled={branching}
            onClick={() => void branch("edit")}
          >
            <PencilIcon aria-hidden="true" />
          </Button>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={forkLabel}
            title={forkLabel}
            disabled={branching}
            onClick={() => void branch("fork")}
          >
            <GitForkIcon aria-hidden="true" />
          </Button>
        </>
      ) : (
        <>
          <Button
            variant="ghost"
            size="icon-sm"
            aria-label={retryLabel}
            title={retryLabel}
            disabled={busy || branching}
            onClick={() => void branch("retry")}
          >
            <RotateCcwIcon aria-hidden="true" />
          </Button>
          {hasLaterMessages && (
            <Button
              ref={rewind}
              variant="ghost"
              size="icon-sm"
              aria-label={rewindLabel}
              title={rewindLabel}
              disabled={busy}
              onClick={() => setRewindState("open")}
            >
              <HistoryIcon aria-hidden="true" />
            </Button>
          )}
          {rewindState && (
            <MessageRewindDialog
              composerId={composerId}
              messageId={messageId}
              open={rewindState === "open"}
              trigger={rewind}
              onClose={() => setRewindState("closing")}
              onClosed={() => setRewindState(undefined)}
            />
          )}
        </>
      )}
    </MessageFooter>
  );
}
