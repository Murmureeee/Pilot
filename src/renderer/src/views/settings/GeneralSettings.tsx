// @env browser
import { useState, type JSX } from "react";
import { ChevronDownIcon } from "lucide-react";
import { Button } from "@renderer/components/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@renderer/components/ui/collapsible";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@renderer/components/ui/select";
import { APPROVAL_MODE_OPTIONS, THEME_LABELS } from "@renderer/lib/constants";
import { localizeError, setLocale, t, useLocale } from "@renderer/lib/i18n";
import { applyTheme, loadTheme } from "@renderer/lib/theme";
import { useAgentStore } from "@renderer/stores/agent";
import { LOCALE_DETAILS, SUPPORTED_LOCALES } from "@shared/constants";
import type {
  ApprovalMode,
  CommandShell,
  Locale,
  PublicSettings,
  ThemeSetting,
} from "@shared/contract";
import { cn } from "cn";

function PermissionSettings({ settings }: { settings: PublicSettings }): JSX.Element {
  const locale = useLocale();
  const setApprovalMode = useAgentStore((s) => s.setApprovalMode);
  const removeToolRule = useAgentStore((s) => s.removeToolRule);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const mode = settings.approvalMode;
  const rules = settings.toolRules ?? [];

  const update = async (action: () => Promise<void>): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      await action();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="grid gap-3" aria-labelledby="settings-permissions">
      <h2 id="settings-permissions" className="text-sm font-medium">
        {t("权限", locale)}
      </h2>
      <div className="settings-list">
        <div className="settings-row">
          <div className="min-w-0 flex-1 basis-52">
            <label htmlFor="approval-mode" className="text-sm font-medium">
              {t("权限模式", locale)}
            </label>
            <p id="approval-mode-help" className="text-muted-foreground mt-0.5 text-xs leading-5">
              {t(APPROVAL_MODE_OPTIONS[mode].description, locale)}
            </p>
          </div>
          <Select
            value={mode}
            disabled={saving}
            onValueChange={(next: ApprovalMode | null) => {
              if (next && next !== mode) void update(() => setApprovalMode(next));
            }}
          >
            <SelectTrigger
              id="approval-mode"
              aria-describedby="approval-mode-help"
              className={cn(mode === "full-access" && "text-amber-600 dark:text-amber-400")}
            >
              <SelectValue>{t(APPROVAL_MODE_OPTIONS[mode].label, locale)}</SelectValue>
            </SelectTrigger>
            <SelectContent align="end" alignItemWithTrigger={false}>
              <SelectGroup>
                {(Object.keys(APPROVAL_MODE_OPTIONS) as ApprovalMode[]).map((option) => (
                  <SelectItem key={option} value={option}>
                    {t(APPROVAL_MODE_OPTIONS[option].label, locale)}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
        {rules.length > 0 && (
          <Collapsible>
            <CollapsibleTrigger className="settings-row group focus-visible:ring-ring w-full rounded-b-2xl text-left text-sm outline-none focus-visible:ring-2 focus-visible:ring-inset">
              <span className="font-medium">{t("已保存的授权", locale)}</span>
              <span className="text-muted-foreground flex items-center gap-2 text-xs">
                {t(rules.length === 1 ? "1 条规则" : "{0} 条规则", locale, [rules.length])}
                <ChevronDownIcon
                  aria-hidden="true"
                  className="size-4 group-aria-expanded:rotate-180"
                />
              </span>
            </CollapsibleTrigger>
            <CollapsibleContent className="divide-border divide-y border-t">
              {rules.map((rule) => (
                <div key={JSON.stringify(rule)} className="settings-row">
                  <div className="min-w-0 flex-1 basis-44">
                    <p className="wrap-anywhere text-sm">{rule.toolName}</p>
                    <p className="text-muted-foreground wrap-anywhere text-xs">
                      {rule.pathPrefix
                        ? t("仅路径前缀 {0}", locale, [rule.pathPrefix])
                        : t("全部调用", locale)}
                    </p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={saving}
                    onClick={() => void update(() => removeToolRule(rule))}
                  >
                    {t("撤销规则", locale)}
                  </Button>
                </div>
              ))}
            </CollapsibleContent>
          </Collapsible>
        )}
      </div>
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {localizeError(error, locale)}
        </p>
      )}
    </section>
  );
}

