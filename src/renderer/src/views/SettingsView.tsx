// @env browser
import { useEffect, useRef, useState, type JSX } from "react";
import { FolderOpenIcon, PlusIcon } from "lucide-react";
import { ExternalImportSettings } from "@renderer/components/ai/external-import-settings";
import { McpSettings } from "@renderer/components/ai/mcp-settings";
import { Button } from "@renderer/components/ui/button";
import { Switch } from "@renderer/components/ui/switch";
import { SETTINGS_SECTION_LABELS } from "@renderer/lib/constants";
import { t, useLocale } from "@renderer/lib/i18n";
import { useAgentStore } from "@renderer/stores/agent";
import type { AppInfo } from "@shared/contract";
import { DataSettings } from "./settings/DataSettings";
import { GeneralSettings } from "./settings/GeneralSettings";
import { PersonalizationSettings } from "./settings/PersonalizationSettings";
import { ProviderSettings } from "./settings/ProviderSettings";

export function SettingsView(): JSX.Element {
  const settings = useAgentStore((s) => s.settings);
  const skills = useAgentStore((s) => s.skills);
  const listSkills = useAgentStore((s) => s.listSkills);
  const importSkills = useAgentStore((s) => s.importSkills);
  const toggleSkill = useAgentStore((s) => s.toggleSkill);
  const locale = useLocale();
  const section = useAgentStore((s) => s.settingsSection);
  const scroller = useRef<HTMLDivElement>(null);
  const previousSection = useRef(section);
  const [appInfo, setAppInfo] = useState<AppInfo | null>(null);

  useEffect(() => {
    void window.pi.getAppInfo().then(setAppInfo);
  }, []);

  useEffect(() => {
    if (section === "skills") void listSkills();
  }, [listSkills, section]);

  useEffect(() => {
    if (previousSection.current !== section) scroller.current?.scrollTo(0, 0);
    previousSection.current = section;
  }, [section]);

  return (
    <div
      ref={scroller}
      className="settings-scroll min-h-0 flex-1 overflow-y-auto [scrollbar-gutter:stable_both-edges]"
    >
      <div className="workspace-column grid gap-7 pt-7 pb-10 sm:pt-9">
        <h1 className="text-[clamp(1.375rem,2.5vw,1.75rem)] leading-tight font-semibold tracking-tight">
          {t(SETTINGS_SECTION_LABELS[section], locale)}
        </h1>

        {/* Keep in-progress edits when the settings page changes. */}
        <div hidden={section !== "general"}>
          {settings && (
            <GeneralSettings settings={settings} isWindows={appInfo?.isWindows ?? false} />
          )}
        </div>

        <div hidden={section !== "providers"}>
          {settings && <ProviderSettings settings={settings} />}
        </div>

        <div hidden={section !== "persona"}>
          {settings && <PersonalizationSettings savedInstructions={settings.persona} />}
        </div>

        <div hidden={section !== "data"}>
          <DataSettings appInfo={appInfo} />
        </div>

        {section === "skills" && (
          <div className="grid gap-4">
            <div className="flex flex-wrap items-center gap-2">
              <Button size="sm" onClick={() => void importSkills()}>
                <PlusIcon data-icon="inline-start" /> {t("导入技能目录", locale)}
              </Button>
              <Button variant="outline" size="sm" onClick={() => void window.pi.openPath("skills")}>
                <FolderOpenIcon data-icon="inline-start" /> {t("打开技能目录", locale)}
              </Button>
            </div>
            <div className="settings-list">
              {skills.length === 0 && (
                <p className="text-muted-foreground px-4 py-3.5 text-sm">
                  {t("还没有技能", locale)}
                </p>
              )}
              {skills.map((skill) => (
                <div key={skill.id} className="settings-row flex-nowrap">
                  <div className="min-w-0 flex-1">
                    <p className="wrap-anywhere text-sm">{skill.name}</p>
                    {skill.description && (
                      <p
                        className="text-muted-foreground line-clamp-2 text-xs leading-5"
                        title={skill.description}
                      >
                        {skill.description}
                      </p>
                    )}
                  </div>
                  <Switch
                    aria-label={skill.name}
                    checked={skill.enabled}
                    onCheckedChange={(checked) => void toggleSkill(skill.id, checked)}
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {section === "mcp" && <McpSettings locale={locale} />}

        {section === "imports" && (
          <ExternalImportSettings
            locale={locale}
            workingDirectory={settings?.workingDirectory ?? null}
          />
        )}
      </div>
    </div>
  );
}
