// @env browser
import { Popover } from "@base-ui/react/popover";
import { Progress } from "@base-ui/react/progress";
import { cn } from "cn";
import { GaugeIcon } from "lucide-react";
import type { JSX } from "react";

import { Button } from "@renderer/components/ui/button";
import { t, useLocale } from "@renderer/lib/i18n";
import { selectActiveSession, useAgentStore } from "@renderer/stores/agent";
import { LOCALE_DETAILS } from "@shared/constants";
import { effectiveModelCapabilities } from "@shared/model-capabilities";
import { selectedCatalogModel } from "@shared/providers";

export function ContextUsage(): JSX.Element | null {
  const locale = useLocale();
  const tokens = useAgentStore((state) => state.contextTokens);
  const capacity = useAgentStore((state) => {
    if (state.activeRun && state.activeRun.sessionId === state.sessionId)
      return state.activeRun.modelCapabilities?.contextWindow ?? state.contextWindow;
    const model =
      state.settings && selectedCatalogModel(state.settings, selectActiveSession(state)?.model);
    return model
      ? effectiveModelCapabilities(model.automatic, model.overrides).contextWindow
      : null;
  });
  if (capacity === null || capacity <= 0) return null;

  const language = LOCALE_DETAILS[locale].htmlLang;
  const ratio = Math.min(1, tokens / capacity);
  const percentage = new Intl.NumberFormat(language, {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(ratio);
  const number = new Intl.NumberFormat(language);
  const label = t("上下文占用 {0}", locale, [percentage]);
  const details = t("已用 {0} / {1} tokens", locale, [
    number.format(tokens),
    number.format(capacity),
  ]);
  const high = ratio > 0.8;

  return (
    <Popover.Root>
      <Popover.Trigger
        render={<Button variant="ghost" size="xs" />}
        openOnHover
        delay={300}
        closeDelay={150}
        aria-label={label}
        data-context-usage
        className={cn(
          "gap-1 px-1.5 text-muted-foreground tabular-nums",
          high &&
            "text-amber-700 hover:text-amber-700 dark:text-amber-400 dark:hover:text-amber-400",
        )}
      >
        <GaugeIcon aria-hidden="true" />
        {percentage}
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="top" align="end" sideOffset={8} className="z-50">
          <Popover.Popup className="grid w-56 max-w-(--available-width) gap-2 rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-md">
            <Popover.Title className="text-sm font-medium">{t("上下文", locale)}</Popover.Title>
            <Progress.Root
              value={Math.min(tokens, capacity)}
              max={capacity}
              aria-valuetext={details}
              className="grid gap-2"
            >
              <Progress.Label className="text-xs text-muted-foreground">
                {t("最近一次请求", locale)}
              </Progress.Label>
              <Progress.Track className="h-1.5 overflow-hidden rounded-full bg-muted">
                <Progress.Indicator
                  className={cn("h-full rounded-full bg-primary", high && "bg-amber-500")}
                />
              </Progress.Track>
            </Progress.Root>
            <p className="text-xs tabular-nums">{details}</p>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
