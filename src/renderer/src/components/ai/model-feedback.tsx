// @env browser
import { ChevronDownIcon, CircleAlertIcon, RotateCcwIcon } from "lucide-react";
import { useEffect, useState, type JSX } from "react";

import { Alert, AlertTitle } from "@renderer/components/ui/alert";
import { Button } from "@renderer/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@renderer/components/ui/collapsible";
import { formatDuration } from "@renderer/lib/duration";
import { localizeError, t, useLocale } from "@renderer/lib/i18n";
import type { Locale, ModelFailure, ModelRetryProgress } from "@shared/contract";

export function ModelRetryLabel({
  retry,
  locale,
}: {
  retry: ModelRetryProgress;
  locale: Locale;
}): string {
  const { attempt, maxAttempts, retryAt } = retry;
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (retryAt === null) return;
    const timer = window.setInterval(() => setNow(Date.now()), 250);
    return () => window.clearInterval(timer);
  }, [retryAt]);
  if (retryAt === null) return t("正在重试模型请求（{0}/{1}）", locale, [attempt, maxAttempts]);
  const remaining = Math.max(1000, Math.ceil((retryAt - now) / 1000) * 1000);
  return t("{2}后重试模型请求（{0}/{1}）", locale, [
    attempt,
    maxAttempts,
    formatDuration(remaining, locale),
  ]);
}

const reasons: Record<ModelFailure["kind"], string> = {
  network: "模型连接中断",
  "rate-limit": "模型请求受限流",
  server: "模型服务暂时不可用",
  credentials: "模型凭据未通过验证",
  quota: "模型服务额度不足",
  capability: "模型不可用或不支持此请求",
  other: "模型请求失败",
};

export function ModelFailureCard({
  failure,
  disabled,
  onRetry,
  onOpenSettings,
}: {
  failure: ModelFailure;
  disabled: boolean;
  onRetry: () => void;
  onOpenSettings: () => void;
}): JSX.Element {
  const locale = useLocale();
  const settings =
    failure.kind === "credentials" || failure.kind === "quota" || failure.kind === "capability";
  return (
    <Alert variant="destructive" data-model-failure={failure.kind}>
      <CircleAlertIcon aria-hidden="true" />
      <AlertTitle>{t(reasons[failure.kind], locale)}</AlertTitle>
      <Collapsible className="col-start-2 flex min-w-0 flex-col gap-1.5">
        <div className="flex flex-wrap items-center gap-1">
          {settings && (
            <Button size="xs" variant="outline" onClick={onOpenSettings}>
              {t("打开模型设置", locale)}
            </Button>
          )}
          <Button
            size="xs"
            variant={settings ? "ghost" : "outline"}
            disabled={disabled}
            onClick={onRetry}
          >
            <RotateCcwIcon data-icon="inline-start" />
            {t("重试", locale)}
          </Button>
          <CollapsibleTrigger
            render={<Button size="xs" variant="ghost" className="group/details" />}
          >
            <ChevronDownIcon
              data-icon="inline-start"
              className="group-data-[panel-open]/details:rotate-180"
            />
            {t("错误详情", locale)}
          </CollapsibleTrigger>
        </div>
        <CollapsibleContent className="min-w-0">
          <pre
            tabIndex={0}
            aria-label={t("错误详情", locale)}
            className="max-h-28 overflow-auto overscroll-contain rounded-md bg-muted/60 p-2 text-xs leading-5 wrap-anywhere whitespace-pre-wrap text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {localizeError(failure.detail, locale)}
          </pre>
        </CollapsibleContent>
      </Collapsible>
    </Alert>
  );
}
