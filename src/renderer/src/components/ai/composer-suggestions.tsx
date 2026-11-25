// @env browser
import { Popover } from "@base-ui/react/popover";
import { cn } from "cn";
import { CheckIcon } from "lucide-react";
import { Fragment, useLayoutEffect, useMemo, useRef, type JSX, type ReactNode } from "react";

import type { ComposerSelection } from "@renderer/lib/composer/types";
import type { ComposerSuggestion } from "@renderer/lib/types";

export function ComposerCaretMenu({
  selection,
  children,
}: {
  selection: ComposerSelection;
  children: ReactNode;
}): JSX.Element {
  const { caret, element } = selection;
  const anchor = useMemo(
    () => ({
      contextElement: element,
      getBoundingClientRect() {
        const rect = caret.getBoundingClientRect();
        if (rect.height > 0) return rect;
        const box = element.getBoundingClientRect();
        return new DOMRect(box.left + 16, box.top + 12, 0, 24);
      },
    }),
    [caret, element],
  );

  return (
    <Popover.Root open>
      <Popover.Portal>
        <Popover.Positioner
          anchor={anchor}
          positionMethod="fixed"
          side="top"
          align="start"
          sideOffset={7}
          collisionPadding={8}
          collisionAvoidance={{ side: "flip", align: "shift", fallbackAxisSide: "none" }}
          className="z-50"
        >
          <Popover.Popup
            initialFocus={false}
            finalFocus={false}
            role="presentation"
            className="w-max max-w-[min(38rem,calc(100vw-1rem),var(--available-width))] min-w-[min(22rem,calc(100vw-1rem))] overflow-hidden rounded-xl border border-border bg-popover text-popover-foreground shadow-lg"
          >
            {children}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

export function ComposerSuggestions({
  id,
  label,
  options,
  activeIndex,
  setActiveIndex,
  feedback,
  error,
}: {
  id: string;
  label: string;
  options: readonly ComposerSuggestion[];
  activeIndex: number;
  setActiveIndex(index: number): void;
  feedback: string;
  error?: string;
}): JSX.Element {
  const active = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!active.current || !list.current) return;
    const row = active.current.getBoundingClientRect();
    const viewport = list.current.getBoundingClientRect();
    list.current.scrollTop +=
      row.top < viewport.top ? row.top - viewport.top : Math.max(0, row.bottom - viewport.bottom);
  }, [activeIndex, options[activeIndex]?.id]);

  return (
    <div
      ref={list}
      className="max-h-[min(21rem,50dvh,calc(var(--available-height,100dvh)-2px))] overflow-y-auto overscroll-contain p-1"
    >
      <div id={id} role="listbox" aria-label={label}>
        {options.map(
          (
            { id: key, label: name, detail, group, shortcut, icon: Icon, attached, select },
            index,
          ) => (
            <Fragment key={key}>
              {group && options[index - 1]?.group !== group && (
                <div
                  aria-hidden="true"
                  className="px-2.5 pt-1.5 pb-0.5 text-xs leading-4 text-muted-foreground"
                >
                  {group}
                </div>
              )}
              <div
                id={id + "-" + index}
                ref={index === activeIndex ? active : undefined}
                role="option"
                aria-selected={index === activeIndex}
                aria-description={group}
                className={cn(
                  "flex min-h-7 cursor-pointer items-start gap-2 rounded-md px-2.5 py-1 text-[13px] leading-5",
                  index === activeIndex && "bg-accent",
                )}
                onMouseMove={() => setActiveIndex(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={select}
              >
                <Icon
                  aria-hidden="true"
                  className="mt-0.5 size-3.5 shrink-0 text-muted-foreground"
                />
                <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                  <span className="truncate" title={name}>
                    {name}
                  </span>
                  {detail && (
                    <span
                      className="line-clamp-2 text-xs wrap-anywhere text-muted-foreground"
                      title={detail}
                    >
                      {detail}
                    </span>
                  )}
                </span>
                {shortcut && (
                  <kbd
                    title={shortcut}
                    className="max-w-[32%] shrink-0 truncate font-mono text-[11px] text-muted-foreground"
                  >
                    {shortcut}
                  </kbd>
                )}
                {attached && <CheckIcon aria-hidden="true" className="mt-0.5 size-3.5 shrink-0" />}
              </div>
            </Fragment>
          ),
        )}
      </div>
      {error && (
        <p role="alert" className="px-2.5 py-1.5 text-xs wrap-anywhere text-destructive">
          {error}
        </p>
      )}
      {!error && options.length === 0 && (
        <p role="status" className="px-2.5 py-1.5 text-xs wrap-anywhere text-muted-foreground">
          {feedback}
        </p>
      )}
    </div>
  );
}
