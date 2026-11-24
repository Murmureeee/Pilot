// @env browser
// 永久删除会话的二次确认弹窗（Sidebar 右键菜单与设置页归档管理共用）。
// 语义 = ChatGPT「永久删除」：转录文件从磁盘彻底清除，不可恢复（与归档相对）。
import type { JSX } from "react";

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
import type { SessionMeta } from "@shared/contract";

export function SessionDeleteDialog({
  target,
  onClose,
}: {
  target: SessionMeta | null;
  onClose(): void;
}): JSX.Element {
  const locale = useLocale();
  const deleteSession = useAgentStore((s) => s.deleteSession);

  return (
    <Dialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent closeLabel={t("关闭", locale)}>
        <DialogHeader>
          <DialogTitle>{t("永久删除聊天？", locale)}</DialogTitle>
          <DialogDescription>
            {t("「{0}」的聊天记录将从磁盘彻底删除，此操作无法恢复。", locale, [
              target?.title ?? "",
            ])}
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            {t("取消", locale)}
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              const id = target?.id;
              onClose();
              if (id) void deleteSession(id);
            }}
          >
            {t("永久删除", locale)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
