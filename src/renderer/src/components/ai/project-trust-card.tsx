// @env browser
import { cn } from "cn";
import { ShieldAlertIcon } from "lucide-react";
import { useEffect, useId, useRef, useState, type JSX } from "react";

import { Button } from "@renderer/components/ui/button";
import { COMPOSER_SURFACE_CLASS, PERMISSION_ATTENTION_TEXT } from "@renderer/lib/constants";
import { localizeError, t, useLocale } from "@renderer/lib/i18n";
import { useAgentStore } from "@renderer/stores/agent";
import type { RunRef } from "@shared/contract";
import type { ProjectTrustDecision, ProjectTrustRequest } from "@shared/project-config";

import { ProjectConfigEntries } from "./project-config-details";

export function ProjectTrustCard({
  request,
  run,
}: {
  request: ProjectTrustRequest;
  run: RunRef;
}): JSX.Element {
  const locale = useLocale();
  const respondProjectTrust = useAgentStore((s) => s.respondProjectTrust);
  const abort = useAgentStore((s) => s.abort);
  const card = useRef<HTMLElement>(null);
  const titleId = useId();
  const [responding, setResponding] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const active = document.activeElement;
    if (!active || active === document.body || active.getClientRects().length === 0)
      card.current?.focus({ preventScroll: true });
  }, []);

  const respond = async (decision: ProjectTrustDecision): Promise<void> => {
    if (responding) return;
    setResponding(true);
    setError(null);
    try {
      await respondProjectTrust(run, request.requestId, decision);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setResponding(false);
    }
  };

  return (
    <section
      ref={card}
      tabIndex={-1}
      aria-labelledby={titleId}
      data-project-trust-card
      className={cn(
        COMPOSER_SURFACE_CLASS,
        "flex max-h-[calc(100dvh-6.5rem)] min-w-0 flex-col gap-3 overflow-hidden border px-4 py-3.5 outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
      )}
    >
      <div
        role="region"
        aria-labelledby={titleId}
        tabIndex={0}
        className="flex min-h-0 min-w-0 flex-col gap-3 overflow-y-auto overscroll-contain rounded-sm focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
      >
        <div className="flex min-w-0 shrink-0 items-start gap-2.5" role="alert">
          <span
            aria-hidden="true"
            className={cn(
              "grid size-8 shrink-0 place-items-center rounded-lg bg-amber-500/10",
              PERMISSION_ATTENTION_TEXT,
            )}
          >
            <ShieldAlertIcon className="size-4" />
          </span>
          <div className="grid min-w-0 flex-1 gap-0.5">
            <h2
              id={titleId}
              className={cn("text-sm font-medium wrap-anywhere", PERMISSION_ATTENTION_TEXT)}
            >
              {t(
                request.trust === "changed"
                  ? "项目配置已更改，请重新确认"
                  : "是否信任此项目的配置？",
                locale,
              )}
            </h2>
            <p className="text-xs wrap-anywhere text-muted-foreground">
              {t("项目目录", locale)} <bdi className="font-mono">{request.directory}</bdi>
            </p>
            <p className="text-xs text-muted-foreground">
              {t("信任后，服务可在任务中启动，授权规则与验证命令会在此项目中生效。", locale)}
            </p>
          </div>
        </div>
        <ProjectConfigEntries config={request} />
        {error && (
          <p role="alert" className="text-xs wrap-anywhere text-destructive">
            {t("操作失败，请重试。", locale)} {localizeError(error, locale)}
          </p>
        )}
      </div>

      <div className="flex shrink-0 flex-wrap items-center justify-end gap-2">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={responding}
          onClick={() => abort(run)}
        >
          {t("停止任务", locale)}
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={responding}
          aria-keyshortcuts="Escape"
          onClick={() => void respond("skip")}
        >
          {t("本次不加载", locale)}
        </Button>
        <Button type="button" size="sm" disabled={responding} onClick={() => void respond("trust")}>
          {t("信任项目配置", locale)}
        </Button>
      </div>
    </section>
  );
}
