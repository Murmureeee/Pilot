// @env browser
import { useEffect, useRef, useState, type JSX } from "react";

import { ExternalImportSettings } from "@renderer/components/ai/external-import-settings";
import { McpSettings } from "@renderer/components/ai/mcp-settings";
import { SettingsRecoveryNotice } from "@renderer/components/ai/settings-recovery-notice";
import { SETTINGS_SECTION_DESCRIPTIONS, SETTINGS_SECTION_LABELS } from "@renderer/lib/constants";
import { t, useLocale } from "@renderer/lib/i18n";
import { useAgentStore } from "@renderer/stores/agent";
import type { AppInfo } from "@shared/contract";

import { AboutSettings } from "./settings/AboutSettings";
import { AppearanceSettings } from "./settings/AppearanceSettings";
import { ArchivedSettings } from "./settings/ArchivedSettings";
import { DataSettings } from "./settings/DataSettings";
import { GeneralSettings } from "./settings/GeneralSettings";
import { PermissionSettings } from "./settings/PermissionSettings";
import { PersonalizationSettings } from "./settings/PersonalizationSettings";
import { ProviderSettings } from "./settings/ProviderSettings";
import { ShortcutSettings } from "./settings/ShortcutSettings";
import { SkillSettings } from "./settings/SkillSettings";

export function SettingsView(): JSX.Element {
  const settings = useAgentStore((s) => s.settings);
  const locale = useLocale();
  const section = useAgentStore((s) => s.settingsSection);
  const composerId = useAgentStore((s) => s.composerId);
  const scroller = useRef<HTMLDivElement>(null);
  const previousSection = useRef(section);
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);
  const workingDirectory = settings?.workingDirectory ?? null;

  useEffect(() => {
    void window.pi.getAppInfo().then(setAppInfo);
  }, []);

  useEffect(() => {
    if (previousSection.current !== section) scroller.current?.scrollTo(0, 0);
    previousSection.current = section;
  }, [section]);

  return (
    <div
      ref={scroller}
      className="settings-scroll min-h-0 flex-1 [scrollbar-gutter:stable_both-edges] overflow-y-auto"
    >
      <div className="workspace-column grid gap-8 pt-8 pb-12 sm:pt-10">
        <header className="grid gap-1.5">
          <h1
            data-settings-heading
            tabIndex={-1}
            className="text-xl leading-tight font-semibold tracking-tight"
          >
            {t(SETTINGS_SECTION_LABELS[section], locale)}
          </h1>
          <p className="text-sm leading-6 text-muted-foreground">
            {t(SETTINGS_SECTION_DESCRIPTIONS[section], locale)}
          </p>
        </header>

        {settings?.recovery && <SettingsRecoveryNotice recovery={settings.recovery} />}

        {/* Keep in-progress edits when the settings page changes. */}
        <div hidden={section !== "general"} className="min-w-0">
          {settings && (
            <GeneralSettings settings={settings} isWindows={appInfo?.isWindows ?? false} />
          )}
        </div>

        {section === "appearance" && <AppearanceSettings />}

        {section === "permissions" && settings && <PermissionSettings settings={settings} />}

        <div hidden={section !== "providers"} className="min-w-0">
          {settings && <ProviderSettings settings={settings} />}
        </div>

        <div hidden={section !== "persona"}>
          {settings && (
            <PersonalizationSettings
              savedInstructions={settings.persona}
              templates={settings.promptTemplates}
            />
          )}
        </div>

        {section === "shortcuts" && <ShortcutSettings />}

        {section === "archived" && <ArchivedSettings />}

        {section === "data" && <DataSettings appInfo={appInfo} />}

        {section === "about" && <AboutSettings appInfo={appInfo} />}

        {section === "skills" && composerId && (
          <SkillSettings
            key={composerId}
            composerId={composerId}
            workingDirectory={workingDirectory}
          />
        )}

        {section === "mcp" && (
          <McpSettings
            composerId={composerId}
            locale={locale}
            workingDirectory={workingDirectory}
          />
        )}

        {section === "imports" && (
          <div className="min-w-0">
            <ExternalImportSettings locale={locale} workingDirectory={workingDirectory} />
          </div>
        )}
      </div>
    </div>
  );
}
