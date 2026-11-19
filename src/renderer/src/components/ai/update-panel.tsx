// @env browser
import { useEffect, useState, type JSX } from "react";
import { Button } from "@renderer/components/ui/button";
import { t } from "@renderer/lib/i18n";
import { useAgentStore } from "@renderer/stores/agent";
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

export function UpdatePanel({ locale }: { locale: Locale }): JSX.Element | null {
  const [status, setStatus] = useState<UpdateStatus | null>(null);
  const agentBusy = useAgentStore((s) => s.status !== "idle");

  useEffect(() => {
    let pending = true;
    const unsubscribe = window.pi.onUpdateStatus((next) => {
      pending = false;
      setStatus(next);
    });
    void window.pi.getUpdateStatus().then((initial) => {
      if (pending) setStatus(initial);
    });
    return () => {
      pending = false;
      unsubscribe();
    };
  }, []);

  if (!status) return null;
  const canCheck =
    status.state === "idle" || status.state === "current" || status.state === "error";

  return (
    <div className="flex flex-col items-start gap-2 border-t pt-3">
      <p role="status" className="text-muted-foreground text-xs">
        {describeStatus(status, locale)}
      </p>
      {canCheck && (
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            void window.pi.checkForUpdates().catch(() => setStatus({ state: "error" }))
          }
        >
          {t("检查更新", locale)}
        </Button>
      )}
      {status.state === "ready" && (
        <Button
          size="sm"
          disabled={agentBusy}
          title={agentBusy ? t("请等待当前任务结束后再安装更新。", locale) : undefined}
          onClick={() => void window.pi.installUpdate().catch(() => setStatus({ state: "error" }))}
        >
          {t("退出并安装更新", locale)}
        </Button>
      )}
    </div>
  );
}
