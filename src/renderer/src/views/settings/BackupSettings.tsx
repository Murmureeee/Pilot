// @env browser
import { useEffect, useRef, useState, type JSX } from "react";

import { Button } from "@renderer/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@renderer/components/ui/dialog";
import { localizeError, t, useLocale } from "@renderer/lib/i18n";
import type { BackupContents, BackupPreview } from "@shared/backup";

import { SettingsGroup, SettingsItem } from "./SettingsGroup";

const contentsLabels = {
  settings: "设置",
  chats: "聊天记录",
  drafts: "草稿",
  skills: "技能",
  rules: "授权规则",
  plugins: "插件",
} satisfies Record<keyof BackupContents, string>;

export function BackupSettings(): JSX.Element {
  const locale = useLocale();
  const restoreButton = useRef<HTMLButtonElement>(null);
  const cancelButton = useRef<HTMLButtonElement>(null);
  const mounted = useRef(false);
  const token = useRef<string | undefined>(undefined);
  const [preview, setPreview] = useState<BackupPreview | null>(null);
  const [pending, setPending] = useState<"export" | "preview" | "restore" | null>(null);
  const [message, setMessage] = useState<string>();
  const [error, setError] = useState<string>();

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (token.current) void window.pi.cancelBackup(token.current).catch(() => {});
    };
  }, []);

  async function run(operation: NonNullable<typeof pending>): Promise<void> {
    setPending(operation);
    setError(undefined);
    setMessage(undefined);
    try {
      if (operation === "export") {
        if (await window.pi.exportBackup()) setMessage("已导出数据备份。");
      } else if (operation === "preview") {
        const backup = await window.pi.previewBackup();
        if (mounted.current) {
          token.current = backup?.token;
          setPreview(backup);
        } else if (backup) await window.pi.cancelBackup(backup.token);
      } else if (preview) {
        await window.pi.restoreBackup(preview.token);
        return;
      }
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
    setPending(null);
  }

  async function cancel(): Promise<void> {
    const previous = token.current;
    token.current = undefined;
    setPreview(null);
    setError(undefined);
    try {
      if (previous) await window.pi.cancelBackup(previous);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    }
  }

  const formatValue = (value: boolean | number): string =>
    typeof value === "boolean"
      ? t(value ? "有" : "无", locale)
      : new Intl.NumberFormat(locale).format(value);

  return (
    <SettingsGroup id="settings-backup" title={t("数据备份与恢复", locale)}>
      <div className="settings-list">
        <SettingsItem
          label={t("数据备份", locale)}
          description={t("将聊天、草稿、设置、技能、授权规则和插件保存到一个备份包。", locale)}
        >
          <Button
            size="sm"
            variant="outline"
            disabled={pending !== null}
            onClick={() => void run("export")}
          >
            {t(pending === "export" ? "导出中…" : "导出备份", locale)}
          </Button>
        </SettingsItem>
        <SettingsItem
          label={t("恢复备份", locale)}
          description={t("选择备份包，查看本机数据的覆盖范围。", locale)}
        >
          <Button
            ref={restoreButton}
            size="sm"
            variant="outline"
            disabled={pending !== null}
            onClick={() => void run("preview")}
          >
            {t(pending === "preview" ? "读取备份中…" : "选择备份包", locale)}
          </Button>
        </SettingsItem>
      </div>
      {message && <output className="text-xs text-muted-foreground">{t(message, locale)}</output>}
      {error && !preview && (
        <p role="alert" className="text-xs wrap-anywhere text-destructive">
          {localizeError(error, locale)}
        </p>
      )}
      <Dialog
        open={preview !== null}
        disablePointerDismissal
        onOpenChange={(open) => {
          if (!open && pending !== "restore") void cancel();
        }}
      >
        <DialogContent
          showCloseButton={false}
          initialFocus={cancelButton}
          finalFocus={restoreButton}
          className="max-h-[calc(100dvh-4rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-4"
        >
          <DialogHeader>
            <DialogTitle>{t("恢复备份", locale)}</DialogTitle>
            <DialogDescription>
              {t("Pilot 将重启并用备份包替换以下本机数据。", locale)}
            </DialogDescription>
          </DialogHeader>
          <div className="grid min-h-0 gap-3 overflow-y-auto">
            {preview && (
              <>
                <p className="font-medium wrap-anywhere">{preview.name}</p>
                <table className="w-full text-sm">
                  <thead className="text-xs text-muted-foreground">
                    <tr>
                      <th scope="col" className="text-start font-medium">
                        {t("数据", locale)}
                      </th>
                      <th scope="col" className="text-end font-medium">
                        {t("本机", locale)}
                      </th>
                      <th scope="col" className="text-end font-medium">
                        {t("备份包", locale)}
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {Object.entries(contentsLabels).map(([key, label]) => {
                      const field = key as keyof BackupContents;
                      return (
                        <tr key={field} className="border-b last:border-b-0">
                          <th scope="row" className="py-1.5 text-start font-normal">
                            {t(label, locale)}
                          </th>
                          <td className="text-end tabular-nums">
                            {formatValue(preview.current[field])}
                          </td>
                          <td className="text-end tabular-nums">
                            {formatValue(preview.incoming[field])}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                {(preview.credentials.providers > 0 || preview.credentials.services > 0) && (
                  <p className="text-xs text-amber-600 dark:text-amber-400">
                    {t("恢复后需重新填写凭据或登录（提供方 {0} 项，MCP 服务 {1} 项）。", locale, [
                      preview.credentials.providers,
                      preview.credentials.services,
                    ])}
                  </p>
                )}
              </>
            )}
            {error && preview && (
              <p role="alert" className="text-xs wrap-anywhere text-destructive">
                {localizeError(error, locale)}
              </p>
            )}
          </div>
          <DialogFooter>
            <Button
              ref={cancelButton}
              size="sm"
              variant="outline"
              disabled={pending === "restore"}
              onClick={() => void cancel()}
            >
              {t("取消", locale)}
            </Button>
            <Button
              size="sm"
              variant="destructive"
              disabled={pending === "restore"}
              onClick={() => void run("restore")}
            >
              {t(pending === "restore" ? "正在重启…" : "覆盖并重启", locale)}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </SettingsGroup>
  );
}
