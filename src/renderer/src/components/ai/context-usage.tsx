// @env browser
import { Popover } from "@base-ui/react/popover";
import { Progress } from "@base-ui/react/progress";
import { cn } from "cn";
import { GaugeIcon } from "lucide-react";
import type { JSX } from "react";

import { Button } from "@renderer/components/ui/button";
import { t, useLocale } from "@renderer/lib/i18n";
import { selectComposerSettings, selectCurrentRun, useAgentStore } from "@renderer/stores/agent";
import { LOCALE_DETAILS } from "@shared/constants";
import { effectiveModelCapabilities, modelTokenLimit } from "@shared/model-capabilities";
import { selectedCatalogModel } from "@shared/providers";

export function ContextUsage(): JSX.Element {
  const locale = useLocale();
  const tokens = useAgentStore((state) => state.contextTokens);
  const usage = useAgentStore((state) => state.usage);
  const sessionId = useAgentStore((state) => state.sessionId);
  const composerId = useAgentStore((state) => state.composerId);
  const running = useAgentStore((state) => selectCurrentRun(state) !== null);
  const compact = useAgentStore((state) => state.compactContext);
  const modelCapacity = useAgentStore((state) => {
    const run = selectCurrentRun(state);
    if (run) return run.modelCapabilities?.contextWindow ?? state.contextWindow;
    const model =
      state.settings && selectedCatalogModel(state.settings, selectComposerSettings(state).model);
    return model
      ? effectiveModelCapabilities(model.automatic, model.overrides).contextWindow
      : null;
  });
  const capacity = modelTokenLimit(modelCapacity);
  const language = LOCALE_DETAILS[locale].htmlLang;
  const ratio = capacity === undefined ? 0 : Math.min(1, tokens / capacity);
  const percentage =
    capacity === undefined
      ? null
      : new Intl.NumberFormat(language, { style: "percent", maximumFractionDigits: 1 }).format(
          ratio,
        );
  const number = new Intl.NumberFormat(language);
  const label = percentage ? t("上下文占用 {0}", locale, [percentage]) : t("会话用量", locale);
  const details =
    capacity === undefined
      ? t("已用 {0} tokens，上限未知", locale, [number.format(tokens)])
      : t("已用 {0} / {1} tokens", locale, [number.format(tokens), number.format(capacity)]);
  const high = ratio >= 0.8;

  return (
    <Popover.Root>
      <Popover.Trigger
        render={<Button variant="ghost" size="xs" />}
        openOnHover
        delay={300}
        closeDelay={150}
        aria-label={label}
        title={label}
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
          <Popover.Popup className="grid w-64 max-w-(--available-width) gap-2 rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-md">
            <Popover.Title className="text-sm font-medium">{t("上下文", locale)}</Popover.Title>
            {capacity !== undefined && (
              <Progress.Root
                value={Math.min(tokens, capacity)}
                max={capacity}
                aria-valuetext={details}
                className="grid gap-2"
              >
                <Progress.Label className="text-xs text-muted-foreground">
                  {t("当前上下文", locale)}
                </Progress.Label>
                <Progress.Track className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <Progress.Indicator
                    className={cn("h-full rounded-full bg-primary", high && "bg-amber-500")}
                  />
                </Progress.Track>
              </Progress.Root>
            )}
            <p className="text-xs tabular-nums">{details}</p>
            <p className="text-xs text-muted-foreground tabular-nums">
              {t("会话累计 {0} tokens，{1}", locale, [
                number.format(usage.input + usage.output + usage.cacheRead + usage.cacheWrite),
                "$" + usage.costTotal.toFixed(4),
              ])}
            </p>
            <Popover.Close
              render={<Button variant="outline" size="sm" className="justify-self-end" />}
              disabled={capacity === undefined || !sessionId || !composerId || running}
              onClick={() => {
                if (composerId) void compact(composerId);
              }}
            >
              {t("压缩上下文", locale)}
            </Popover.Close>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}
