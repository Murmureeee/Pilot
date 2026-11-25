// @env browser
import { ChevronDownIcon, ChevronUpIcon, SearchIcon, XIcon } from "lucide-react";
import { useLayoutEffect, useRef, type JSX } from "react";

import { Button } from "@renderer/components/ui/button";
import { Input } from "@renderer/components/ui/input";
import { t, useLocale } from "@renderer/lib/i18n";
import { useAgentStore } from "@renderer/stores/agent";
import { CONVERSATION_QUERY_LENGTH } from "@shared/constants";
import type { TranscriptSnippet } from "@shared/contract";

export function ChatFindBar({
  sessionId,
  query,
  index,
  count,
  snippet,
  onQuery,
  onStep,
  onClose,
}: {
  sessionId: string;
  query: string;
  index: number;
  count: number;
  snippet?: TranscriptSnippet;
  onQuery(query: string): void;
  onStep(offset: number): void;
  onClose(): void;
}): JSX.Element {
  const locale = useLocale();
  const bar = useRef<HTMLElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const title = t("在当前会话中查找", locale);
  const previous = t("上一处匹配", locale);
  const next = t("下一处匹配", locale);
  const close = t("关闭查找", locale);

  useLayoutEffect(() => {
    const element = bar.current;
    const before = document.activeElement;
    input.current?.focus({ preventScroll: true });
    return () => {
      if (!element?.contains(document.activeElement) && document.activeElement !== document.body)
        return;
      requestAnimationFrame(() => {
        const { sessionId: activeSession, view, chatFind } = useAgentStore.getState();
        if (activeSession !== sessionId || view !== "chat" || chatFind) return;
        const restore =
          before instanceof HTMLElement &&
          before !== document.body &&
          before.getClientRects().length
            ? before
            : document.querySelector<HTMLElement>(
                "main :is([data-permission-card], [data-plan-review], [data-composer-editor])",
              );
        restore?.focus({ preventScroll: true });
      });
    };
  }, [sessionId]);

  return (
    <section
      ref={bar}
      role="search"
      aria-label={title}
      className="workspace-column flex shrink-0 flex-col gap-1.5 pt-2 pb-1"
      data-chat-find
      onKeyDown={(event) => {
        if (event.nativeEvent.isComposing || event.key !== "Escape") return;
        event.preventDefault();
        onClose();
      }}
    >
      <div className="flex min-w-0 items-center gap-1">
        <SearchIcon aria-hidden="true" className="me-1 size-4 shrink-0 text-muted-foreground" />
        <Input
          ref={input}
          type="search"
          aria-label={title}
          className="min-w-0 flex-1"
          data-chat-find-input
          maxLength={CONVERSATION_QUERY_LENGTH}
          value={query}
          onChange={(event) => onQuery(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.nativeEvent.isComposing || event.key !== "Enter") return;
            event.preventDefault();
            if (count) onStep(event.shiftKey ? -1 : 1);
          }}
        />
        <output
          className="px-1 text-xs whitespace-nowrap text-muted-foreground tabular-nums"
          data-chat-find-count
        >
          {query.trim() &&
            (count ? t("{0} / {1}", locale, [index + 1, count]) : t("没有匹配", locale))}
        </output>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={!count}
          onClick={() => onStep(-1)}
          aria-label={previous}
          title={previous}
        >
          <ChevronUpIcon />
        </Button>
        <Button
          variant="ghost"
          size="icon-sm"
          disabled={!count}
          onClick={() => onStep(1)}
          aria-label={next}
          title={next}
        >
          <ChevronDownIcon />
        </Button>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label={close} title={close}>
          <XIcon />
        </Button>
      </div>
      {snippet && (
        <p
          className="line-clamp-1 text-xs wrap-anywhere text-muted-foreground"
          data-chat-find-snippet
        >
          {snippet.before}
          <mark className="bg-primary text-primary-foreground">{snippet.match}</mark>
          {snippet.after}
        </p>
      )}
    </section>
  );
}
