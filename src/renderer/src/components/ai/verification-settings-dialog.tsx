// @env browser
import { useId, useRef, useState, type JSX, type RefObject } from "react";

import { Button } from "@renderer/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@renderer/components/ui/dialog";
import { Input } from "@renderer/components/ui/input";
import { COMMAND_SHELL_LABELS, VERIFICATION_LABELS } from "@renderer/lib/constants";
import { localizeError, t, useLocale } from "@renderer/lib/i18n";
import { VERIFICATION_COMMAND_LIMIT } from "@shared/constants";
import {
  VERIFICATION_KINDS,
  type AfterTurnVerification,
  type VerificationKind,
  type VerificationProject,
} from "@shared/contract";

import { ProjectConfigSource } from "./project-config-details";

export function VerificationSettingsDialog({
  composerId,
  project,
  commands,
  defaultKind,
  finalFocus,
  onSaved,
  onClose,
}: {
  composerId: string;
  project: VerificationProject;
  commands: Partial<Record<VerificationKind, string>>;
  defaultKind: VerificationKind;
  finalFocus: RefObject<HTMLButtonElement | null>;
  onSaved(): void;
  onClose(): void;
}): JSX.Element {
  const locale = useLocale();
  const id = useId();
  const [open, setOpen] = useState(true);
  const [kind, setKind] = useState(project.afterTurn?.kind ?? defaultKind);
  const [drafts, setDrafts] = useState<Partial<Record<VerificationKind, string>>>(() => {
    const saved = project.afterTurn;
    return saved ? { [saved.kind]: saved.command } : {};
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string>();
  const input = useRef<HTMLInputElement>(null);
  const command = drafts[kind] ?? commands[kind] ?? "";
  const shell = project.shell;

  const save = async (config: AfterTurnVerification | "project" | null): Promise<void> => {
    if (pending) return;
    setPending(true);
    setError(undefined);
    try {
      await window.pi.sessionSetAfterTurnVerification(composerId, project.directory, config);
      onSaved();
      setOpen(false);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(false);
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!pending) setOpen(next);
      }}
      onOpenChangeComplete={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent
        initialFocus={input}
        finalFocus={finalFocus}
        showCloseButton={false}
        className="max-h-[calc(100dvh-2rem)] gap-4 overflow-y-auto overscroll-contain"
      >
        <DialogHeader>
          <DialogTitle>{t("回合后验证", locale)}</DialogTitle>
          <DialogDescription>
            {t("Agent 成功完成一轮后，在此项目中运行命令。", locale)}
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid min-w-0 gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (command.trim()) void save({ kind, command: command.trim(), shell });
          }}
        >
          <dl className="grid min-w-0 gap-2 text-xs">
            <div className="grid min-w-0 gap-0.5">
              <dt className="text-muted-foreground">{t("项目目录", locale)}</dt>
              <dd className="font-mono wrap-anywhere">{project.directory}</dd>
            </div>
            <div className="grid gap-0.5">
              <dt className="text-muted-foreground">Shell</dt>
              <dd>{COMMAND_SHELL_LABELS[shell]}</dd>
            </div>
          </dl>
          {project.afterTurnSource === "project" && <ProjectConfigSource />}
          <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("验证类型", locale)}>
            {VERIFICATION_KINDS.map((item) => (
              <Button
                key={item}
                type="button"
                size="sm"
                variant={item === kind ? "secondary" : "ghost"}
                aria-pressed={item === kind}
                disabled={pending}
                onClick={() => setKind(item)}
              >
                {t(VERIFICATION_LABELS[item], locale)}
              </Button>
            ))}
          </div>
          <div className="grid gap-1.5">
            <label htmlFor={id} className="text-sm font-medium">
              {t("命令", locale)}
            </label>
            <Input
              id={id}
              ref={input}
              value={command}
              onChange={(event) => {
                setDrafts((values) => ({ ...values, [kind]: event.target.value }));
                setError(undefined);
              }}
              placeholder={t("输入验证命令", locale)}
              maxLength={VERIFICATION_COMMAND_LIMIT}
              disabled={pending}
              className="font-mono"
            />
          </div>
          {error && (
            <p role="alert" className="text-xs wrap-anywhere text-destructive">
              {localizeError(error, locale)}
            </p>
          )}
          <DialogFooter className="flex-row flex-wrap justify-end gap-2">
            {project.afterTurnOverride && (
              <Button
                type="button"
                variant="ghost"
                disabled={pending}
                onClick={() => void save("project")}
              >
                {t("使用项目设置", locale)}
              </Button>
            )}
            {project.afterTurn && (
              <Button
                type="button"
                variant="ghost"
                disabled={pending}
                onClick={() => void save(null)}
              >
                {t("停用回合后验证", locale)}
              </Button>
            )}
            <DialogClose render={<Button type="button" variant="outline" disabled={pending} />}>
              {t("取消", locale)}
            </DialogClose>
            <Button type="submit" disabled={pending || !command.trim()}>
              {t(pending ? "保存中…" : "保存", locale)}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
