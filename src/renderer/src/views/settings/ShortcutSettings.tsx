// @env browser
import type { JSX } from "react";

import { SHORTCUT_GROUPS } from "@renderer/lib/constants";
import { t, useLocale } from "@renderer/lib/i18n";
import { loadSendKey } from "@renderer/lib/preferences";
import type { ShortcutGroup } from "@renderer/lib/types";
import { GLOBAL_COMPOSER_SHORTCUT_LABEL } from "@shared/desktop-background";

import { SettingsGroup } from "./SettingsGroup";

export function ShortcutSettings(): JSX.Element {
  const locale = useLocale();
  const modEnter = loadSendKey() === "mod-enter";
  const sendItems: ShortcutGroup["items"] = [
    { label: "发送消息", keys: modEnter ? "Ctrl+Enter" : "Enter" },
    { label: "换行", keys: modEnter ? "Enter" : "Shift+Enter" },
    { label: "全局唤起 Pilot（需启用）", keys: GLOBAL_COMPOSER_SHORTCUT_LABEL },
  ];

  return (
    <div className="grid gap-9">
      {SHORTCUT_GROUPS.map((group, index) => (
        <SettingsGroup
          key={group.label}
          id={`settings-shortcuts-${index}`}
          title={t(group.label, locale)}
        >
          <dl className="settings-list">
            {(group.label === "输入框" ? [...sendItems, ...group.items] : group.items).map(
              (item) => (
                <div key={item.label} className="settings-row flex-nowrap py-3">
                  <dt className="min-w-0 flex-1 text-sm">{t(item.label, locale)}</dt>
                  <dd>
                    <kbd className="rounded-md border bg-muted px-1.5 py-0.5 font-sans text-xs whitespace-nowrap text-muted-foreground">
                      {item.keys}
                    </kbd>
                  </dd>
                </div>
              ),
            )}
          </dl>
        </SettingsGroup>
      ))}
    </div>
  );
}
