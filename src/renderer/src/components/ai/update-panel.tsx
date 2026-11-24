// @env browser
import { DownloadIcon, LoaderCircleIcon } from "lucide-react";
import type { JSX } from "react";

import { Button } from "@renderer/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@renderer/components/ui/tooltip";
import { t } from "@renderer/lib/i18n";
import { useUpdateStore } from "@renderer/stores/update";
import type { Locale, UpdateStatus } from "@shared/contract";

function describeStatus(status: UpdateStatus, locale: Locale): string {
  switch (status.state) {
    case "unavailable":
      return t("当前安装包未配置更新源。", locale);
    case "idle":
      return t("可检查应用更新。", locale);
    case "checking":
      return t("正在检查更新…", locale);
    case "current":
      return t("已是最新版本。", locale);
    case "error":
      return t("更新失败，请重试。", locale);
    case "downloading":
      return t("正在下载 {0}（{1}%）", locale, [status.version, status.percent]);
    case "ready":
      return t("版本 {0} 已下载。", locale, [status.version]);
    case "installing":
      return t("正在退出并安装 {0}…", locale, [status.version]);
  }
}

export function UpdatePanel({ locale }: { locale: Locale }): JSX.Element {
  const status = useUpdateStore((s) => s.status);
  const actionFailed = useUpdateStore((s) => s.actionFailed);
  const state = status?.state;
  const canCheck =
    state === "idle" || state === "current" || state === "error" || (!status && actionFailed);
  const description = status
    ? describeStatus(status, locale)
    : t(actionFailed ? "更新失败，请重试。" : "正在读取更新状态…", locale);

  return (
    <div className="flex flex-col items-start gap-2">
      <p role="status" className="text-xs text-muted-foreground">
        {description}
      </p>
      {actionFailed && status && state !== "error" && (
        <p role="alert" className="text-xs text-destructive">
          {t("更新失败，请重试。", locale)}
        </p>
      )}
      {canCheck && (
        <Button size="sm" variant="outline" onClick={() => void useUpdateStore.getState().check()}>
          {t("检查更新", locale)}
        </Button>
      )}
      {state === "ready" && (
        <Button size="sm" onClick={() => void useUpdateStore.getState().install()}>
          {t("更新并重启", locale)}
        </Button>
      )}
    </div>
  );
}

export function UpdateRailButton({ locale }: { locale: Locale }): JSX.Element | null {
  const status = useUpdateStore((s) => s.status);
  if (
    status?.state !== "downloading" &&
    status?.state !== "ready" &&
    status?.state !== "installing"
  )
    return null;

  const canInstall = status.state === "ready";
  const label = canInstall ? t("更新并重启", locale) : describeStatus(status, locale);
  const handleClick = (): void => {
    const update = useUpdateStore.getState();
    if (canInstall) void update.install();
    else update.setDialog("update");
  };

  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <Button
            variant={canInstall ? "default" : "secondary"}
            size="icon-lg"
            className="flex-col gap-0.5 rounded-xl"
            aria-label={label}
            onClick={handleClick}
          />
        }
      >
        {status.state === "installing" ? (
          <LoaderCircleIcon aria-hidden="true" className="motion-safe:animate-spin" />
        ) : (
          <DownloadIcon aria-hidden="true" strokeWidth={1.7} />
        )}
        {status.state === "downloading" && (
          <span aria-hidden="true" className="text-[10px] leading-none tabular-nums">
            {status.percent}%
          </span>
        )}
      </TooltipTrigger>
      <TooltipContent side="right" sideOffset={8}>
        {label}
      </TooltipContent>
    </Tooltip>
  );
}
