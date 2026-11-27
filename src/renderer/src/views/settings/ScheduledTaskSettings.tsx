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
import { useAgentStore } from "@renderer/stores/agent";
import { LOCALE_DETAILS } from "@shared/constants";
import type { ScheduledTask } from "@shared/scheduled-tasks";

import { FREQUENCY_LABELS, RUN_LABELS, TRIGGER_LABELS } from "./scheduled-task-copy";
import { ScheduledTaskDialog } from "./ScheduledTaskDialog";

export function ScheduledTaskSettings(): JSX.Element {
  const locale = useLocale();
  const loadSession = useAgentStore((state) => state.loadSession);
  const setView = useAgentStore((state) => state.setView);
  const sessions = useAgentStore((state) => state.sessions);
  const [tasks, setTasks] = useState<ScheduledTask[] | null>(null);
  const [editor, setEditor] = useState<ScheduledTask | "new" | null>(null);
  const [removing, setRemoving] = useState<ScheduledTask | null>(null);
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState(false);
  const focus = useRef<HTMLButtonElement>(null);
  const create = useRef<HTMLButtonElement>(null);
  const revision = useRef(0);
  const dateFormat = new Intl.DateTimeFormat(LOCALE_DETAILS[locale].htmlLang, {
    dateStyle: "medium",
    timeStyle: "short",
  });

  useEffect(() => {
    if (pending || editor || removing) return;
    let current = true;
    const refresh = async (): Promise<void> => {
      const request = ++revision.current;
      try {
        const result = await window.pi.scheduledTasksList();
        if (current && revision.current === request) setTasks(result);
      } catch (cause) {
        if (current && revision.current === request)
          setError(cause instanceof Error ? cause.message : String(cause));
      }
    };
    void refresh();
    const timer = window.setInterval(() => void refresh(), 1_500);
    return () => {
      current = false;
      window.clearInterval(timer);
    };
  }, [editor, pending, removing]);

  const perform = async (work: () => Promise<ScheduledTask[]>): Promise<boolean> => {
    revision.current++;
    setPending(true);
    setError(undefined);
    try {
      setTasks(await work());
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      return false;
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="grid min-w-0 gap-4" aria-label={t("定时任务", locale)}>
      <div className="flex">
        <Button
          ref={create}
          disabled={pending || tasks === null}
          onClick={(event) => {
            focus.current = event.currentTarget;
            setEditor("new");
          }}
        >
          {t("创建任务…", locale)}
        </Button>
      </div>
      {error != null && (
        <p role="alert" className="text-sm text-destructive">
          {localizeError(error, locale)}
        </p>
      )}
      {tasks?.length === 0 && (
        <p className="text-sm text-muted-foreground">
          {t("定时任务及其执行记录会显示在这里。", locale)}
        </p>
      )}
      <div className="settings-list">
        {tasks?.map((task) => {
          const running = task.runs.some(({ status }) => status === "running");
          return (
            <article key={task.id} className="grid min-w-0 gap-2 border-b border-border/65 py-4">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0 flex-1 basis-48">
                  <h2 className="text-sm font-medium wrap-anywhere">{task.title}</h2>
                  <p className="text-xs leading-5 wrap-anywhere text-muted-foreground">
                    {task.directory}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {t(FREQUENCY_LABELS[task.frequency], locale)}
                    <br />
                    {task.paused
                      ? t("已暂停", locale)
                      : task.nextAt === null
                        ? t("暂无下次执行时间", locale)
                        : t("下次执行 {0}", locale, [dateFormat.format(task.nextAt)])}
                  </p>
                </div>
                <div className="flex flex-wrap gap-1">
                  <Button
                    size="sm"
                    variant="outline"
                    disabled={pending || running}
                    onClick={() => void perform(() => window.pi.scheduledTasksRun(task.id))}
                  >
                    {t("立即运行", locale)}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={() => {
                      const { id, runs: _runs, nextAt: _nextAt, ...input } = task;
                      void perform(() =>
                        window.pi.scheduledTasksSave({ ...input, paused: !task.paused }, id),
                      );
                    }}
                  >
                    {t(task.paused ? "恢复调度" : "暂停", locale)}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending}
                    onClick={(event) => {
                      focus.current = event.currentTarget;
                      setEditor(task);
                    }}
                  >
                    {t("编辑…", locale)}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={pending || running}
                    onClick={(event) => {
                      focus.current = event.currentTarget;
                      setRemoving(task);
                    }}
                  >
                    {t("删除…", locale)}
                  </Button>
                </div>
              </div>
              {task.runs.length > 0 && (
                <details className="text-sm">
                  <summary className="w-fit cursor-pointer rounded-sm ring-ring focus-visible:ring-2">
                    {t("执行记录", locale)}
                  </summary>
                  <ol className="mt-2 max-h-64 space-y-2 overflow-y-auto pr-1">
                    {task.runs.map((run) => (
                      <li
                        key={run.id}
                        className="flex flex-wrap items-center justify-between gap-1 border-t border-border/65 pt-2"
                      >
                        <div className="min-w-0 flex-1 basis-48">
                          <p
                            className={
                              run.status === "failed"
                                ? "text-destructive"
                                : run.status === "running" || run.status === "success"
                                  ? "text-emerald-700 dark:text-emerald-400"
                                  : "text-muted-foreground"
                            }
                          >
                            {t(RUN_LABELS[run.status], locale)}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {dateFormat.format(run.at)} · {t(TRIGGER_LABELS[run.trigger], locale)}
                          </p>
                          {run.error && (
                            <p className="text-xs wrap-anywhere text-destructive">
                              {localizeError(run.error, locale)}
                            </p>
                          )}
                        </div>
                        {run.sessionId && sessions.some(({ id }) => id === run.sessionId) && (
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => {
                              if (run.sessionId) {
                                setView("chat");
                                void loadSession(run.sessionId, true, true);
                              }
                            }}
                          >
                            {t("打开会话", locale)}
                          </Button>
                        )}
                        {(run.status === "failed" ||
                          run.status === "interrupted" ||
                          run.status === "missed") && (
                          <Button
                            size="sm"
                            variant="ghost"
                            disabled={pending || running}
                            onClick={() =>
                              void perform(() => window.pi.scheduledTasksRun(task.id, run.id))
                            }
                          >
                            {t("重跑", locale)}
                          </Button>
                        )}
                      </li>
                    ))}
                  </ol>
                </details>
              )}
            </article>
          );
        })}
      </div>
      {editor && (
        <ScheduledTaskDialog
          task={editor === "new" ? undefined : editor}
          returnFocus={focus}
          onSave={async (input, id) => {
            setTasks(await window.pi.scheduledTasksSave(input, id));
          }}
          onClose={() => setEditor(null)}
        />
      )}
      {removing && (
        <Dialog
          open
          onOpenChange={(open) => {
            if (!open && !pending) setRemoving(null);
          }}
        >
          <DialogContent finalFocus={focus} closeLabel={t("关闭", locale)}>
            <DialogHeader className="pr-8">
              <DialogTitle>{t("删除定时任务？", locale)}</DialogTitle>
              <DialogDescription>
                {t("将删除「{0}」的调度和执行记录。已生成的会话仍可在侧栏打开。", locale, [
                  removing.title,
                ])}
              </DialogDescription>
            </DialogHeader>
            {error != null && (
              <p role="alert" className="text-sm text-destructive">
                {localizeError(error, locale)}
              </p>
            )}
            <DialogFooter>
              <Button variant="outline" disabled={pending} onClick={() => setRemoving(null)}>
                {t("取消", locale)}
              </Button>
              <Button
                variant="destructive"
                disabled={pending}
                onClick={() =>
                  void perform(() => window.pi.scheduledTasksDelete(removing.id)).then((ok) => {
                    if (ok) {
                      focus.current = create.current;
                      setRemoving(null);
                    }
                  })
                }
              >
                {t("删除", locale)}
              </Button>
            </DialogFooter>
          </DialogContent>
        </Dialog>
      )}
    </section>
  );
}
