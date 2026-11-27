// @env browser
import { useCallback, useEffect, useState, type JSX } from "react";

import { Button } from "@renderer/components/ui/button";
import { Switch } from "@renderer/components/ui/switch";
import { localizeError, t, useLocale } from "@renderer/lib/i18n";
import {
  GLOBAL_COMPOSER_SHORTCUT_LABEL,
  type DesktopBackgroundSetting,
  type DesktopBackgroundState,
} from "@shared/desktop-background";

import { SettingsGroup, SettingsItem } from "./SettingsGroup";

export function DesktopBackgroundSettings(): JSX.Element {
  const locale = useLocale();
  const [prefs, setPrefs] = useState<DesktopBackgroundState>();
  const [saving, setSaving] = useState<DesktopBackgroundSetting>();
  const [error, setError] = useState<{ setting?: DesktopBackgroundSetting; message: string }>();

  const read = useCallback((): void => {
    void window.pi.settingsDesktopBackground().then(setPrefs, () => {
      setError({ message: "无法读取后台运行设置。请重试。" });
    });
  }, []);

  useEffect(read, [read]);

  const save = async (setting: DesktopBackgroundSetting, enabled: boolean): Promise<void> => {
    if (saving) return;
    setSaving(setting);
    setError(undefined);
    try {
      setPrefs(await window.pi.settingsSetDesktopBackground(setting, enabled));
    } catch (cause) {
      setError({ setting, message: cause instanceof Error ? cause.message : String(cause) });
    } finally {
      setSaving(undefined);
    }
  };
  const items = [
    {
      key: "closeToTray",
      label: "关闭窗口时留在托盘",
      description: t("关闭窗口后继续任务。从托盘打开窗口或退出 Pilot。", locale),
      inactive:
        prefs?.closeToTray && !prefs.trayActive
          ? "无法创建系统托盘图标。请检查桌面环境是否支持托盘，再重新开启。"
          : undefined,
    },
    {
      key: "globalComposerShortcut",
      label: "全局快捷键",
      description: t("从其他应用按 {0} 打开 Pilot 并聚焦输入区。", locale, [
        GLOBAL_COMPOSER_SHORTCUT_LABEL,
      ]),
      inactive:
        prefs?.globalComposerShortcut && !prefs.shortcutActive
          ? "无法注册全局快捷键。请检查系统快捷键或其他应用的占用，再重新开启。"
          : undefined,
    },
  ] as const;

  return (
    <SettingsGroup id="settings-desktop-background" title={t("后台运行", locale)}>
      <div className="settings-list">
        {items.map(({ key, label, description, inactive }) => {
          const message = error?.setting === key ? error.message : inactive;
          return (
            <div key={key}>
              <SettingsItem
                label={t(label, locale)}
                htmlFor={"settings-" + key}
                description={description}
              >
                <Switch
                  id={"settings-" + key}
                  checked={prefs?.[key] ?? false}
                  aria-disabled={!prefs || saving !== undefined}
                  aria-busy={saving === key || undefined}
                  aria-describedby={message ? "settings-" + key + "-error" : undefined}
                  onCheckedChange={(enabled) => {
                    if (prefs && !saving) void save(key, enabled);
                  }}
                />
              </SettingsItem>
              {message && (
                <p
                  id={"settings-" + key + "-error"}
                  role="alert"
                  className="pb-3 text-sm text-destructive"
                >
                  {localizeError(message, locale)}
                </p>
              )}
            </div>
          );
        })}
      </div>
      {error && !error.setting && (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <p role="alert" className="text-destructive">
            {t(error.message, locale)}
          </p>
          <Button
            variant="outline"
            onClick={() => {
              setError(undefined);
              read();
            }}
          >
            {t("重试", locale)}
          </Button>
        </div>
      )}
    </SettingsGroup>
  );
}
