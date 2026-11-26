// @env browser
import { CheckIcon, MessageSquarePlusIcon, PlusIcon } from "lucide-react";
import { useId, useMemo, useRef, useState, type JSX } from "react";

import { Button } from "@renderer/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@renderer/components/ui/dialog";
import { Textarea } from "@renderer/components/ui/textarea";
import { GIT_CHANGE_AREA_LABELS } from "@renderer/lib/constants";
import { gitAnnotationDraft, makeGitAnnotation } from "@renderer/lib/git-annotations";
import { t, useLocale } from "@renderer/lib/i18n";
import type { AppendGitAnnotations, GitAnnotation, GitAnnotationSource } from "@renderer/lib/types";
import { gitAnnotations, useGitAnnotationStore } from "@renderer/stores/git-annotations";
import { diffLineLabel } from "@shared/mentions";

import { DiffLines } from "./file-diff-preview";

function GitAnnotationLocation({
  reference: { id, meta },
}: {
  reference: GitAnnotation["reference"];
}): JSX.Element {
  const locale = useLocale();
  const diff = meta.diff;
  return (
    <div className="min-w-0">
      <p dir="auto" className="font-mono text-sm wrap-anywhere">
        {id}
      </p>
      {diff && (
        <div className="text-xs wrap-anywhere text-muted-foreground">
          <p>{t(GIT_CHANGE_AREA_LABELS[diff.area], locale)}</p>
          {diff.previousPath && <p>{t("原路径 {0}", locale, [diff.previousPath])}</p>}
          {diff.before && <p>{t("旧版第 {0} 行", locale, [diffLineLabel(diff.before)])}</p>}
          {diff.after && <p>{t("新版第 {0} 行", locale, [diffLineLabel(diff.after)])}</p>}
        </div>
      )}
    </div>
  );
}

export function GitAnnotationEditor({
  source,
  onSave,
  onClose,
}: {
  source: GitAnnotationSource;
  onSave(annotation: GitAnnotation): void;
  onClose(): void;
}): JSX.Element {
  const locale = useLocale();
  const rows = source.diff.hunks[0];
  const fieldId = useId();
  const descriptionId = useId();
  const rowsByIndex = useRef(new Map<number, HTMLButtonElement>());
  const [open, setOpen] = useState(true);
  const [message, setMessage] = useState("");
  const [anchor, setAnchor] = useState(() =>
    Math.max(
      0,
      rows.findIndex(({ kind }) => kind !== "context"),
    ),
  );
  const [endpoint, setEndpoint] = useState(anchor);
  const annotation = useMemo(
    () => makeGitAnnotation(source, anchor, endpoint),
    [source, anchor, endpoint],
  );
  const select = (index: number, extend: boolean): void => {
    if (!extend) setAnchor(index);
    setEndpoint(index);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      onOpenChangeComplete={(next) => {
        if (!next) onClose();
      }}
    >
      <DialogContent
        showCloseButton={false}
        initialFocus={() => rowsByIndex.current.get(endpoint)}
        finalFocus={() =>
          source.trigger.isConnected
            ? source.trigger
            : document.querySelector<HTMLElement>(
                '[data-review-layout] [role="tab"][aria-selected="true"]',
              )
        }
        className="max-h-[calc(100dvh-2rem)] min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-3 sm:max-w-xl"
      >
        <DialogHeader>
          <DialogTitle>{t("添加差异批注", locale)}</DialogTitle>
          <DialogDescription id={descriptionId}>
            {t("选择一行，按住 Shift 扩展选区。键盘可用方向键上下移动。", locale)}
          </DialogDescription>
        </DialogHeader>
        <form
          className="flex min-h-0 min-w-0 flex-col gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!message.trim()) return;
            onSave({ ...annotation, message: message.trim() });
            setOpen(false);
          }}
        >
          <div className="flex min-h-0 min-w-0 flex-col gap-3 overflow-y-auto overscroll-contain p-1">
            <div role="status" className="shrink-0">
              <GitAnnotationLocation reference={annotation.reference} />
            </div>
            <div className="max-h-[28vh] min-h-16 shrink-0 overflow-auto rounded-lg border">
              <DiffLines
                diff={source.diff}
                path={source.paths.path}
                lineAction={(line, index) => {
                  const selected =
                    Math.min(anchor, endpoint) <= index && index <= Math.max(anchor, endpoint);
                  const label = t(
                    line.after === undefined ? "选择旧版第 {0} 行" : "选择新版第 {0} 行",
                    locale,
                    [line.after ?? line.before ?? 0],
                  );
                  return (
                    <Button
                      ref={(button) => {
                        if (button) rowsByIndex.current.set(index, button);
                        else rowsByIndex.current.delete(index);
                      }}
                      variant="ghost"
                      size="icon-xs"
                      type="button"
                      tabIndex={index === endpoint ? 0 : -1}
                      title={label}
                      aria-label={label}
                      aria-describedby={index === endpoint ? descriptionId : undefined}
                      aria-pressed={selected}
                      data-git-annotation-row={index}
                      onClick={(event) => select(index, event.shiftKey)}
                      onKeyDown={(event) => {
                        if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
                        event.preventDefault();
                        const step = event.key === "ArrowDown" ? 1 : -1;
                        const next = Math.max(0, Math.min(rows.length - 1, index + step));
                        select(next, event.shiftKey);
                        rowsByIndex.current.get(next)?.focus();
                      }}
                    >
                      {selected ? (
                        <CheckIcon aria-hidden="true" />
                      ) : (
                        <PlusIcon aria-hidden="true" />
                      )}
                    </Button>
                  );
                }}
              />
            </div>
            <div className="flex shrink-0 flex-col gap-1.5">
              <label htmlFor={fieldId} className="font-medium">
                {t("批注内容", locale)}
              </label>
              <Textarea
                id={fieldId}
                rows={3}
                value={message}
                onChange={(event) => setMessage(event.currentTarget.value)}
              />
            </div>
          </div>
          <DialogFooter className="shrink-0">
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {t("取消", locale)}
            </Button>
            <Button type="submit" disabled={!message.trim()}>
              {t("保存批注", locale)}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

