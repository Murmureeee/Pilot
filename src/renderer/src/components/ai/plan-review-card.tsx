// @env browser
import { cn } from "cn";
import { ClipboardCheckIcon } from "lucide-react";
import { useEffect, useId, useRef, useState, type JSX } from "react";

import { Alert, AlertDescription } from "@renderer/components/ui/alert";
import { Button } from "@renderer/components/ui/button";
import { Textarea } from "@renderer/components/ui/textarea";
import {
  APPROVAL_MODE_OPTIONS,
  COMPOSER_SURFACE_CLASS,
  PERMISSION_ATTENTION_TEXT,
} from "@renderer/lib/constants";
import { localizeError, t, useLocale } from "@renderer/lib/i18n";
import { PLAN_PROPOSAL_MAX_LENGTH } from "@shared/constants";
import type { ApprovalMode, PlanDecision, PlanProposal } from "@shared/contract";

import { Response } from "./response";

export function PlanReviewCard({
  composerId,
  proposal,
  executionMode,
}: {
  composerId: string;
  proposal: PlanProposal;
  executionMode: ApprovalMode;
}): JSX.Element {
  const locale = useLocale();
  const titleId = useId();
  const descriptionId = useId();
  const card = useRef<HTMLElement>(null);
  const textarea = useRef<HTMLTextAreaElement>(null);
  const editButton = useRef<HTMLButtonElement>(null);
  const openedEditor = useRef(false);
  const [draft, setDraft] = useState<string | null>(null);
  const [pending, setPending] = useState<PlanDecision["type"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const editing = draft !== null;

  useEffect(() => {
    if (editing) {
      textarea.current?.focus();
      return;
    }
    const active = document.activeElement;
    if (!active || active === document.body || active.getClientRects().length === 0) {
      const target = openedEditor.current ? editButton.current : card.current;
      target?.focus({ preventScroll: true });
    }
  }, [editing]);

  const respond = async (decision: PlanDecision): Promise<void> => {
    if (pending) return;
    setPending(decision.type);
    setError(null);
    try {
      await window.pi.sessionReviewPlan(composerId, proposal.id, decision);
      if (decision.type === "save") setDraft(null);
    } catch (cause) {
      setError(localizeError(cause instanceof Error ? cause.message : String(cause), locale));
    } finally {
      setPending(null);
    }
  };

  const cancelEdit = (): void => {
    setError(null);
    setDraft(null);
  };

  return (
    <section
      ref={card}
      tabIndex={0}
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      data-plan-review
      onKeyDown={(event) => {
        if (event.key !== "Escape" || !editing || pending || event.nativeEvent.isComposing) return;
        event.preventDefault();
        cancelEdit();
      }}
      className={cn(
        COMPOSER_SURFACE_CLASS,
        "flex max-h-[min(30rem,calc(100dvh-7rem))] min-w-0 flex-col gap-2 overflow-hidden border px-4 py-3 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
      )}
    >
      <div role="alert">
        <div
          className={cn("flex items-center gap-2 text-sm font-medium", PERMISSION_ATTENTION_TEXT)}
        >
          <ClipboardCheckIcon className="size-4 shrink-0" aria-hidden="true" />
          <h2 id={titleId}>{t("等待确认计划", locale)}</h2>
        </div>
        <p id={descriptionId} className="mt-1 text-xs text-muted-foreground">
          {t("确认后使用「{0}」执行此计划。", locale, [
            t(APPROVAL_MODE_OPTIONS[executionMode].label, locale),
          ])}
        </p>
      </div>
      {draft !== null ? (
        <Textarea
          ref={textarea}
          aria-label={t("计划内容", locale)}
          className="field-sizing-fixed min-h-0 flex-1"
          maxLength={PLAN_PROPOSAL_MAX_LENGTH}
          rows={8}
          value={draft}
          readOnly={pending === "save"}
          onChange={(event) => setDraft(event.currentTarget.value)}
        />
      ) : (
        <div
          role="region"
          aria-label={t("计划内容", locale)}
          tabIndex={0}
          className="min-h-0 overflow-auto rounded-lg px-2 py-1 text-sm wrap-anywhere outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
        >
          <Response content={proposal.markdown} />
        </div>
      )}
      {error && (
        <Alert variant="destructive" className="shrink-0 px-3 py-2">
          <AlertDescription className="wrap-anywhere text-destructive">{error}</AlertDescription>
        </Alert>
      )}
      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
        {draft !== null ? (
          <>
            <Button size="sm" variant="outline" disabled={pending !== null} onClick={cancelEdit}>
              {t("取消编辑", locale)}
            </Button>
            <Button
              size="sm"
              disabled={!draft.trim() || pending !== null}
              onClick={() => void respond({ type: "save", markdown: draft })}
            >
              {t(pending === "save" ? "保存中…" : "保存计划", locale)}
            </Button>
          </>
        ) : (
          <>
            <Button
              size="sm"
              variant="ghost"
              className="me-auto"
              disabled={pending !== null}
              onClick={() => void respond({ type: "discard" })}
            >
              {t("放弃计划", locale)}
            </Button>
            <Button
              ref={editButton}
              size="sm"
              variant="outline"
              disabled={pending !== null}
              onClick={() => {
                openedEditor.current = true;
                setError(null);
                setDraft(proposal.markdown);
              }}
            >
              {t("编辑计划", locale)}
            </Button>
            <Button
              size="sm"
              disabled={pending !== null}
              onClick={() => void respond({ type: "execute" })}
            >
              {t(pending === "execute" ? "正在启动…" : "确认并执行", locale)}
            </Button>
          </>
        )}
      </div>
    </section>
  );
}
