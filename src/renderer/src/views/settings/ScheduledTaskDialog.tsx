// @env browser
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
import { LOCALE_DETAILS } from "@shared/constants";
import {
  nextScheduledTime,
  SCHEDULE_FREQUENCIES,
  type ScheduledTask,
  type ScheduledTaskInput,
} from "@shared/scheduled-tasks";

import { FREQUENCY_LABELS } from "./scheduled-task-copy";

type Props = {
  task?: ScheduledTask;
  returnFocus: RefObject<HTMLButtonElement | null>;
  onSave(input: ScheduledTaskInput, id?: string): Promise<void>;
  onClose(): void;
};

function defaultTask(): ScheduledTaskInput {
  const hour = new Date(Date.now() + 3_600_000);
  const start = new Date(hour.getTime() - hour.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 16);
  return {
    title: "",
    prompt: "",
    directory: "",
    frequency: "once",
    start,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    paused: false,
  };
}

function taskInput(task: ScheduledTask): ScheduledTaskInput {
  const { id: _id, nextAt: _nextAt, runs: _runs, ...input } = task;
  return input;
}

export function ScheduledTaskDialog({ task, returnFocus, onSave, onClose }: Props): JSX.Element {
  const locale = useLocale();
  const [draft, setDraft] = useState(() => (task ? taskInput(task) : defaultTask()));
  const [busy, setBusy] = useState(false);
  const [previewFrom] = useState(() => Date.now());
  const [error, setError] = useState<string | null>(null);
  let next: number | null = null;
  try {
    next = nextScheduledTime(draft, previewFrom);
  } catch {
    // An incomplete date or time zone has no preview.
  }
  const dateFormat = new Intl.DateTimeFormat(LOCALE_DETAILS[locale].htmlLang, {
    dateStyle: "medium",
    timeStyle: "short",
  });

  const pickDirectory = async (): Promise<void> => {
    setError(null);
    setBusy(true);
    try {
      const directory = await window.pi.pickWorkingDirectory(locale);
      if (directory) setDraft((value) => ({ ...value, directory }));
    } catch (cause) {
      setError(localizeError(cause instanceof Error ? cause.message : String(cause), locale));
    } finally {
      setBusy(false);
    }
  };
  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await onSave(draft, task?.id);
      onClose();
    } catch (cause) {
      setError(localizeError(cause instanceof Error ? cause.message : String(cause), locale));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent
        finalFocus={returnFocus}
        closeLabel={t("关闭", locale)}
        className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg"
      >
        <DialogHeader className="pr-8">
          <DialogTitle>{t(task ? "编辑定时任务" : "创建定时任务", locale)}</DialogTitle>
          <DialogDescription>
            {t("每次执行使用独立的只读会话和运行时的默认模型。", locale)}
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4"
          onSubmit={(event) => {
            event.preventDefault();
            void save();
          }}
        >
          <label className="grid gap-1.5">
            {t("任务名称", locale)}
            <Input
              value={draft.title}
              required
              maxLength={120}
              onChange={(event) => setDraft({ ...draft, title: event.target.value })}
            />
          </label>
          <label className="grid gap-1.5">
            {t("任务提示词", locale)}
            <Textarea
              value={draft.prompt}
              required
              maxLength={20_000}
              rows={3}
              onChange={(event) => setDraft({ ...draft, prompt: event.target.value })}
            />
          </label>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0">
              <div>{t("工作目录", locale)}</div>
              <div className="text-xs wrap-anywhere text-muted-foreground">
                {draft.directory || t("未选择项目", locale)}
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={() => void pickDirectory()}
            >
              {t("选择目录…", locale)}
            </Button>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="grid min-w-0 gap-1.5">
              <div id="scheduled-task-frequency">{t("重复频率", locale)}</div>
              <Select
                value={draft.frequency}
                onValueChange={(frequency) => {
                  if (frequency) setDraft({ ...draft, frequency });
                }}
              >
                <SelectTrigger aria-labelledby="scheduled-task-frequency">
                  <SelectValue>{t(FREQUENCY_LABELS[draft.frequency], locale)}</SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {SCHEDULE_FREQUENCIES.map((frequency) => (
                      <SelectItem key={frequency} value={frequency}>
                        {t(FREQUENCY_LABELS[frequency], locale)}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
            </div>
            <label className="grid min-w-0 gap-1.5">
              {t("开始时间", locale)}
              <Input
                type="datetime-local"
                value={draft.start}
                required
                onChange={(event) => setDraft({ ...draft, start: event.target.value })}
              />
            </label>
          </div>
          <label className="grid gap-1.5">
            {t("时区", locale)}
            <Input
              value={draft.timeZone}
              required
              maxLength={100}
              onChange={(event) => setDraft({ ...draft, timeZone: event.target.value })}
            />
          </label>
          <p className="text-xs text-muted-foreground" aria-live="polite">
            {next === null
              ? t("暂无下次执行时间", locale)
              : t("下次执行 {0}", locale, [dateFormat.format(next)])}
          </p>
          {error && (
            <p className="text-sm text-destructive" role="alert">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={busy} onClick={onClose}>
              {t("取消", locale)}
            </Button>
            <Button type="submit" disabled={busy || !draft.directory}>
              {t("保存", locale)}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
