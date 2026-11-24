// @env browser
// 重命名与会话指令弹窗（侧栏右键菜单与主列顶栏的更多菜单共用）。
import { useState, type JSX, type RefObject } from "react";

import { Button } from "@renderer/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@renderer/components/ui/dialog";
import { Input } from "@renderer/components/ui/input";
import { Textarea } from "@renderer/components/ui/textarea";
import { t, useLocale } from "@renderer/lib/i18n";
import { useAgentStore } from "@renderer/stores/agent";
import type { SessionMeta } from "@shared/contract";

interface SessionDialogProps {
  target: SessionMeta | null;
  onClose(): void;
  finalFocus?: RefObject<HTMLElement | null>;
}

function RenameForm({ target, onClose }: Omit<SessionDialogProps, "finalFocus">): JSX.Element {
  const locale = useLocale();
  const renameSession = useAgentStore((s) => s.renameSession);
  // 关闭动画期间 target 已清空，表单保留打开时的会话。
  const [session] = useState(target);
  const [value, setValue] = useState(target?.title ?? "");

  const save = (): void => {
    const title = value.trim();
    onClose();
    if (session && title.length > 0 && title !== session.title) {
      void renameSession(session.id, title);
    }
  };

  return (
    <>
      <Input
        value={value}
        onChange={(event) => setValue(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === "Enter") save();
        }}
        aria-label={t("重命名聊天", locale)}
        className="h-9"
      />
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          {t("取消", locale)}
        </Button>
        <Button onClick={save}>{t("保存", locale)}</Button>
      </DialogFooter>
    </>
  );
}

/** 显式「保存」提交，没有行内编辑的焦点竞争问题。 */
export function SessionRenameDialog({
  target,
  onClose,
  finalFocus,
}: SessionDialogProps): JSX.Element {
  const locale = useLocale();
  return (
    <Dialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent closeLabel={t("关闭", locale)} finalFocus={finalFocus}>
        <DialogHeader>
          <DialogTitle>{t("重命名聊天", locale)}</DialogTitle>
          <DialogDescription>{t("保持简短且易于识别", locale)}</DialogDescription>
        </DialogHeader>
        <RenameForm target={target} onClose={onClose} />
      </DialogContent>
    </Dialog>
  );
}

function PersonaForm({ target, onClose }: Omit<SessionDialogProps, "finalFocus">): JSX.Element {
  const locale = useLocale();
  const setSessionPersona = useAgentStore((s) => s.setSessionPersona);
  const [session] = useState(target);
  const [value, setValue] = useState(target?.personaOverride ?? "");

  return (
    <>
      <Textarea
        value={value}
        onChange={(event) => setValue(event.target.value)}
        rows={5}
        aria-label={t("会话指令", locale)}
        placeholder={t("例如：用英文回复；回答尽量带代码示例…", locale)}
      />
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>
          {t("取消", locale)}
        </Button>
        <Button
          onClick={() => {
            onClose();
            // 保存空文本即清除覆盖，回落到全局个性化。
            if (session) void setSessionPersona(session.id, value.trim() || null);
          }}
        >
          {t("保存", locale)}
        </Button>
      </DialogFooter>
    </>
  );
}

export function SessionPersonaDialog({
  target,
  onClose,
  finalFocus,
}: SessionDialogProps): JSX.Element {
  const locale = useLocale();
  return (
    <Dialog
      open={target !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent closeLabel={t("关闭", locale)} finalFocus={finalFocus}>
        <DialogHeader>
          <DialogTitle>{t("会话指令", locale)}</DialogTitle>
          <DialogDescription>
            {t("只对本会话生效，覆盖设置页的全局人设；留空保存 = 清除覆盖", locale)}
          </DialogDescription>
        </DialogHeader>
        <PersonaForm target={target} onClose={onClose} />
      </DialogContent>
    </Dialog>
  );
}
