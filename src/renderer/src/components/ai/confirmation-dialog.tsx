// @env browser
// 权限确认弹窗：读类工具不经过这里；写类/命令每次或按规则放行。
import type { JSX } from "react";
import { AlertTriangleIcon } from "lucide-react";
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
import { useAgentStore } from "@renderer/stores/agent";

export function ConfirmationDialog(): JSX.Element | null {
  const locale = useLocale();
  const pending = useAgentStore((s) => s.pendingPermission);
  const respond = useAgentStore((s) => s.respondPermission);

  if (!pending) return null;

  return (
    <Dialog open>
      <DialogContent closeLabel={t("关闭", locale)} className="max-w-lg">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            {pending.danger && <AlertTriangleIcon className="size-4 text-destructive" />}
            {t("允许「{0}」？", locale, [t(pending.label, locale)])}
          </DialogTitle>
          <DialogDescription>
            {t("Agent 请求执行一个会改动你系统的操作，请确认。", locale)}
          </DialogDescription>
        </DialogHeader>

        <div
          className={
            pending.danger
              ? "rounded-md bg-destructive/10 px-3 py-2 font-mono text-xs break-all whitespace-pre-wrap text-destructive"
              : "rounded-md bg-muted px-3 py-2 font-mono text-xs break-all whitespace-pre-wrap"
          }
        >
          {pending.danger && (
            <p className="mb-1 font-sans font-medium">{t("⚠ 检测到危险命令特征", locale)}</p>
          )}
          {pending.inputSummary}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" size="sm" onClick={() => respond(pending.requestId, "deny")}>
            {t("拒绝", locale)}
          </Button>
          <Button variant="outline" size="sm" onClick={() => respond(pending.requestId, "once")}>
            {t("本次允许", locale)}
          </Button>
          <Button variant="outline" size="sm" onClick={() => respond(pending.requestId, "session")}>
            {t("本会话总是", locale)}
          </Button>
          <Button size="sm" onClick={() => respond(pending.requestId, "global")}>
            {t("总是允许", locale)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
