// @env browser
import { FolderOpenIcon } from "lucide-react";
import type { JSX } from "react";

import { Button } from "@renderer/components/ui/button";
import { t, useLocale } from "@renderer/lib/i18n";
import type { AppInfo } from "@shared/contract";

import { DiagnosticSettings } from "./DiagnosticSettings";
import { SettingsGroup } from "./SettingsGroup";

export function DataSettings({ appInfo }: { appInfo: AppInfo | null }): JSX.Element {
  const locale = useLocale();

  return (
    <div className="grid gap-9">
      <SettingsGroup
        id="settings-storage"
        title={t("存储", locale)}
        description={t("设置、聊天记录和密钥都保存在这台电脑上。", locale)}
      >
        <div className="settings-list">
          <div className="settings-row">
            <div className="min-w-0 flex-1 basis-56">
              <p className="text-sm font-medium">{t("应用数据目录", locale)}</p>
              <p className="mt-0.5 text-xs leading-5 wrap-anywhere text-muted-foreground select-text">
                {appInfo?.settingsDir}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={appInfo === null}
              onClick={() => void window.pi.openPath("settings")}
              aria-label={t("打开应用数据目录", locale)}
            >
              <FolderOpenIcon data-icon="inline-start" /> {t("打开文件夹", locale)}
            </Button>
          </div>
          <div className="settings-row">
            <div className="min-w-0 flex-1 basis-56">
              <p className="text-sm font-medium">{t("聊天记录目录", locale)}</p>
              <p className="mt-0.5 text-xs leading-5 wrap-anywhere text-muted-foreground select-text">
                {appInfo?.sessionsDir}
              </p>
            </div>
            <Button
              variant="outline"
              size="sm"
              disabled={appInfo === null}
              onClick={() => void window.pi.openPath("sessions")}
              aria-label={t("打开聊天记录目录", locale)}
            >
              <FolderOpenIcon data-icon="inline-start" /> {t("打开文件夹", locale)}
            </Button>
          </div>
        </div>
      </SettingsGroup>
      <DiagnosticSettings />
    </div>
  );
}
