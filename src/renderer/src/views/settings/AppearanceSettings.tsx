// @env browser
import { useState, type JSX } from "react";
import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@renderer/components/ui/select";
import { THEME_LABELS } from "@renderer/lib/constants";
import { setLocale, t, useLocale } from "@renderer/lib/i18n";
import { applyTheme, loadTheme } from "@renderer/lib/theme";
import { LOCALE_DETAILS, SUPPORTED_LOCALES } from "@shared/constants";
import type { Locale, ThemeSetting } from "@shared/contract";
import { cn } from "cn";
import { SettingsItem } from "./SettingsGroup";

const THEME_ICONS: Record<ThemeSetting, typeof SunIcon> = {
  light: SunIcon,
  dark: MoonIcon,
  system: MonitorIcon,
};

export function AppearanceSettings(): JSX.Element {
  const locale = useLocale();
  const [theme, setTheme] = useState<ThemeSetting>(loadTheme);

  return (
    <div className="settings-list">
      <SettingsItem
        label={t("主题", locale)}
        description={t("跟随系统时，随系统的浅色和深色设置切换。", locale)}
      >
        <fieldset
          aria-label={t("主题", locale)}
          className="bg-muted flex min-w-0 gap-0.5 rounded-lg p-0.5"
        >
          {(Object.keys(THEME_LABELS) as ThemeSetting[]).map((value) => {
            const Icon = THEME_ICONS[value];
            return (
              <button
                key={value}
                type="button"
                aria-pressed={theme === value}
                onClick={() => {
                  setTheme(value);
                  applyTheme(value);
                }}
                className={cn(
                  "text-muted-foreground hover:text-foreground focus-visible:ring-ring flex h-7 items-center gap-1.5 rounded-md px-2.5 text-xs outline-none focus-visible:ring-2",
                  theme === value && "bg-background text-foreground shadow-xs",
                )}
              >
                <Icon aria-hidden="true" className="size-3.5" />
                {t(THEME_LABELS[value], locale)}
              </button>
            );
          })}
        </fieldset>
      </SettingsItem>
      <SettingsItem
        label={t("语言", locale)}
        htmlFor="settings-language"
        description={t("应用界面使用的语言。", locale)}
      >
        <Select
          value={locale}
          onValueChange={(value: Locale | null) => {
            if (value) setLocale(value);
          }}
        >
          <SelectTrigger id="settings-language">
            <SelectValue>{LOCALE_DETAILS[locale].label}</SelectValue>
          </SelectTrigger>
          <SelectContent align="end" alignItemWithTrigger={false}>
            <SelectGroup>
              {SUPPORTED_LOCALES.map((value) => (
                <SelectItem key={value} value={value} lang={LOCALE_DETAILS[value].htmlLang}>
                  {LOCALE_DETAILS[value].label}
                </SelectItem>
              ))}
            </SelectGroup>
          </SelectContent>
        </Select>
      </SettingsItem>
    </div>
  );
}
