// @env browser
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { CheckIcon, CopyIcon } from "lucide-react";
import { MESSAGE_JUMP } from "@renderer/lib/constants";
import { t } from "@renderer/lib/i18n";
import { messagePreview, turnPreviews } from "@renderer/lib/message-preview";
import type { VisibleTurns } from "@renderer/lib/types";
import { useAgentStore } from "@renderer/stores/agent";
import { cn } from "cn";
import type { UiMessage } from "@shared/contract";

function turnAt(anchors: HTMLCollectionOf<Element>, position: number): number {
  let start = 0;
  let end = anchors.length - 1;
  while (start < end) {
    const middle = Math.ceil((start + end) / 2);
    if (anchors[middle].getBoundingClientRect().top <= position) start = middle;
    else end = middle - 1;
  }
  return start;
}

function visibleTurns(viewport: HTMLElement, anchors: HTMLCollectionOf<Element>): VisibleTurns {
  const top = viewport.getBoundingClientRect().top;
  const height = viewport.clientHeight;
  const first = turnAt(anchors, top);
  const last = turnAt(anchors, top + height - 0.5);
  const scrollRange = viewport.scrollHeight - height;
  const atEnd = scrollRange > 2 && viewport.scrollTop >= scrollRange - 2;
  const current = atEnd ? last : turnAt(anchors, top + Math.min(72, height / 3));
  return { first, last, current };
}

function followTurn(track: HTMLElement | null, index: number): void {
  if (!track || track.scrollHeight <= track.clientHeight) return;
  const tick = track.children.item(index);
  if (tick instanceof HTMLElement) {
    track.scrollTop = tick.offsetTop - (track.clientHeight - tick.offsetHeight) / 2;
  }
}

