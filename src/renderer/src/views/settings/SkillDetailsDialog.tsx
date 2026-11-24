// @env browser
import { useEffect, useRef, useState, type JSX } from "react";

import { Button } from "@renderer/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@renderer/components/ui/dialog";
import { localizeError, t, useLocale } from "@renderer/lib/i18n";
import type { SkillMeta } from "@shared/contract";

function SkillFilePreview({
  composerId,
  id,
  directory,
}: {
  composerId: string;
  id: string;
  directory: string;
}): JSX.Element {
  const locale = useLocale();
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let current = true;
    void window.pi.skillsRead(composerId, id, directory).then(
      (value) => {
        if (current) setContent(value);
      },
      (cause: unknown) => {
        if (current) setError(cause instanceof Error ? cause.message : String(cause));
      },
    );
    return () => {
      current = false;
    };
  }, [composerId, directory, id]);

  if (error) {
    return (
      <p role="alert" className="text-sm wrap-anywhere text-destructive">
        {localizeError(error, locale)}
      </p>
    );
  }
  if (content === null)
    return <output className="text-muted-foreground">{t("加载中…", locale)}</output>;
  return (
    <pre
      aria-label="SKILL.md"
      className="max-h-[45vh] min-h-0 overflow-auto overscroll-contain rounded-md bg-muted/60 p-3 text-xs leading-5 wrap-anywhere whitespace-pre-wrap outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      {content}
    </pre>
  );
}

export function SkillDetailsDialog({
  composerId,
  skill,
  open,
  onClose,
  finalFocus,
  onDeleted,
}: {
  composerId: string;
  skill: SkillMeta;
  open: boolean;
  onClose(): void;
  finalFocus(): HTMLElement | null;
  onDeleted(next: SkillMeta[]): void;
}): JSX.Element {
  const locale = useLocale();
  const { id, directory, name, source } = skill;
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const cancel = useRef<HTMLButtonElement>(null);

  const remove = async (): Promise<void> => {
    setDeleting(true);
    setDeleteError(null);
    try {
      const next = await window.pi.skillsDelete(composerId, id, directory);
      setConfirmOpen(false);
      onDeleted(next);
    } catch (cause) {
      setDeleteError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setDeleting(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent
        closeLabel={t("关闭", locale)}
        finalFocus={finalFocus}
        className="max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)_auto] gap-3 sm:max-w-xl"
      >
        <DialogHeader className="min-w-0 pr-8">
          <DialogTitle className="wrap-anywhere">{name}</DialogTitle>
          <DialogDescription>
            {source === "installed"
              ? t("本机安装", locale)
              : t("项目技能（{0}）", locale, [source])}
          </DialogDescription>
          <p className="font-mono text-xs wrap-anywhere text-muted-foreground">{directory}</p>
        </DialogHeader>
        {open && <SkillFilePreview composerId={composerId} id={id} directory={directory} />}
        <DialogFooter>
          <Dialog
            open={confirmOpen}
            onOpenChange={(next) => {
              if (deleting) return;
              setDeleteError(null);
              setConfirmOpen(next);
            }}
          >
            <DialogTrigger render={<Button variant="outline" size="sm" />}>
              {t("删除技能…", locale)}
            </DialogTrigger>
            <DialogContent
              initialFocus={cancel}
              showCloseButton={false}
              className="max-h-[calc(100dvh-2rem)] gap-3 overflow-auto"
            >
              <DialogHeader className="min-w-0">
                <DialogTitle>{t("删除技能「{0}」？", locale, [name])}</DialogTitle>
                <DialogDescription>{t("将从磁盘删除此目录及其文件。", locale)}</DialogDescription>
                <p className="font-mono text-xs wrap-anywhere text-muted-foreground">{directory}</p>
              </DialogHeader>
              {deleteError && (
                <p role="alert" className="wrap-anywhere text-destructive">
                  {localizeError(deleteError, locale)}
                </p>
              )}
              <DialogFooter>
                <DialogClose
                  render={<Button ref={cancel} variant="outline" size="sm" disabled={deleting} />}
                >
                  {t("取消", locale)}
                </DialogClose>
                <Button
                  variant="destructive"
                  size="sm"
                  disabled={deleting}
                  onClick={() => void remove()}
                >
                  {t(deleting ? "正在删除…" : "删除技能", locale)}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
