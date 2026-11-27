// @env browser
import { useEffect, useState, type JSX } from "react";

import { Button } from "@renderer/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@renderer/components/ui/dialog";
import { t, useLocale } from "@renderer/lib/i18n";
import type { BackupRestoreResult as RestoreResult } from "@shared/backup";

export function BackupRestoreResult(): JSX.Element {
  const locale = useLocale();
  const [result, setResult] = useState<RestoreResult | null>(null);
  useEffect(() => {
    void window.pi
      .backupResult()
      .then(setResult)
      .catch(() => {});
  }, []);

  const restored = result?.status === "applied";
  return (
    <Dialog
      open={result !== null}
      onOpenChange={(open) => {
        if (!open) setResult(null);
      }}
    >
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className={restored ? undefined : "text-destructive"}>
            {t(restored ? "已恢复数据备份" : "无法恢复备份", locale)}
          </DialogTitle>
          <DialogDescription>
            {t(
              restored
                ? "已从备份包恢复 Pilot 数据。"
                : "本机数据已还原。请检查数据目录的访问权限，再重新导入备份。",
              locale,
            )}
          </DialogDescription>
        </DialogHeader>
        {restored &&
          result &&
          (result.credentials.providers > 0 || result.credentials.services > 0) && (
            <div className="grid gap-1 text-sm text-amber-600 dark:text-amber-400">
              {result.credentials.providers > 0 && (
                <p>
                  {t("请在「模型与提供方」重新填写 {0} 项失效密钥。", locale, [
                    result.credentials.providers,
                  ])}
                </p>
              )}
              {result.credentials.services > 0 && (
                <p>
                  {t("请在「MCP 服务」重新填写凭据或登录（{0} 项）。", locale, [
                    result.credentials.services,
                  ])}
                </p>
              )}
            </div>
          )}
        <DialogFooter>
          <Button size="sm" onClick={() => setResult(null)}>
            {t("知道了", locale)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
