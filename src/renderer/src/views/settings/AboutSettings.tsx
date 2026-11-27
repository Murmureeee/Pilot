// @env browser
import { ExternalLinkIcon } from "lucide-react";
import { useState, type JSX } from "react";

import { UpdatePanel } from "@renderer/components/ai/update-panel";
import { Switch } from "@renderer/components/ui/switch";
import { APP_LINKS } from "@renderer/lib/constants";
import { t, useLocale } from "@renderer/lib/i18n";
import { useAgentStore } from "@renderer/stores/agent";
import { useUpdateStore } from "@renderer/stores/update";
import { APP_NAME } from "@shared/constants";
import type { AppInfo } from "@shared/contract";

import { SettingsGroup, SettingsItem } from "./SettingsGroup";

function AutoDownloadSetting(): JSX.Element | null {
  const locale = useLocale();
  const supported = useUpdateStore((s) => s.status !== null && s.status.state !== "unavailable");
  const enabled = useAgentStore((s) => s.settings?.autoDownloadUpdates);
  const [saving, setSaving] = useState(false);
  const [saveFailed, setSaveFailed] = useState(false);
  if (!supported || enabled === undefined) return null;

  const save = async (checked: boolean): Promise<void> => {
    if (saving) return;
    setSaving(true);
    setSaveFailed(false);
    try {
      await useAgentStore.getState().setAutoDownloadUpdates(checked);
    } catch {
      setSaveFailed(true);
    } finally {
      setSaving(false);
    }
  };

  const label = t("自动下载更新", locale);
  const description = t("关闭后仍会检查更新，发现新版本时可手动下载。", locale);
  return (
    <>
      <SettingsItem
        label={label}
        htmlFor="settings-auto-download-updates"
        description={description}
      >
        <Switch
          id="settings-auto-download-updates"
          aria-label={label}
          aria-description={description}
          aria-busy={saving || undefined}
          checked={enabled}
          onCheckedChange={(checked) => void save(checked)}
        />
      </SettingsItem>
      {saveFailed && (
        <p role="alert" className="text-xs text-destructive">
          {t("无法保存自动下载设置，请重试。", locale)}
        </p>
      )}
    </>
  );
}

export function AboutSettings({ appInfo }: { appInfo: AppInfo | null }): JSX.Element {
  const locale = useLocale();

  return (
    <div className="grid gap-9">
      <SettingsGroup id="settings-version" title={APP_NAME}>
        <div className="settings-list">
          <SettingsItem
            label={t("版本", locale)}
            description={appInfo?.isDev ? t("开发模式", locale) : undefined}
          >
            <span className="text-sm text-muted-foreground select-text">
              {appInfo?.version ?? "…"}
            </span>
          </SettingsItem>
          <div className="settings-row">
            <div className="min-w-0 flex-1">
              <p className="text-sm font-medium">{t("软件更新", locale)}</p>
              <div className="mt-1.5">
                <UpdatePanel locale={locale} />
              </div>
            </div>
          </div>
          <AutoDownloadSetting />
        </div>
      </SettingsGroup>

      <SettingsGroup id="settings-links" title={t("了解更多", locale)}>
        <div className="settings-list">
          {APP_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              target="_blank"
              rel="noreferrer"
              className="settings-row flex-nowrap text-sm font-medium outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
            >
              <span className="min-w-0 flex-1">{t(link.label, locale)}</span>
              <ExternalLinkIcon aria-hidden="true" className="size-4 text-muted-foreground" />
            </a>
          ))}
        </div>
      </SettingsGroup>
    </div>
  );
}
