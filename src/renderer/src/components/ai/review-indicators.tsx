// @env browser
import { cn } from "cn";
import { CheckIcon, LoaderCircleIcon } from "lucide-react";
import type { JSX } from "react";

import { Badge } from "@renderer/components/ui/badge";
import { VERIFICATION_STATUS_LABELS } from "@renderer/lib/constants";
import { t, useLocale } from "@renderer/lib/i18n";
import type { VerificationStatus } from "@shared/contract";

export function ChangeCount({ count }: { count: number }): JSX.Element {
  const locale = useLocale();
  return (
    <>
      <Badge variant="secondary" aria-hidden="true" className="h-4 px-1.5 tabular-nums">
        {count}
      </Badge>
      <span className="sr-only">{t("{0} 个变更文件", locale, [count])}</span>
    </>
  );
}

export function VerificationMark({ status }: { status: VerificationStatus }): JSX.Element {
  const locale = useLocale();
  const running = status === "running" || status === "stopping";
  const label = t("验证{0}", locale, [t(VERIFICATION_STATUS_LABELS[status], locale)]);
  return (
    <span
      className="grid size-3 shrink-0 place-items-center"
      title={label}
      data-review-verification={status}
    >
      {running ? (
        <LoaderCircleIcon
          aria-hidden="true"
          className={cn(
            "size-3 motion-safe:animate-spin",
            status === "running"
              ? "text-emerald-700 dark:text-emerald-400"
              : "text-muted-foreground",
          )}
        />
      ) : status === "success" ? (
        <CheckIcon aria-hidden="true" className="size-3 text-emerald-700 dark:text-emerald-400" />
      ) : (
        <span
          aria-hidden="true"
          className={cn(
            "size-2 rounded-full",
            status === "failed" ? "bg-destructive" : "border border-muted-foreground",
          )}
        />
      )}
      <span className="sr-only">{label}</span>
    </span>
  );
}