function ToolEnvironmentForm({
  settings,
  isWindows,
}: {
  settings: PublicSettings;
  isWindows: boolean;
}): JSX.Element {
  const locale = useLocale();
  const saveToolEnvironment = useAgentStore((s) => s.saveToolEnvironment);
  const [directory, setDirectory] = useState(settings.workingDirectory);
  const [shell, setShell] = useState(settings.commandShell);
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const directoryChanged = directory !== settings.workingDirectory;
  const shellChanged = shell !== settings.commandShell;
  const dirty = directoryChanged || shellChanged;

  const updateDirectory = (value: string | null): void => {
    setDirectory(value);
    setSaved(false);
    setError(null);
  };

  const pickDirectory = async (): Promise<void> => {
    setPicking(true);
    try {
      const selected = await window.pi.pickWorkingDirectory(locale);
      if (selected !== null) updateDirectory(selected);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPicking(false);
    }
  };

  const save = async (): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      await saveToolEnvironment({
        workingDirectory: directoryChanged ? directory : undefined,
        commandShell: shellChanged ? shell : undefined,
      });
      setDirectory(useAgentStore.getState().settings?.workingDirectory ?? null);
      setSaved(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="grid gap-3" aria-labelledby="settings-workspace">
      <h2 id="settings-workspace" className="text-sm font-medium">
        {t("工作环境", locale)}
      </h2>
      <div className="settings-list">
        <div className="settings-row">
          <div className="min-w-0 flex-1 basis-64">
            <h3 className="text-sm font-medium">{t("默认工作目录", locale)}</h3>
            <p className="text-muted-foreground mt-0.5 text-xs leading-5">
              {t("未关联项目时，文件工具和命令使用此目录。", locale)}
            </p>
            <p className="mt-1 select-text wrap-anywhere text-xs">
              {directory ?? t("用户主目录（默认）", locale)}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              disabled={picking || saving}
              onClick={() => void pickDirectory()}
            >
              {t("选择目录", locale)}
            </Button>
            {directory !== null && (
              <Button
                variant="ghost"
                size="sm"
                disabled={picking || saving}
                onClick={() => updateDirectory(null)}
              >
                {t("恢复默认", locale)}
              </Button>
            )}
          </div>
        </div>
        {isWindows && (
          <div className="settings-row">
            <div className="min-w-0">
              <label htmlFor="command-shell" className="text-sm font-medium">
                {t("命令环境", locale)}
              </label>
              {shell === "bash" && (
                <p
                  id="command-shell-help"
                  className="text-muted-foreground mt-0.5 text-xs leading-5"
                >
                  {t("Git Bash 需要 Git for Windows。", locale)}
                </p>
              )}
            </div>
            <Select
              value={shell}
              disabled={saving}
              onValueChange={(value: CommandShell | null) => {
                if (value === null) return;
                setShell(value);
                setSaved(false);
                setError(null);
              }}
            >
              <SelectTrigger
                id="command-shell"
                aria-describedby={shell === "bash" ? "command-shell-help" : undefined}
              >
                <SelectValue>{shell === "powershell" ? "PowerShell" : "Git Bash"}</SelectValue>
              </SelectTrigger>
              <SelectContent align="end" alignItemWithTrigger={false}>
                <SelectGroup>
                  <SelectItem value="powershell">PowerShell</SelectItem>
                  <SelectItem value="bash">Git Bash</SelectItem>
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
      {(dirty || saving || saved) && (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {saved && (
            <output className="text-muted-foreground text-xs">{t("已保存", locale)}</output>
          )}
          {(dirty || saving) && (
            <Button size="sm" disabled={picking || saving} onClick={() => void save()}>
              {saving ? t("保存中…", locale) : t("保存", locale)}
            </Button>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="text-destructive text-sm">
          {localizeError(error, locale)}
        </p>
      )}
    </section>
  );
}

export function GeneralSettings({
  settings,
  isWindows,
}: {
  settings: PublicSettings;
  isWindows: boolean;
}): JSX.Element {
  const locale = useLocale();
  const [theme, setTheme] = useState<ThemeSetting>(loadTheme);

  return (
    <div className="grid gap-7">
      <PermissionSettings settings={settings} />
      <ToolEnvironmentForm settings={settings} isWindows={isWindows} />
      <section className="grid gap-3" aria-labelledby="settings-appearance">
        <h2 id="settings-appearance" className="text-sm font-medium">
          {t("外观与语言", locale)}
        </h2>
        <div className="settings-list">
          <div className="settings-row">
            <label htmlFor="settings-theme" className="text-sm font-medium">
              {t("主题", locale)}
            </label>
            <Select
              value={theme}
              onValueChange={(value: ThemeSetting | null) => {
                if (!value) return;
                setTheme(value);
                applyTheme(value);
              }}
            >
              <SelectTrigger id="settings-theme">
                <SelectValue>{t(THEME_LABELS[theme], locale)}</SelectValue>
              </SelectTrigger>
              <SelectContent align="end" alignItemWithTrigger={false}>
                <SelectGroup>
                  {(Object.keys(THEME_LABELS) as ThemeSetting[]).map((value) => (
                    <SelectItem key={value} value={value}>
                      {t(THEME_LABELS[value], locale)}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
          <div className="settings-row">
            <label htmlFor="settings-language" className="text-sm font-medium">
              {t("语言", locale)}
            </label>
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
          </div>
        </div>
      </section>
    </div>
  );
}
