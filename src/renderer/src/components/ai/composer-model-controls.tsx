// @env browser
import { Popover } from "@base-ui/react/popover";
import { Slider } from "@base-ui/react/slider";
import { Toolbar } from "@base-ui/react/toolbar";
import { cn } from "cn";
import {
  ArrowLeftIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  RotateCcwIcon,
} from "lucide-react";
import { useEffect, useRef, useState, type JSX } from "react";

import { Button } from "@renderer/components/ui/button";
import { COMPOSER_MODEL_OPTION_CLASS } from "@renderer/lib/constants";
import { displayProviderName, t, useLocale } from "@renderer/lib/i18n";
import { levelLabel } from "@renderer/lib/thinking-level";
import type { ComposerModelControlsProps } from "@renderer/lib/types";
import { selectComposerSettings, useAgentStore } from "@renderer/stores/agent";
import { THINKING_LEVELS } from "@shared/constants";
import type { SessionModelSelection, ThinkingLevel } from "@shared/contract";
import { effectiveModelCapabilities } from "@shared/model-capabilities";
import { hasSavedModel, resolveSessionModel } from "@shared/providers";
import { selectThinkingLevel } from "@shared/thinking";

export function ComposerModelControls({
  menu,
  setMenu,
  onError,
}: ComposerModelControlsProps): JSX.Element {
  const locale = useLocale();
  const settings = useAgentStore((state) => state.settings);
  const updateSessionSettings = useAgentStore((state) => state.updateSessionSettings);
  const setThinkingLevel = useAgentStore((state) => state.setThinkingLevel);
  const sessionModel = useAgentStore((state) => selectComposerSettings(state).model);
  const selection = settings ? resolveSessionModel(settings, sessionModel) : undefined;
  const providers = settings?.providers.filter(({ models }) => models.length > 0) ?? [];
  const provider = providers.find(({ id }) => id === selection?.providerId);
  const activeModel = provider?.models.find(({ id }) => id === selection?.modelId);
  const capabilities =
    activeModel && effectiveModelCapabilities(activeModel.automatic, activeModel.overrides);
  const supportsThinking = capabilities?.supportsThinking ?? false;
  const defaultProvider = providers.find(({ id }) => id === settings?.activeProviderId);
  const defaultModel = defaultProvider?.models.find(({ id }) => id === defaultProvider.modelId);
  const usingDefault = !sessionModel || !hasSavedModel(providers, sessionModel);
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
  const summaryTitle = supportsThinking ? thinkingTitle : modelTitle;
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

  const commitModel = async (model: SessionModelSelection | null): Promise<void> => {
    if (saving) return;
    const unchanged = model
      ? model.providerId === sessionModel?.providerId && model.modelId === sessionModel.modelId
      : sessionModel === undefined;
    if (unchanged || (await save(() => updateSessionSettings({ model })))) {
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
        aria-label={summaryTitle}
        aria-description={supportsThinking ? modelName + " " + effort : modelName}
        title={summaryTitle}
        disabled={!settings}
        className="flex h-8 max-w-64 min-w-0 items-center gap-1.5 rounded-full bg-secondary/75 px-3 text-xs text-secondary-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/55 focus-visible:ring-inset disabled:opacity-60 data-popup-open:bg-accent"
      >
        <span className="truncate">{modelName}</span>
        {supportsThinking && <span className="shrink-0 text-muted-foreground">{effort}</span>}
        <ChevronDownIcon aria-hidden="true" className="size-3 shrink-0 text-muted-foreground" />
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
            className="flex max-h-[min(20rem,65dvh)] w-72 max-w-[calc(100vw-1.5rem)] origin-(--transform-origin) flex-col overflow-hidden rounded-xl border border-border/80 bg-popover text-popover-foreground shadow-md transition-[opacity,translate] duration-100 outline-none data-ending-style:translate-y-1 data-ending-style:opacity-0 data-starting-style:translate-y-1 data-starting-style:opacity-0 motion-reduce:transition-none"
          >
            {choosingModel ? (
              <>
                <div className="flex shrink-0 items-center gap-1.5 border-b border-border/70 bg-muted/45 px-2 py-1.5">
                  <Button
                    ref={backButton}
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    aria-label={t(supportsThinking ? "返回思考强度" : "返回当前模型", locale)}
                    title={t(supportsThinking ? "返回思考强度" : "返回当前模型", locale)}
                    onClick={returnToThinking}
                  >
                    <ArrowLeftIcon aria-hidden="true" className="size-3.5" />
                  </Button>
                  <Popover.Title className="text-xs text-muted-foreground">
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
                  className="min-h-0 [scrollbar-width:thin] [scrollbar-gutter:stable] overflow-y-auto overscroll-contain p-1"
                >
                  <Toolbar.Button
                    ref={usingDefault ? selectedModelRow : undefined}
                    type="button"
                    aria-pressed={usingDefault}
                    disabled={saving}
                    onClick={() => void commitModel(null)}
                    className={COMPOSER_MODEL_OPTION_CLASS}
                  >
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="truncate text-[13px] leading-5">
                        {t("跟随全局默认", locale)}
                      </span>
                      {defaultModel && (
                        <>
                          <span className="truncate text-xs leading-4 text-muted-foreground">
                            {defaultModel.name}
                          </span>
                          <span className="text-xs leading-4 text-muted-foreground">
                            {t(
                              effectiveModelCapabilities(
                                defaultModel.automatic,
                                defaultModel.overrides,
                              ).supportsImages
                                ? "支持图像输入"
                                : "仅支持文本输入",
                              locale,
                            )}
                          </span>
                        </>
                      )}
                    </span>
                    {usingDefault && (
                      <CheckIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                    )}
                  </Toolbar.Button>
                  {providers.map((entry) => (
                    <div
                      key={entry.id}
                      role="group"
                      aria-label={displayProviderName(entry, locale)}
                    >
                      <div className="truncate px-2.5 pt-2 pb-0.5 text-xs text-muted-foreground">
                        {displayProviderName(entry, locale)}
                      </div>
                      {entry.models.map((model) => {
                        const current =
                          !usingDefault &&
                          entry.id === selection?.providerId &&
                          model.id === selection.modelId;
                        return (
                          <Toolbar.Button
                            key={model.id}
                            ref={current ? selectedModelRow : undefined}
                            type="button"
                            aria-pressed={current}
                            disabled={saving}
                            onClick={() =>
                              void commitModel({ providerId: entry.id, modelId: model.id })
                            }
                            className={COMPOSER_MODEL_OPTION_CLASS}
                          >
                            <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                              <span title={model.name} className="truncate text-[13px] leading-5">
                                {model.name}
                              </span>
                              {model.name !== model.id && (
                                <span
                                  title={model.id}
                                  className="truncate text-xs leading-4 text-muted-foreground"
                                >
                                  {model.id}
                                </span>
                              )}
                              <span className="text-xs leading-4 text-muted-foreground">
                                {t(
                                  effectiveModelCapabilities(model.automatic, model.overrides)
                                    .supportsImages
                                    ? "支持图像输入"
                                    : "仅支持文本输入",
                                  locale,
                                )}
                              </span>
                            </span>
                            {current && (
                              <CheckIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                            )}
                          </Toolbar.Button>
                        );
                      })}
                    </div>
                  ))}
                  {providers.length === 0 && (
                    <p className="px-2.5 py-2 text-xs text-muted-foreground">
                      {t("暂无已保存的模型", locale)}
                    </p>
                  )}
                </Toolbar.Root>
              </>
            ) : (
              <div className="min-h-0 overflow-y-auto p-3">
                <div className="flex items-center justify-between gap-2">
                  <Popover.Title className="text-xs text-muted-foreground">
                    {summaryTitle}
                  </Popover.Title>
                  {supportsThinking && (
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
                  )}
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
                  className="-mx-1 flex max-w-[calc(100%+0.5rem)] flex-col items-start gap-0.5 rounded-lg px-1.5 py-1 text-left outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/55 focus-visible:ring-inset"
                >
                  {supportsThinking && (
                    <span className="text-base leading-5 font-medium">{effort}</span>
                  )}
                  <span className="flex max-w-full items-center gap-1 text-xs leading-4 text-muted-foreground">
                    <span className="truncate">{modelName}</span>
                    <ChevronRightIcon aria-hidden="true" className="size-3 shrink-0" />
                  </span>
                </button>
                {capabilities && (
                  <p className="mt-1 text-xs text-muted-foreground">
                    {t(capabilities.supportsImages ? "支持图像输入" : "仅支持文本输入", locale)}
                  </p>
                )}
                {supportsThinking && levels.length > 1 && (
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
                      <Slider.Track className="relative h-5 w-full rounded-full border border-border/80 bg-muted">
                        <Slider.Indicator className="rounded-full bg-primary/85" />
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
                          className="size-4 rounded-full border border-primary/40 bg-popover shadow-sm ring-ring/65 focus-within:ring-2 focus-within:ring-offset-2 focus-within:ring-offset-popover"
                        />
                      </Slider.Track>
                    </Slider.Control>
                  </Slider.Root>
                )}
                {supportsThinking && levels.length > 1 && (
                  <div
                    className="flex justify-between px-0.5 text-xs text-muted-foreground"
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
