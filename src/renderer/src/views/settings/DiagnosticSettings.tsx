// @env browser
import { DownloadIcon, FolderOpenIcon } from "lucide-react";
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
import { LOG_LEVEL_LABELS } from "@renderer/lib/constants";
import { t, useLocale } from "@renderer/lib/i18n";
import { useAgentStore } from "@renderer/stores/agent";
import {
  DIAGNOSTIC_EVENT_LIMIT,
  LOG_FILE_COUNT,
  LOG_FILE_MAX_BYTES,
  LOG_LEVELS,
} from "@shared/constants";
import type { LogLevel } from "@shared/contract";

import { DiagnosticEvents } from "./DiagnosticEvents";
import { SettingsGroup, SettingsItem } from "./SettingsGroup";

export function DiagnosticSettings(): JSX.Element {
  const locale = useLocale();
  const level = useAgentStore((state) => state.settings?.logLevel ?? null);
  const setLogLevel = useAgentStore((state) => state.setLogLevel);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportResult, setExportResult] = useState<"saved" | "failed" | null>(null);

  const changeLevel = async (next: LogLevel): Promise<void> => {
    setSaving(true);
    setError(null);
    try {
      await setLogLevel(next);
    } catch {
      setError("无法保存日志级别。");
    } finally {
      setSaving(false);
    }
  };

  const openLogs = async (): Promise<void> => {
    setError(null);
    try {
      if (await window.pi.openPath("logs")) setError("无法打开日志目录。");
    } catch {
      setError("无法打开日志目录。");
    }
  };

  const exportReport = async (): Promise<void> => {
    setExporting(true);
    setExportResult(null);
    try {
      if (await window.pi.exportDiagnostics(locale)) setExportResult("saved");
    } catch {
      setExportResult("failed");
    } finally {
      setExporting(false);
    }
  };

  return (
    <SettingsGroup id="settings-diagnostics" title={t("诊断日志", locale)}>
      <div className="settings-list">
        <div className="settings-row">
          <div className="min-w-0 flex-1 basis-52">
            <label htmlFor="diagnostic-log-level" className="text-sm font-medium">
              {t("日志级别", locale)}
            </label>
            <p id="diagnostic-log-limit" className="text-xs leading-5 text-muted-foreground">
              {t("本地最多保留 {0} 个日志文件，每个不超过 {1} MiB。", locale, [
                LOG_FILE_COUNT,
                LOG_FILE_MAX_BYTES / 1024 ** 2,
              ])}
            </p>
          </div>
          <Select
            value={level}
            disabled={saving || level === null}
            onValueChange={(next: LogLevel | null) => {
              if (next && next !== level) void changeLevel(next);
            }}
          >
            <SelectTrigger id="diagnostic-log-level" aria-describedby="diagnostic-log-limit">
              <SelectValue>{level && t(LOG_LEVEL_LABELS[level], locale)}</SelectValue>
            </SelectTrigger>
            <SelectContent align="end" alignItemWithTrigger={false}>
              <SelectGroup>
                {LOG_LEVELS.map((option) => (
                  <SelectItem key={option} value={option}>
                    {t(LOG_LEVEL_LABELS[option], locale)}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
        </div>
        <div className="settings-row">
          <p className="min-w-0 flex-1 text-sm font-medium">{t("日志目录", locale)}</p>
          <Button
            variant="outline"
            size="sm"
            onClick={() => void openLogs()}
            aria-label={t("打开日志目录", locale)}
          >
            <FolderOpenIcon data-icon="inline-start" /> {t("打开文件夹", locale)}
          </Button>
        </div>
        <SettingsItem
          label={t("诊断事件", locale)}
          description={t("查看最近 {0} 条事件，包括崩溃记录。", locale, [DIAGNOSTIC_EVENT_LIMIT])}
        >
          <DiagnosticEvents />
        </SettingsItem>
        <SettingsItem
          label={t("脱敏诊断", locale)}
          description={t("将运行环境版本及本地保留的事件摘要保存为 JSON。", locale)}
        >
          <Button
            variant="outline"
            size="sm"
            aria-disabled={exporting}
            onClick={() => {
              if (!exporting) void exportReport();
            }}
          >
            <DownloadIcon data-icon="inline-start" />
            {t(exporting ? "导出中…" : "导出 JSON", locale)}
          </Button>
        </SettingsItem>
      </div>
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {t(error, locale)}
        </p>
      )}
      {exportResult === "saved" && (
        <output className="text-xs text-muted-foreground">{t("已导出脱敏诊断。", locale)}</output>
      )}
      {exportResult === "failed" && (
        <p role="alert" className="text-xs text-destructive">
          {t("无法导出诊断。请确认日志可读取，并选择可写入的位置重试。", locale)}
        </p>
      )}
    </SettingsGroup>
  );
}