export function MessageJump({
  messages,
  viewportRef,
  contentRef,
}: {
  messages: UiMessage[];
  viewportRef: RefObject<HTMLDivElement | null>;
  contentRef: RefObject<HTMLDivElement | null>;
}): JSX.Element | null {
  const locale = useAgentStore((s) => s.locale);
  const rulerRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLElement>(null);
  const [layout, setLayout] = useState({ gutter: 0, height: 0, width: 0 });
  const [reading, setReading] = useState<VisibleTurns>({ first: 0, last: 0, current: 0 });
  const [hoveredIndex, setHoveredIndex] = useState<number | null>(null);
  const [keyboardIndex, setKeyboardIndex] = useState<number | null>(null);
  const [previewCenter, setPreviewCenter] = useState<number | null>(null);
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const turns = useMemo(() => turnPreviews(messages), [messages]);
  const activeIndex = reading.current;
  const turnCount = turns.length;
  const hasEnoughTurns = turnCount >= MESSAGE_JUMP.minTurns;
  const selectedIndex = hoveredIndex ?? keyboardIndex;
  const selectedTurn = selectedIndex === null ? undefined : turns[selectedIndex];

  const {
    railMinWidth,
    railMaxWidth,
    railClearance,
    gutterGap,
    previewHalfHeight,
    previewMinWidth,
  } = MESSAGE_JUMP;
  const railInset = Math.max(
    railClearance,
    Math.min(MESSAGE_JUMP.railInset, layout.gutter - railMinWidth - railClearance),
  );
  const railWidth = Math.min(railMaxWidth, layout.gutter - railInset - railClearance);
  const railEnd = railInset + railWidth;
  const show = hasEnoughTurns && railWidth >= railMinWidth;
  const gutterSpace = layout.gutter - railEnd - 2 * gutterGap;
  const previewSpace =
    gutterSpace >= previewMinWidth ? gutterSpace : layout.width - railEnd - 2 * gutterGap;
  const previewWidth = Math.min(MESSAGE_JUMP.previewMaxWidth, previewSpace);
  const canPreview =
    show && previewWidth >= previewMinWidth && layout.height >= 2 * previewHalfHeight;

  useEffect(() => {
    if (!hasEnoughTurns) return;
    const viewport = viewportRef.current;
    const content = contentRef.current;
    if (!viewport || !content) return;

    const anchors = content.getElementsByClassName("message-scroller-user-item");
    const syncVisibleTurns = (): number => {
      const next = visibleTurns(viewport, anchors);
      setReading((prev) =>
        prev.first === next.first && prev.last === next.last && prev.current === next.current
          ? prev
          : next,
      );
      return next.current;
    };
    const followScroll = (): void => {
      followTurn(trackRef.current, syncVisibleTurns());
    };
    const measure = (): void => {
      const viewportRect = viewport.getBoundingClientRect();
      const contentInset = Number.parseFloat(window.getComputedStyle(content).paddingLeft);
      const gutter = Math.floor(
        content.getBoundingClientRect().left + contentInset - viewportRect.left,
      );
      const height = viewport.clientHeight;
      const width = viewport.clientWidth;
      setLayout((prev) =>
        prev.gutter === gutter && prev.height === height && prev.width === width
          ? prev
          : { gutter, height, width },
      );
      syncVisibleTurns();
    };
    const observer = new ResizeObserver(measure);
    observer.observe(viewport);
    observer.observe(content);
    viewport.addEventListener("scroll", followScroll, { passive: true });
    measure();
    return () => {
      viewport.removeEventListener("scroll", followScroll);
      observer.disconnect();
    };
  }, [contentRef, hasEnoughTurns, viewportRef]);

  useEffect(() => {
    if (show) return;
    setHoveredIndex(null);
    setKeyboardIndex(null);
  }, [show]);

  useLayoutEffect(() => {
    followTurn(trackRef.current, activeIndex);
  }, [activeIndex, layout.height, show, turnCount]);

  const measurePreview = useCallback((): void => {
    const track = trackRef.current;
    const ruler = rulerRef.current;
    const tick = selectedIndex === null ? null : track?.children.item(selectedIndex);
    if (!canPreview || !track || !ruler || !tick) {
      setPreviewCenter(null);
      return;
    }

    const bounds = track.getBoundingClientRect();
    const rect = tick.getBoundingClientRect();
    const center = rect.top + rect.height / 2;
    setPreviewCenter(
      center < bounds.top || center > bounds.bottom
        ? null
        : center - ruler.getBoundingClientRect().top,
    );
  }, [canPreview, selectedIndex]);

  useLayoutEffect(measurePreview, [measurePreview, layout.height, turnCount]);

  useEffect(() => {
    if (!canPreview || selectedIndex === null) return;
    const dismiss = (event: globalThis.KeyboardEvent): void => {
      if (event.key !== "Escape" || event.defaultPrevented) return;
      if (
        rulerRef.current?.contains(document.activeElement) &&
        !trackRef.current?.contains(document.activeElement)
      ) {
        const trigger = trackRef.current?.children.item(selectedIndex) as HTMLButtonElement | null;
        trigger?.focus({ preventScroll: true });
      }
      setHoveredIndex(null);
      setKeyboardIndex(null);
    };
    window.addEventListener("keydown", dismiss);
    return () => window.removeEventListener("keydown", dismiss);
  }, [canPreview, selectedIndex]);

  useEffect(() => {
    if (copiedId === null) return;
    const timeout = window.setTimeout(() => setCopiedId(null), 1500);
    return () => window.clearTimeout(timeout);
  }, [copiedId]);

  const selectByKeyboard = (event: KeyboardEvent<HTMLButtonElement>, index: number): void => {
    let next: number;
    switch (event.key) {
      case "ArrowUp":
        next = Math.max(0, index - 1);
        break;
      case "ArrowDown":
        next = Math.min(turnCount - 1, index + 1);
        break;
      case "Home":
        next = 0;
        break;
      case "End":
        next = turnCount - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    setHoveredIndex(null);
    setKeyboardIndex(next);
    const tick = trackRef.current?.children.item(next) as HTMLButtonElement | null;
    tick?.focus({ preventScroll: true });
    tick?.scrollIntoView(MESSAGE_JUMP.revealTickOptions);
  };

  const jump = (id: string): void => {
    const viewport = viewportRef.current;
    const target = document.getElementById(`msg-${id}`);
    if (!viewport || !target) return;
    const offset = target.getBoundingClientRect().top - viewport.getBoundingClientRect().top;
    // 平滑滚动途中的离屏消息会重新排版，改变远处目标的偏移量。
    viewport.scrollTo({
      top: viewport.scrollTop + offset - 12,
      behavior: "instant",
    });
  };

  const copyQuestion = async (id: string, question: string): Promise<void> => {
    try {
      await navigator.clipboard.writeText(question);
      setCopiedId(id);
    } catch {
      setCopiedId(null);
    }
  };

  if (!show) return null;

  return (
    <div
      ref={rulerRef}
      className="pointer-events-none absolute inset-y-0 z-10 flex items-center"
      style={{ left: railInset }}
      onPointerLeave={() => setHoveredIndex(null)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setKeyboardIndex(null);
      }}
    >
      <nav
        ref={trackRef}
        data-slot="turn-ruler"
        aria-label={t("会话轮次", locale)}
        className="pointer-events-auto relative max-h-[min(60%,24rem)] shrink-0 overflow-x-hidden overflow-y-auto overscroll-contain [scrollbar-width:none]"
        style={{ width: railWidth }}
        onScroll={measurePreview}
      >
        {turns.map((turn, index) => {
          const active = activeIndex === index;
          const inView = index >= reading.first && index <= reading.last;
          const isSelected = selectedIndex === index;
          const distance = selectedIndex === null ? Infinity : Math.abs(selectedIndex - index);
          const question = messagePreview(turn.question) || t("（空消息）", locale);
          return (
            <button
              key={turn.id}
              type="button"
              aria-label={t("第 {0} 轮，{1}", locale, [index + 1, question])}
              aria-current={active ? "location" : undefined}
              data-in-view={inView || undefined}
              tabIndex={index === (keyboardIndex ?? activeIndex) ? 0 : -1}
              title={canPreview ? undefined : question}
              onPointerEnter={(event) => {
                if (event.pointerType !== "touch") setHoveredIndex(index);
              }}
              onFocus={(event) => {
                setKeyboardIndex(event.currentTarget.matches(":focus-visible") ? index : null);
              }}
              onKeyDown={(event) => selectByKeyboard(event, index)}
              onClick={() => jump(turn.id)}
              className="focus-visible:ring-ring flex h-2.5 w-full cursor-pointer items-center rounded-xs outline-none focus-visible:ring-1 focus-visible:ring-inset"
            >
              <span
                aria-hidden="true"
                className={cn(
                  "h-0.5 rounded-full motion-safe:transition-[width,background-color] motion-safe:duration-150",
                  isSelected
                    ? "bg-foreground"
                    : active
                      ? "bg-foreground/80"
                      : inView
                        ? "bg-foreground/55"
                        : "bg-foreground/25",
                )}
                style={{
                  width: Math.min(
                    railWidth,
                    MESSAGE_JUMP.tickWidths[distance] ?? MESSAGE_JUMP.idleTickWidth,
                  ),
                }}
              />
            </button>
          );
        })}
      </nav>

      {canPreview && selectedTurn && previewCenter !== null && (
        <div
          className="pointer-events-auto absolute left-full -translate-y-1/2"
          style={{
            top: Math.max(
              previewHalfHeight,
              Math.min(previewCenter, layout.height - previewHalfHeight),
            ),
            width: previewWidth + gutterGap,
            paddingLeft: gutterGap,
          }}
        >
          <div
            data-slot="turn-preview"
            className="border-border/85 bg-popover rounded-xl border px-3 py-2 shadow-md"
          >
            <div className="flex min-h-6 items-center gap-2">
              <p className="min-w-0 flex-1 truncate text-[13px] font-medium">
                {messagePreview(selectedTurn.question, 72) || t("（空消息）", locale)}
              </p>
              {selectedTurn.question.trim() && (
                <button
                  type="button"
                  onClick={() => void copyQuestion(selectedTurn.id, selectedTurn.question)}
                  aria-label={t(copiedId === selectedTurn.id ? "已复制" : "复制提问", locale)}
                  title={t(copiedId === selectedTurn.id ? "已复制" : "复制提问", locale)}
                  className="text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-ring/40 grid size-6 shrink-0 place-items-center rounded-md outline-none focus-visible:ring-2"
                >
                  {copiedId === selectedTurn.id ? (
                    <CheckIcon
                      aria-hidden="true"
                      className="size-3.5 text-emerald-600 dark:text-emerald-400"
                    />
                  ) : (
                    <CopyIcon aria-hidden="true" className="size-3.5" strokeWidth={1.65} />
                  )}
                </button>
              )}
            </div>
            {selectedTurn.answer && (
              <p className="text-muted-foreground mt-0.5 line-clamp-3 text-pretty text-xs leading-[1.125rem] wrap-anywhere">
                {selectedTurn.answer}
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
