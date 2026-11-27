// @env browser
import { useState, type JSX } from "react";

import { Button } from "@renderer/components/ui/button";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@renderer/components/ui/select";
import { Switch } from "@renderer/components/ui/switch";
import { COMMAND_SHELL_LABELS, SEND_KEY_LABELS } from "@renderer/lib/constants";
import { localizeError, t, useLocale } from "@renderer/lib/i18n";
import { loadSendKey, saveSendKey } from "@renderer/lib/preferences";
import type { SendKey } from "@renderer/lib/types";
import { useAgentStore } from "@renderer/stores/agent";
import type { CommandShell, PublicSettings } from "@shared/contract";

import { DesktopBackgroundSettings } from "./DesktopBackgroundSettings";
import { ExternalEditorSettings } from "./ExternalEditorSettings";
import { ProjectHookSettings } from "./ProjectHookSettings";
import { SettingsGroup, SettingsItem } from "./SettingsGroup";

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
    <SettingsGroup
      id="settings-workspace"
      title={t("工作环境", locale)}
      description={t("Agent 读写文件和运行命令的位置与方式。", locale)}
    >
      <div className="settings-list">
        <div className="settings-row">
          <div className="min-w-0 flex-1 basis-64">
            <h3 className="text-sm font-medium">{t("默认工作目录", locale)}</h3>
            <p className="mt-0.5 text-xs leading-5 text-muted-foreground">
              {t("未关联项目时，文件工具和命令使用此目录。", locale)}
            </p>
            <p className="mt-1 text-xs wrap-anywhere select-text">
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
                  className="mt-0.5 text-xs leading-5 text-muted-foreground"
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
                <SelectValue>{COMMAND_SHELL_LABELS[shell]}</SelectValue>
              </SelectTrigger>
              <SelectContent align="end" alignItemWithTrigger={false}>
                <SelectGroup>
                  {(Object.keys(COMMAND_SHELL_LABELS) as CommandShell[]).map((value) => (
                    <SelectItem key={value} value={value}>
                      {COMMAND_SHELL_LABELS[value]}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
        )}
      </div>
      {(dirty || saving || saved) && (
        <div className="flex flex-wrap items-center justify-end gap-2">
          {saved && (
            <output className="text-xs text-muted-foreground">{t("已保存", locale)}</output>
          )}
          {(dirty || saving) && (
            <Button size="sm" disabled={picking || saving} onClick={() => void save()}>
              {saving ? t("保存中…", locale) : t("保存", locale)}
            </Button>
          )}
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {localizeError(error, locale)}
        </p>
      )}
    </SettingsGroup>
  );
}

function NotificationPreferences({ enabled }: { enabled: boolean }): JSX.Element {
  const locale = useLocale();
  const setNotificationsEnabled = useAgentStore((s) => s.setNotificationsEnabled);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string>();

  const save = async (checked: boolean): Promise<void> => {
    if (saving) return;
    setSaving(true);
    setError(undefined);
    try {
      await setNotificationsEnabled(checked);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSaving(false);
    }
  };

  const label = t("桌面通知", locale);
  return (
    <SettingsGroup id="settings-notifications" title={t("通知", locale)}>
      <div className="settings-list">
        <SettingsItem
          label={label}
          htmlFor="settings-desktop-notifications"
          description={t(
            "离开当前对话时提示待审批、完成和失败。Windows 同时提供任务栏提醒。",
            locale,
          )}
        >
          <Switch
            id="settings-desktop-notifications"
            aria-label={label}
            aria-busy={saving || undefined}
            checked={enabled}
            onCheckedChange={(checked) => void save(checked)}
          />
        </SettingsItem>
      </div>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {localizeError(error, locale)}
        </p>
      )}
    </SettingsGroup>
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
  const [sendKey, setSendKey] = useState<SendKey>(loadSendKey);

  return (
    <div className="grid grid-cols-1 gap-9">
      <SettingsGroup id="settings-conversation" title={t("对话", locale)}>
        <div className="settings-list min-w-0">
          <SettingsItem
            label={t("发送方式", locale)}
            htmlFor="settings-send-key"
            description={t("输入法组词时按 Enter 只确认候选词。", locale)}
          >
            <Select
              value={sendKey}
              onValueChange={(value: SendKey | null) => {
                if (!value) return;
                setSendKey(value);
                saveSendKey(value);
              }}
            >
              <SelectTrigger
                id="settings-send-key"
                className="max-w-full"
                title={t(SEND_KEY_LABELS[sendKey], locale)}
              >
                <SelectValue>{t(SEND_KEY_LABELS[sendKey], locale)}</SelectValue>
              </SelectTrigger>
              <SelectContent align="end" alignItemWithTrigger={false}>
                <SelectGroup>
                  {(Object.keys(SEND_KEY_LABELS) as SendKey[]).map((value) => (
                    <SelectItem key={value} value={value}>
                      {t(SEND_KEY_LABELS[value], locale)}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </SettingsItem>
        </div>
      </SettingsGroup>
      <ToolEnvironmentForm settings={settings} isWindows={isWindows} />
      <ProjectHookSettings projects={settings.projectHooks} shell={settings.commandShell} />
      <ExternalEditorSettings editor={settings.externalEditor} isWindows={isWindows} />
      <NotificationPreferences enabled={settings.notificationsEnabled} />
      <DesktopBackgroundSettings />
    </div>
  );
}
