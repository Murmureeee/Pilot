// @env browser
import { useEffect, useRef, type JSX } from "react";
import { CheckIcon } from "lucide-react";
import type { ComposerSuggestion } from "@renderer/lib/types";
import { cn } from "cn";

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
  useEffect(() => {
    active.current?.scrollIntoView({ block: "nearest" });
  }, [activeIndex]);

  return (
    <div className="max-h-[min(18rem,34vh)] overflow-y-auto overscroll-contain p-1">
      {error ? (
        <p role="alert" className="text-destructive wrap-anywhere px-3 py-2 text-xs">
          {error}
        </p>
      ) : (
        options.length === 0 && (
          <p role="status" className="text-muted-foreground wrap-anywhere px-3 py-2 text-xs">
            {feedback}
          </p>
        )
      )}
      <div id={id} role="listbox" aria-label={label}>
        {options.map(({ id: key, label: name, detail, icon: Icon, attached, select }, index) => (
          <div
            key={key}
            id={id + "-" + index}
            ref={index === activeIndex ? active : undefined}
            role="option"
            aria-selected={index === activeIndex}
            className={cn(
              "flex cursor-pointer items-start gap-2.5 rounded-lg px-3 py-2 text-sm",
              index === activeIndex && "bg-accent text-accent-foreground",
            )}
            onMouseEnter={() => setActiveIndex(index)}
            onMouseDown={(event) => event.preventDefault()}
            onClick={select}
          >
            <Icon aria-hidden="true" className="text-muted-foreground mt-0.5 size-4 shrink-0" />
            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
              <span className="truncate" title={name}>
                {name}
              </span>
              {detail && (
                <span className="text-muted-foreground truncate text-xs" title={detail}>
                  {detail}
                </span>
              )}
            </span>
            {attached && <CheckIcon aria-hidden="true" className="size-4 shrink-0" />}
          </div>
        ))}
      </div>
    </div>
  );
}
