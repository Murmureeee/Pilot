// @env browser
import { AlertTriangleIcon } from "lucide-react";
import { useState, type JSX } from "react";

import { Alert, AlertDescription, AlertTitle } from "@renderer/components/ui/alert";
import { Button } from "@renderer/components/ui/button";
import { APP_LINKS } from "@renderer/lib/constants";
import { localizeError, t, useLocale } from "@renderer/lib/i18n";
import { useAgentStore } from "@renderer/stores/agent";
import type { SettingsRecovery, StorageUpgrade } from "@shared/contract";

export function StorageUpgradeNotice({ issue }: { issue: StorageUpgrade }): JSX.Element {
  const locale = useLocale();
  const release = APP_LINKS[1];
  return (
    <Alert variant="destructive" className="bg-background">
      <AlertTriangleIcon aria-hidden="true" />
      <AlertTitle>{t("需要新版 Pilot", locale)}</AlertTitle>
      <AlertDescription className="col-start-2 grid gap-1">
        <p>
          {t("此数据文件使用格式版本 {0}。原文件已保留，请升级 Pilot 后继续。", locale, [
            issue.version,
          ])}
        </p>
        <p className="wrap-anywhere select-text">{issue.path}</p>
        <Button
          size="sm"
          variant="outline"
          nativeButton={false}
          className="mt-1 justify-self-start"
          render={<a href={release.href} target="_blank" rel="noreferrer" />}
        >
          {t(release.label, locale)}
        </Button>
      </AlertDescription>
    </Alert>
  );
}

async function openSettingsFolder(): Promise<void> {
  const error = await window.pi.openPath("settings");
  if (error) throw new Error("无法打开设置目录。");
}

export function SettingsRecoveryNotice({ recovery }: { recovery: SettingsRecovery }): JSX.Element {
  const locale = useLocale();
  const dismiss = useAgentStore((s) => s.dismissSettingsRecovery);
  const retry = useAgentStore((s) => s.retrySettingsRecovery);
  const blocked = recovery.status === "blocked";
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();

  async function runAction(action: () => Promise<void>): Promise<void> {
    setPending(true);
    setError(undefined);
    try {
      await action();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setPending(false);
    }
  }

  if (recovery.status === "upgrade") return <StorageUpgradeNotice issue={recovery} />;

  return (
    <Alert variant={blocked ? "destructive" : "warning"} aria-busy={pending}>
      <AlertTriangleIcon aria-hidden="true" />
      <AlertTitle>
        {t(blocked ? "暂时无法恢复设置文件" : "设置文件损坏，已恢复默认设置", locale)}
      </AlertTitle>
      <AlertDescription className="col-start-2 grid gap-1">
        <p>
          {t(
            blocked
              ? "当前使用默认设置。请恢复原文件的访问权限后重试。"
              : "请重新配置模型提供方、密钥和授权规则。",
            locale,
          )}
        </p>
        <p className="wrap-anywhere select-text">
          {t(blocked ? "原设置文件 {0}" : "原文件已另存为 {0}", locale, [recovery.path])}
        </p>
        {error && (
          <p role="alert" className="wrap-anywhere text-destructive">
            {localizeError(error, locale)}
          </p>
        )}
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          <Button
            size="sm"
            variant="ghost"
            disabled={pending}
            onClick={() => void runAction(openSettingsFolder)}
          >
            {t("打开文件夹", locale)}
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => void runAction(blocked ? retry : dismiss)}
          >
            {t(blocked ? "重试恢复" : "知道了", locale)}
          </Button>
        </div>
      </AlertDescription>
    </Alert>
  );
}