export function GitAnnotationQueue({
  scope,
  onAppend,
}: {
  scope: string;
  onAppend?: AppendGitAnnotations;
}): JSX.Element {
  const locale = useLocale();
  const notes = useGitAnnotationStore((state) => gitAnnotations(scope, state.drafts));
  const { save, remove } = useGitAnnotationStore.getState();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<GitAnnotation>();
  const trigger = useRef<HTMLButtonElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const editTrigger = useRef<HTMLButtonElement>(null);
  const transfer = useRef<(() => void) | undefined>(undefined);

  const queueDraft = (): void => {
    if (!notes.length || !onAppend || editing || transfer.current) return;
    const draft = gitAnnotationDraft(notes, t("请处理以下差异批注。", locale));
    const ids = notes.map(({ id }) => id);
    transfer.current = () => onAppend(draft, () => remove(scope, ids));
    setOpen(false);
  };

  const finishEdit = (): void => {
    setEditing(undefined);
    requestAnimationFrame(() => editTrigger.current?.focus({ preventScroll: true }));
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        setEditing(undefined);
        setOpen(next);
      }}
      onOpenChangeComplete={(next) => {
        if (!next) {
          const apply = transfer.current;
          transfer.current = undefined;
          apply?.();
        }
      }}
    >
      {notes.length > 0 && (
        <div className="flex shrink-0 flex-wrap gap-2 border-b border-border/65 px-3 py-2">
          <DialogTrigger render={<Button ref={trigger} size="xs" variant="outline" />}>
            <MessageSquarePlusIcon data-icon="inline-start" aria-hidden="true" />
            {t("查看批注（{0}）…", locale, [notes.length])}
          </DialogTrigger>
        </div>
      )}
      <DialogContent
        showCloseButton={false}
        initialFocus={close}
        finalFocus={() =>
          transfer.current
            ? false
            : (trigger.current ??
              document.querySelector<HTMLElement>(
                '[data-review-layout] [role="tab"][aria-selected="true"]',
              ))
        }
        className="max-h-[calc(100dvh-2rem)] min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] gap-3 sm:max-w-lg"
      >
        <DialogHeader>
          <DialogTitle>{t("差异批注", locale)}</DialogTitle>
          <DialogDescription>
            {t("将批注合并到当前消息草稿，再从输入框发送。", locale)}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 overflow-y-auto overscroll-contain p-1">
          {notes.length > 0 ? (
            <ol className="divide-y rounded-lg border">
              {notes.map((note, index) => (
                <li key={note.id} data-git-annotation className="flex min-w-0 flex-col gap-2 p-3">
                  <GitAnnotationLocation reference={note.reference} />
                  {editing?.id === note.id ? (
                    <>
                      <Textarea
                        ref={(element) => element?.focus({ preventScroll: true })}
                        aria-label={t("批注内容", locale)}
                        rows={3}
                        value={editing.message}
                        onChange={(event) =>
                          setEditing({ ...editing, message: event.currentTarget.value })
                        }
                      />
                      <div className="flex flex-wrap gap-2">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={!editing.message.trim()}
                          onClick={() => {
                            save(scope, { ...editing, message: editing.message.trim() });
                            finishEdit();
                          }}
                        >
                          {t("保存批注", locale)}
                        </Button>
                        <Button size="sm" variant="ghost" onClick={finishEdit}>
                          {t("取消", locale)}
                        </Button>
                      </div>
                    </>
                  ) : (
                    <p dir="auto" className="wrap-anywhere whitespace-pre-wrap">
                      {note.message}
                    </p>
                  )}
                  <div className={editing?.id === note.id ? "hidden" : "flex flex-wrap gap-1"}>
                    <Button
                      size="xs"
                      variant="ghost"
                      aria-label={t("编辑第 {0} 条批注", locale, [index + 1])}
                      onClick={(event) => {
                        editTrigger.current = event.currentTarget;
                        setEditing(note);
                      }}
                    >
                      {t("编辑", locale)}
                    </Button>
                    <Button
                      size="xs"
                      variant="ghost"
                      aria-label={t("移除第 {0} 条批注", locale, [index + 1])}
                      onClick={() => {
                        remove(scope, [note.id]);
                        close.current?.focus({ preventScroll: true });
                      }}
                    >
                      {t("移除", locale)}
                    </Button>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <p role="status" className="text-xs text-muted-foreground">
              {t("暂无批注", locale)}
            </p>
          )}
          {!onAppend && notes.length > 0 && (
            <p className="mt-2 text-xs text-muted-foreground">
              {t("处理当前审批或计划后可加入草稿。", locale)}
            </p>
          )}
        </div>
        <DialogFooter>
          <Button
            ref={close}
            variant="outline"
            onClick={() => {
              setEditing(undefined);
              setOpen(false);
            }}
          >
            {t("关闭", locale)}
          </Button>
          <Button disabled={!notes.length || !onAppend || Boolean(editing)} onClick={queueDraft}>
            {t("加入消息草稿", locale)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
