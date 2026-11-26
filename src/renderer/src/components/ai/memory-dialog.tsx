// @env browser
import { Field } from "@base-ui/react/field";
import { BookmarkIcon } from "lucide-react";
import { useEffect, useId, useRef, useState, type JSX, type RefObject } from "react";

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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@renderer/components/ui/select";
import { Textarea } from "@renderer/components/ui/textarea";
import { localizeError, t, useLocale } from "@renderer/lib/i18n";
import { MEMORY_TEXT_LIMIT } from "@shared/constants";
import type { MemoryPreview, MemoryProposal, MemoryScope } from "@shared/contract";

import { DiffLines } from "./file-diff-preview";

export function MemoryDialog({
  composerId,
  projectDirectory,
  proposal,
  finalFocus,
  onClose,
  onSendAsMessage,
}: {
  composerId: string;
  projectDirectory: string | null;
  proposal: MemoryProposal;
  finalFocus: RefObject<HTMLElement | null>;
  onClose(saved: boolean): void;
  onSendAsMessage?(): void;
}): JSX.Element {
  const locale = useLocale();
  const [open, setOpen] = useState(true);
  const [scope, setScope] = useState<MemoryScope>(
    projectDirectory && proposal.scope !== "global" ? "project" : "global",
  );
  const [text, setText] = useState(proposal.text);
  const [preview, setPreview] = useState<MemoryPreview | null>(null);
  const [outcome, setOutcome] = useState<"saved" | "undone" | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const scopeId = useId();
  const note = useRef<HTMLTextAreaElement>(null);
  const diff = useRef<HTMLDivElement>(null);
  const done = useRef<HTMLButtonElement>(null);
  const sendOriginal = useRef(false);
  const items = [
    ...(projectDirectory ? [{ value: "project" as const, label: t("项目指令", locale) }] : []),
    { value: "global" as const, label: t("全局个性化", locale) },
  ];
  const destination = preview?.path ?? t("设置 → 个性化 → 自定义指令", locale);
  const diffLabel = t("拟议记忆差异", locale);

  useEffect(() => {
    if (outcome) done.current?.focus();
    else if (preview) diff.current?.focus();
    else note.current?.focus();
  }, [outcome, preview]);

  const perform = async (operation: () => Promise<void>): Promise<void> => {
    if (pending) return;
    setPending(true);
    setError(null);
    try {
      await operation();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setPending(false);
    }
  };

  const confirm = (): Promise<void> =>
    perform(async () => {
      if (preview) {
        await window.pi.sessionSaveMemory(composerId, preview.token);
        setOutcome("saved");
      } else {
        setPreview(await window.pi.sessionPreviewMemory(composerId, projectDirectory, scope, text));
      }
    });

  const undo = (): Promise<void> =>
    perform(async () => {
      if (!preview) return;
      await window.pi.sessionUndoMemory(composerId, preview.token);
      setOutcome("undone");
    });

  const status = outcome === "saved" ? "记忆已保存" : "已撤销记忆";
  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!pending) setOpen(next);
      }}
      onOpenChangeComplete={(next) => {
        if (next) return;
        onClose(outcome === "saved");
        if (sendOriginal.current) onSendAsMessage?.();
      }}
    >
      <DialogContent
        initialFocus={note}
        finalFocus={finalFocus}
        showCloseButton={false}
        data-memory-dialog
        className="max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)] gap-4 sm:max-w-xl"
      >
        <DialogHeader>
          <DialogTitle>{t("审阅记忆", locale)}</DialogTitle>
          <DialogDescription>
            {t(outcome ? status : "保存后，约定会用于后续对话。", locale)}
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid min-h-0 min-w-0 grid-rows-[minmax(0,1fr)_auto] gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            if (!outcome) void confirm();
          }}
        >
          <div className="grid min-h-0 min-w-0 content-start gap-3 overflow-y-auto overscroll-contain p-1">
            {preview ? (
              <>
                <p className="text-xs wrap-anywhere text-muted-foreground" data-memory-destination>
                  {destination}
                </p>
                {!outcome && (
                  <div
                    ref={diff}
                    role="region"
                    aria-label={diffLabel}
                    tabIndex={0}
                    className="max-h-[min(35dvh,16rem)] min-w-0 overflow-auto overscroll-contain rounded-lg border outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
                  >
                    <DiffLines path={preview.path ?? "memory.md"} diff={preview.diff} />
                  </div>
                )}
              </>
            ) : (
              <>
                <div className="grid gap-1.5">
                  <label className="text-sm font-medium" htmlFor={scopeId}>
                    {t("保存范围", locale)}
                  </label>
                  <Select
                    items={items}
                    value={scope}
                    onValueChange={(value) => {
                      if (value) setScope(value);
                      setError(null);
                    }}
                    disabled={pending}
                  >
                    <SelectTrigger id={scopeId}>
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent alignItemWithTrigger={false}>
                      <SelectGroup>
                        {items.map(({ value, label }) => (
                          <SelectItem key={value} value={value}>
                            {label}
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    </SelectContent>
                  </Select>
                </div>
                <Field.Root className="grid gap-1.5">
                  <Field.Label className="text-sm font-medium">{t("约定内容", locale)}</Field.Label>
                  <Field.Control
                    render={<Textarea ref={note} rows={3} maxLength={MEMORY_TEXT_LIMIT} />}
                    value={text}
                    onChange={(event) => {
                      setText(event.currentTarget.value);
                      setError(null);
                    }}
                    disabled={pending}
                  />
                </Field.Root>
              </>
            )}
            {error && (
              <p role="alert" className="text-xs wrap-anywhere text-destructive">
                {localizeError(error, locale)}
              </p>
            )}
          </div>
          <DialogFooter className="flex-row flex-wrap justify-end gap-2">
            {outcome ? (
              <>
                {outcome === "saved" && (
                  <Button
                    variant="outline"
                    type="button"
                    disabled={pending}
                    onClick={() => void undo()}
                  >
                    {t("撤销保存", locale)}
                  </Button>
                )}
                <DialogClose render={<Button type="button" ref={done} disabled={pending} />}>
                  {t("完成", locale)}
                </DialogClose>
              </>
            ) : (
              <>
                {!preview && onSendAsMessage && (
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={pending}
                    onClick={() => {
                      sendOriginal.current = true;
                      setOpen(false);
                    }}
                  >
                    {t("作为消息发送", locale)}
                  </Button>
                )}
                <DialogClose render={<Button type="button" variant="ghost" disabled={pending} />}>
                  {t("取消", locale)}
                </DialogClose>
                {preview && (
                  <Button
                    type="button"
                    variant="outline"
                    disabled={pending}
                    onClick={() => {
                      setPreview(null);
                      setError(null);
                    }}
                  >
                    {t("返回编辑", locale)}
                  </Button>
                )}
                <Button type="submit" disabled={pending || !text.trim()}>
                  {t(
                    preview
                      ? pending
                        ? "保存中…"
                        : "保存记忆"
                      : pending
                        ? "正在预览…"
                        : "预览差异",
                    locale,
                  )}
                </Button>
              </>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function MemorySuggestion({
  composerId,
  projectDirectory,
  proposal,
}: {
  composerId: string;
  projectDirectory: string | null;
  proposal: MemoryProposal;
}): JSX.Element {
  const locale = useLocale();
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  return (
    <div className="flex min-w-0 flex-wrap items-center justify-between gap-2 rounded-lg border border-border/65 px-3 py-2">
      <p className="line-clamp-2 min-w-0 flex-1 basis-40 text-xs wrap-anywhere text-muted-foreground">
        {proposal.text}
      </p>
      <Button ref={trigger} type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <BookmarkIcon aria-hidden="true" data-icon="inline-start" />
        {t("审阅记忆…", locale)}
      </Button>
      {open && (
        <MemoryDialog
          composerId={composerId}
          projectDirectory={projectDirectory}
          proposal={proposal}
          finalFocus={trigger}
          onClose={() => setOpen(false)}
        />
      )}
    </div>
  );
}
