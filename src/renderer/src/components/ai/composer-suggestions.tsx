// @env browser
import { Fragment, useLayoutEffect, useMemo, useRef, type JSX, type ReactNode } from "react";
import { Popover } from "@base-ui/react/popover";
import { CheckIcon } from "lucide-react";
import type { ComposerSelection } from "@renderer/lib/composer/types";
import type { ComposerSuggestion } from "@renderer/lib/types";
import { cn } from "cn";

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
            className="border-border bg-popover text-popover-foreground w-max min-w-[min(22rem,calc(100vw-1rem))] max-w-[min(38rem,calc(100vw-1rem),var(--available-width))] overflow-hidden rounded-xl border shadow-lg"
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
                  className="text-muted-foreground px-2.5 pt-1.5 pb-0.5 text-xs leading-4"
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
                  "flex h-7 cursor-pointer items-center gap-2 rounded-md px-2.5 text-[13px] leading-5 whitespace-nowrap",
                  index === activeIndex && "bg-accent",
                )}
                onMouseMove={() => setActiveIndex(index)}
                onMouseDown={(event) => event.preventDefault()}
                onClick={select}
              >
                <Icon aria-hidden="true" className="text-muted-foreground size-3.5 shrink-0" />
                <span className="flex min-w-0 flex-1 items-baseline gap-2">
                  <span
                    className={cn("min-w-0 truncate", detail && "max-w-[48%] shrink-0")}
                    title={name}
                  >
                    {name}
                  </span>
                  {detail && (
                    <span className="text-muted-foreground min-w-0 truncate text-xs" title={detail}>
                      {detail}
                    </span>
                  )}
                </span>
                {shortcut && (
                  <kbd
                    title={shortcut}
                    className="text-muted-foreground max-w-[26%] shrink-0 truncate font-mono text-[11px]"
                  >
                    {shortcut}
                  </kbd>
                )}
                {attached && <CheckIcon aria-hidden="true" className="size-3.5 shrink-0" />}
              </div>
            </Fragment>
          ),
        )}
      </div>
      {error && (
        <p role="alert" className="text-destructive wrap-anywhere px-2.5 py-1.5 text-xs">
          {error}
        </p>
      )}
      {!error && options.length === 0 && (
        <p role="status" className="text-muted-foreground wrap-anywhere px-2.5 py-1.5 text-xs">
          {feedback}
        </p>
      )}
    </div>
  );
}
