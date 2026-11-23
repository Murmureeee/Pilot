// @env browser
import type { JSX } from "react";
import { ExternalLinkIcon } from "lucide-react";
import { UpdatePanel } from "@renderer/components/ai/update-panel";
import { APP_LINKS } from "@renderer/lib/constants";
import { t, useLocale } from "@renderer/lib/i18n";
import { APP_NAME } from "@shared/constants";
import type { AppInfo } from "@shared/contract";
import { SettingsGroup, SettingsItem } from "./SettingsGroup";

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
            <span className="text-muted-foreground text-sm select-text">
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
              className="settings-row focus-visible:ring-ring flex-nowrap text-sm font-medium outline-none hover:underline focus-visible:ring-2"
            >
              <span className="min-w-0 flex-1">{t(link.label, locale)}</span>
              <ExternalLinkIcon aria-hidden="true" className="text-muted-foreground size-4" />
            </a>
          ))}
        </div>
      </SettingsGroup>
    </div>
  );
}
