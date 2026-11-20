// @env browser
import { useEffect, useRef, useState, type JSX } from "react";
import { Popover } from "@base-ui/react/popover";
import { Slider } from "@base-ui/react/slider";
import { Toolbar } from "@base-ui/react/toolbar";
import {
  ArrowLeftIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  RotateCcwIcon,
} from "lucide-react";
import { Button } from "@renderer/components/ui/button";
import { t, useLocale } from "@renderer/lib/i18n";
import { levelLabel } from "@renderer/lib/thinking-level";
import type { ComposerModelControlsProps } from "@renderer/lib/types";
import { useAgentStore } from "@renderer/stores/agent";
import { THINKING_LEVELS } from "@shared/constants";
import type { ThinkingLevel } from "@shared/contract";
import { selectThinkingLevel } from "@shared/thinking";
import { cn } from "cn";

export function ComposerModelControls({
  menu,
  setMenu,
  onError,
}: ComposerModelControlsProps): JSX.Element {
  const locale = useLocale();
  const settings = useAgentStore((state) => state.settings);
  const selectModel = useAgentStore((state) => state.selectModel);
  const setThinkingLevel = useAgentStore((state) => state.setThinkingLevel);
  const provider = settings?.providers.find(({ id }) => id === settings.activeProviderId);
  const models = provider?.models ?? [];
  const activeModel = models.find(({ id }) => id === provider?.modelId);
  const levels = settings?.thinkingLevels ?? THINKING_LEVELS;
  const defaultLevel = selectThinkingLevel(levels);
  const savedLevel = settings?.thinkingLevel ?? defaultLevel;
  const [preview, setPreview] = useState<ThinkingLevel | null>(null);
  const [saving, setSaving] = useState(false);
  const popup = useRef<HTMLDivElement>(null);
  const sliderInput = useRef<HTMLInputElement>(null);
  const modelList = useRef<HTMLDivElement>(null);
  const selectedModelRow = useRef<HTMLButtonElement>(null);
  const modelLink = useRef<HTMLButtonElement>(null);
  const backButton = useRef<HTMLButtonElement>(null);
  const level = selectThinkingLevel(levels, preview ?? savedLevel);
  const index = levels.indexOf(level);
  const thinkingTitle = t("思考强度", locale);
  const modelTitle = t("选择模型", locale);
  const modelName = activeModel?.name ?? modelTitle;
  const effort = t(levelLabel(level), locale);
  const choosingModel = menu === "model";
  const popupOpen = choosingModel || menu === "thinking";

  useEffect(() => {
    if (!popupOpen) return;

    // Focus moves with the view inside the already-open popover.
    const frame = requestAnimationFrame(() => {
      if (!choosingModel) {
        (sliderInput.current ?? modelLink.current)?.focus({ preventScroll: true });
        return;
      }

      const list = modelList.current;
      const selected = selectedModelRow.current;
      (selected ?? backButton.current)?.focus({ preventScroll: true });
      if (!list || !selected) return;
      const viewport = list.getBoundingClientRect();
      const row = selected.getBoundingClientRect();
      list.scrollTop +=
        row.top < viewport.top ? row.top - viewport.top : Math.max(0, row.bottom - viewport.bottom);
    });

    return () => cancelAnimationFrame(frame);
  }, [popupOpen, choosingModel]);

  const save = async (write: () => Promise<void>): Promise<boolean> => {
    if (saving) return false;
    setSaving(true);
    onError(null);
    try {
      await write();
      return true;
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
      return false;
    } finally {
      setPreview(null);
      setSaving(false);
    }
  };

  const commitLevel = (next: ThinkingLevel): void => {
    if (saving) return;
    if (next === savedLevel) {
      setPreview(null);
      return;
    }
    setPreview(next);
    void save(() => setThinkingLevel(next));
  };

  const returnToThinking = (): void => {
    if (modelList.current && popup.current?.contains(document.activeElement)) {
      popup.current.focus({ preventScroll: true });
    }
    setMenu((current) => (current === "model" ? "thinking" : current));
  };

  const commitModel = async (modelId: string): Promise<void> => {
    if (!provider || saving) return;
    if (modelId === activeModel?.id || (await save(() => selectModel(provider.id, modelId)))) {
      returnToThinking();
    }
  };

  return (
    <Popover.Root
      open={popupOpen}
      onOpenChange={(open) => {
        if (!open && !saving) setPreview(null);
        setMenu((current) => (open ? "thinking" : current === "permissions" ? current : null));
      }}
    >
      <Popover.Trigger
        type="button"
        aria-label={thinkingTitle}
        aria-description={modelName + " " + effort}
        title={thinkingTitle}
        disabled={!settings}
        className="bg-secondary/75 text-secondary-foreground hover:bg-accent focus-visible:ring-ring/55 data-popup-open:bg-accent flex h-8 min-w-0 max-w-64 items-center gap-1.5 rounded-full px-3 text-xs outline-none focus-visible:ring-2 focus-visible:ring-inset disabled:opacity-60"
      >
        <span className="truncate">{modelName}</span>
        <span className="text-muted-foreground shrink-0">{effort}</span>
        <ChevronDownIcon aria-hidden="true" className="text-muted-foreground size-3 shrink-0" />
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="top" align="end" sideOffset={8} className="z-50">
          <Popover.Popup
            ref={popup}
            initialFocus={() =>
              choosingModel
                ? (selectedModelRow.current ?? backButton.current)
                : (sliderInput.current ?? modelLink.current)
            }
            className="border-border/80 bg-popover text-popover-foreground flex max-h-[min(20rem,65dvh)] w-72 max-w-[calc(100vw-1.5rem)] origin-(--transform-origin) flex-col overflow-hidden rounded-xl border shadow-md outline-none transition-[opacity,translate] duration-100 data-ending-style:translate-y-1 data-ending-style:opacity-0 data-starting-style:translate-y-1 data-starting-style:opacity-0 motion-reduce:transition-none"
          >
            {choosingModel ? (
              <>
                <div className="border-border/70 bg-muted/45 flex shrink-0 items-center gap-1.5 border-b px-2 py-1.5">
                  <Button
                    ref={backButton}
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={t("返回思考强度", locale)}
                    title={t("返回思考强度", locale)}
                    onClick={returnToThinking}
                  >
                    <ArrowLeftIcon aria-hidden="true" className="size-3.5" />
                  </Button>
                  <Popover.Title className="text-muted-foreground text-xs">
                    {modelTitle}
                  </Popover.Title>
                </div>
                <Toolbar.Root
                  ref={modelList}
                  orientation="vertical"
                  aria-label={modelTitle}
                  aria-busy={saving}
                  onKeyDown={(event) => {
                    if (event.key !== "Home" && event.key !== "End") return;
                    event.preventDefault();
                    const rows = event.currentTarget.querySelectorAll("button");
                    rows[event.key === "Home" ? 0 : rows.length - 1]?.focus();
                  }}
                  className="min-h-0 overflow-y-auto overscroll-contain p-1 [scrollbar-gutter:stable] [scrollbar-width:thin]"
                >
                  {models.map((model) => {
                    const current = model.id === activeModel?.id;
                    return (
                      <Toolbar.Button
                        key={model.id}
                        ref={current ? selectedModelRow : undefined}
                        type="button"
                        aria-pressed={current}
                        disabled={saving}
                        onClick={() => void commitModel(model.id)}
                        className="hover:bg-accent focus-visible:ring-ring/55 aria-pressed:bg-accent/70 flex w-full items-start gap-2 rounded-lg px-2.5 py-1.5 text-left outline-none focus-visible:ring-1 focus-visible:ring-inset"
                      >
                        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span title={model.name} className="truncate text-[13px] leading-5">
                            {model.name}
                          </span>
                          {model.name !== model.id && (
                            <span
                              title={model.id}
                              className="text-muted-foreground truncate text-xs leading-4"
                            >
                              {model.id}
                            </span>
                          )}
                        </span>
                        {current && (
                          <CheckIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                        )}
                      </Toolbar.Button>
                    );
                  })}
                  {models.length === 0 && (
                    <p className="text-muted-foreground px-2.5 py-2 text-xs">
                      {t("当前提供方没有已保存的模型", locale)}
                    </p>
                  )}
                </Toolbar.Root>
              </>
            ) : (
              <div className="min-h-0 overflow-y-auto p-3">
                <div className="flex items-center justify-between gap-2">
                  <Popover.Title className="text-muted-foreground text-xs">
                    {thinkingTitle}
                  </Popover.Title>
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={t("恢复默认", locale)}
                    title={t("恢复默认", locale)}
                    disabled={level === defaultLevel || saving}
                    onClick={() => commitLevel(defaultLevel)}
                  >
                    <RotateCcwIcon aria-hidden="true" className="size-3.5" />
                  </Button>
                </div>
                <button
                  ref={modelLink}
                  type="button"
                  aria-label={modelTitle}
                  aria-description={activeModel?.name}
                  title={activeModel?.id}
                  onClick={() => {
                    popup.current?.focus({ preventScroll: true });
                    setMenu("model");
                  }}
                  className="hover:bg-accent focus-visible:ring-ring/55 -mx-1 flex max-w-[calc(100%+0.5rem)] flex-col items-start gap-0.5 rounded-lg px-1.5 py-1 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset"
                >
                  <span className="text-base leading-5 font-medium">{effort}</span>
                  <span className="text-muted-foreground flex max-w-full items-center gap-1 text-xs leading-4">
                    <span className="truncate">{modelName}</span>
                    <ChevronRightIcon aria-hidden="true" className="size-3 shrink-0" />
                  </span>
                </button>
                {levels.length > 1 && (
                  <Slider.Root
                    value={index}
                    max={levels.length - 1}
                    largeStep={1}
                    className="px-2"
                    onValueChange={(value) => {
                      if (!saving) setPreview(levels[value]);
                    }}
                    onValueCommitted={(value) => commitLevel(levels[value])}
                  >
                    <Slider.Control className="relative flex h-9 w-full cursor-pointer touch-none items-center">
                      <Slider.Track className="border-border/80 bg-muted relative h-5 w-full rounded-full border">
                        <Slider.Indicator className="bg-primary/85 rounded-full" />
                        <div
                          aria-hidden="true"
                          className="pointer-events-none absolute inset-x-0 inset-y-0 flex items-center justify-between"
                        >
                          {levels.map((step, stepIndex) => (
                            <span
                              key={step}
                              className={cn(
                                "size-[3px] rounded-full",
                                stepIndex < index
                                  ? "bg-primary-foreground/60"
                                  : "bg-muted-foreground/45",
                              )}
                            />
                          ))}
                        </div>
                        <Slider.Thumb
                          inputRef={sliderInput}
                          getAriaLabel={() => thinkingTitle}
                          aria-valuetext={t(levelLabel(level), locale)}
                          className="bg-popover border-primary/40 ring-ring/65 size-4 rounded-full border shadow-sm focus-within:ring-2 focus-within:ring-offset-2 focus-within:ring-offset-popover"
                        />
                      </Slider.Track>
                    </Slider.Control>
                  </Slider.Root>
                )}
                {levels.length > 1 && (
                  <div
                    className="text-muted-foreground flex justify-between px-0.5 text-xs"
                    aria-hidden="true"
                  >
                    <span>{t(levelLabel(levels[0]), locale)}</span>
                    <span>{t(levelLabel(levels[levels.length - 1]), locale)}</span>
                  </div>
                )}
              </div>
            )}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
