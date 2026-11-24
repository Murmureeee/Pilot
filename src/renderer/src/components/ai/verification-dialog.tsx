// @env browser
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type JSX,
  type RefObject,
} from "react";
import { CheckIcon, PlayIcon, RotateCcwIcon, SquareIcon } from "lucide-react";
import { Button } from "@renderer/components/ui/button";
import { CodeBlock, CodeBlockContent } from "@renderer/components/ui/code-block";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@renderer/components/ui/dialog";
import { Input } from "@renderer/components/ui/input";
import { VERIFICATION_LABELS, VERIFICATION_STATUS_LABELS } from "@renderer/lib/constants";
import { localizeError, t, useLocale } from "@renderer/lib/i18n";
import {
  VERIFICATION_KINDS,
  type VerificationKind,
  type VerificationResult,
  type VerificationRun,
  type VerificationState,
} from "@shared/contract";
import { cn } from "cn";

function isRunning(run: VerificationRun): boolean {
  return run.status === "running" || run.status === "stopping";
}

function mergeRuns(current: VerificationRun[], incoming: VerificationRun[]): VerificationRun[] {
  const runs = new Map(current.map((run) => [run.runId, run]));
  for (const run of incoming) {
    if ((runs.get(run.runId)?.revision ?? -1) <= run.revision) runs.set(run.runId, run);
  }
  return [...runs.values()].sort((a, b) => b.startedAt - a.startedAt);
}

function VerificationStatusText({ run }: { run: VerificationRun }): JSX.Element {
  const locale = useLocale();
  return (
    <span
      data-verification-status={run.status}
      className={cn(
        "text-muted-foreground text-xs",
        run.status === "failed" && "text-destructive",
        (run.status === "success" || run.status === "running") &&
          "text-emerald-700 dark:text-emerald-400",
      )}
    >
      {t(VERIFICATION_STATUS_LABELS[run.status], locale)}
    </span>
  );
}

function VerificationOutput({ output }: { output: string }): JSX.Element {
  const locale = useLocale();
  const viewport = useRef<HTMLPreElement>(null);
  const follow = useRef(true);
  useLayoutEffect(() => {
    if (follow.current && viewport.current)
      viewport.current.scrollTop = viewport.current.scrollHeight;
  }, [output]);
  return (
    <CodeBlock size="sm">
      <CodeBlockContent
        ref={viewport}
        wrap
        aria-label={t("输出", locale)}
        className="max-h-[min(30dvh,22rem)] min-h-24 overscroll-contain text-xs"
        data-verification-output
        onScroll={(event) => {
          const node = event.currentTarget;
          follow.current = node.scrollHeight - node.scrollTop - node.clientHeight < 20;
        }}
      >
        {output || t("暂无输出", locale)}
      </CodeBlockContent>
    </CodeBlock>
  );
}

function VerificationDetails({
  result,
  busy,
  pending,
  onStop,
  onRerun,
}: {
  result: VerificationResult;
  busy: boolean;
  pending: boolean;
  onStop(): void;
  onRerun(): void;
}): JSX.Element {
  const locale = useLocale();
  const active = isRunning(result);
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    if (!active) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [active]);
  const duration = active ? Math.max(result.durationMs, now - result.startedAt) : result.durationMs;
  return (
    <div className="grid min-w-0 content-start gap-2.5" data-verification-detail={result.runId}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h3 className="text-sm font-medium">{t(VERIFICATION_LABELS[result.kind], locale)}</h3>
          <VerificationStatusText run={result} />
        </div>
        {active ? (
          <Button
            size="sm"
            variant="outline"
            disabled={pending || result.status === "stopping"}
            onClick={onStop}
          >
            <SquareIcon data-icon="inline-start" />
            {t("停止", locale)}
          </Button>
        ) : (
          <Button size="sm" variant="outline" disabled={pending || busy} onClick={onRerun}>
            <RotateCcwIcon data-icon="inline-start" />
            {t("重跑", locale)}
          </Button>
        )}
      </div>
      <dl className="grid min-w-0 grid-cols-2 gap-x-3 gap-y-2 text-xs">
        <div className="col-span-2 min-w-0">
          <dt className="text-muted-foreground">{t("工作目录", locale)}</dt>
          <dd className="font-mono wrap-anywhere" data-verification-cwd>
            {result.workingDirectory}
          </dd>
        </div>
        <div className="col-span-2 min-w-0">
          <dt className="text-muted-foreground">{t("命令", locale)}</dt>
          <dd className="font-mono break-all whitespace-pre-wrap" data-verification-command>
            {result.command}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t("退出码", locale)}</dt>
          <dd className="tabular-nums" data-verification-exit-code>
            {result.exitCode ?? "—"}
          </dd>
        </div>
        <div>
          <dt className="text-muted-foreground">{t("耗时", locale)}</dt>
          <dd className="tabular-nums" data-verification-duration={duration}>
            {t("{0} 秒", locale, [(duration / 1000).toFixed(2)])}
          </dd>
        </div>
        {result.task.title && (
          <div className="col-span-2 min-w-0">
            <dt className="text-muted-foreground">{t("所属任务", locale)}</dt>
            <dd className="truncate" title={result.task.title}>
              {result.task.title}
            </dd>
          </div>
        )}
      </dl>
      <VerificationOutput key={result.runId} output={result.output} />
      {result.truncated && (
        <p className="text-muted-foreground text-xs">{t("输出较长，已省略前段。", locale)}</p>
      )}
      {result.error && (
        <p role="alert" className="text-destructive text-xs wrap-anywhere">
          {localizeError(result.error, locale)}
        </p>
      )}
      {result.saveError && (
        <p role="alert" className="text-destructive text-xs">
          {t(result.saveError, locale)}
        </p>
      )}
    </div>
  );
}

function VerificationDialogBody({ composerId }: { composerId: string }): JSX.Element {
  const locale = useLocale();
  const [state, setState] = useState<VerificationState>();
  const [runs, setRuns] = useState<VerificationRun[]>([]);
  const [latest, setLatest] = useState<VerificationResult>();
  const [loaded, setLoaded] = useState<VerificationResult>();
  const [selected, setSelected] = useState<string>();
  const [kind, setKind] = useState<VerificationKind>("test");
  const [drafts, setDrafts] = useState<Partial<Record<VerificationKind, string>>>({});
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const command = drafts[kind] ?? state?.commands[kind] ?? "";
  const busy = runs.some(isRunning);
  const selectedId = selected ?? runs.find(isRunning)?.runId ?? runs[0]?.runId;
  const current = loaded?.runId === selectedId ? loaded : undefined;
  const result =
    latest && latest.runId === selectedId && latest.revision >= (current?.revision ?? -1)
      ? latest
      : current;

  const receive = useCallback((next: VerificationResult): void => {
    const { output: _output, truncated: _truncated, ...run } = next;
    setRuns((items) => mergeRuns(items, [run]));
    setLatest((previous) =>
      previous?.runId === next.runId && previous.revision > next.revision ? previous : next,
    );
  }, []);

  useEffect(() => {
    let active = true;
    const unsubscribe = window.pi.onAgentEvent((event) => {
      if (event.type === "verification_updated" && event.result.sessionId === composerId)
        receive(event.result);
    });
    void window.pi.sessionVerification(composerId).then(
      (value) => {
        if (!active) return;
        setState(value);
        setRuns((items) => mergeRuns(items, value.runs));
      },
      (cause: unknown) => {
        if (active) setError(String(cause));
      },
    );
    return () => {
      active = false;
      unsubscribe();
    };
  }, [composerId, receive]);

  useEffect(() => {
    if (!selectedId) return;
    let active = true;
    void window.pi.sessionVerificationRun(composerId, selectedId).then(
      (value) => {
        if (active) setLoaded(value);
      },
      (cause: unknown) => {
        if (active) setError(String(cause));
      },
    );
    return () => {
      active = false;
    };
  }, [composerId, selectedId]);

  const perform = async (action: () => Promise<VerificationResult>): Promise<void> => {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      const next = await action();
      receive(next);
      setSelected(next.runId);
    } catch (cause) {
      setError(String(cause));
    } finally {
      setPending(false);
    }
  };

  return (
    <>
      {state?.workingDirectory && (
        <form
          className="border-border grid gap-2 border-b pb-3"
          onSubmit={(event) => {
            event.preventDefault();
            const workingDirectory = state.workingDirectory;
            if (workingDirectory && command.trim() && !busy) {
              void perform(() =>
                window.pi.sessionStartVerification(composerId, { workingDirectory, kind, command }),
              );
            }
          }}
        >
          <div className="flex flex-wrap gap-1.5" role="group" aria-label={t("验证类型", locale)}>
            {VERIFICATION_KINDS.map((item) => (
              <Button
                key={item}
                type="button"
                size="sm"
                variant={item === kind ? "secondary" : "ghost"}
                aria-pressed={item === kind}
                onClick={() => setKind(item)}
              >
                {t(VERIFICATION_LABELS[item], locale)}
              </Button>
            ))}
          </div>
          <div className="text-muted-foreground flex min-w-0 flex-col gap-0.5 text-xs">
            <span>{t("工作目录", locale)}</span>
            <span className="text-foreground font-mono wrap-anywhere">
              {state.workingDirectory}
            </span>
          </div>
          <div className="flex items-end gap-2">
            <label className="text-muted-foreground flex min-w-0 flex-1 flex-col gap-1 text-xs">
              {t("命令", locale)}
              <Input
                value={command}
                onChange={(event) =>
                  setDrafts((values) => ({ ...values, [kind]: event.target.value }))
                }
                placeholder={t("输入验证命令", locale)}
                maxLength={4096}
                className="font-mono text-sm"
              />
            </label>
            <Button type="submit" size="sm" disabled={busy || pending || !command.trim()}>
              <PlayIcon data-icon="inline-start" />
              {t("运行", locale)}
            </Button>
          </div>
        </form>
      )}
      {state && !state.workingDirectory && (
        <p className="text-muted-foreground text-xs">{t("请先选择工作目录。", locale)}</p>
      )}
      {error && (
        <p role="alert" className="text-destructive text-xs wrap-anywhere">
          {localizeError(error, locale)}
        </p>
      )}
      {!state && !error && (
        <p role="status" className="text-muted-foreground text-xs">
          {t("加载中…", locale)}
        </p>
      )}
      {runs.length > 0 && (
        <div className="grid min-w-0 gap-3 sm:grid-cols-[11rem_minmax(0,1fr)]">
          <ul
            aria-label={t("验证记录", locale)}
            className="max-h-56 min-w-0 overflow-y-auto overscroll-contain sm:max-h-[min(47dvh,28rem)]"
            data-verification-history
          >
            {runs.map((run) => (
              <li key={run.runId}>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  aria-current={run.runId === selectedId ? "true" : undefined}
                  onClick={() => {
                    setError("");
                    setSelected(run.runId);
                  }}
                  className="h-auto w-full min-w-0 items-start justify-start gap-2 px-2 py-1.5 text-left font-normal"
                >
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span>{t(VERIFICATION_LABELS[run.kind], locale)}</span>
                    <VerificationStatusText run={run} />
                    <span className="text-muted-foreground truncate text-xs">
                      {new Date(run.startedAt).toLocaleString(locale === "en" ? "en" : "zh-CN", {
                        dateStyle: "short",
                        timeStyle: "medium",
                      })}
                    </span>
                  </span>
                  {run.runId === selectedId && <CheckIcon aria-hidden="true" className="mt-0.5" />}
                </Button>
              </li>
            ))}
          </ul>
          {result ? (
            <VerificationDetails
              result={result}
              busy={busy}
              pending={pending}
              onStop={() =>
                void perform(() => window.pi.sessionStopVerification(composerId, result.runId))
              }
              onRerun={() =>
                void perform(() => window.pi.sessionRerunVerification(composerId, result.runId))
              }
            />
          ) : (
            !error && (
              <p role="status" className="text-muted-foreground text-xs">
                {t("加载中…", locale)}
              </p>
            )
          )}
        </div>
      )}
    </>
  );
}

export function VerificationDialog({
  composerId,
  open,
  onOpenChange,
  finalFocus,
}: {
  composerId: string;
  open: boolean;
  onOpenChange(open: boolean): void;
  finalFocus: RefObject<HTMLElement | null>;
}): JSX.Element {
  const locale = useLocale();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {open && (
        <DialogContent
          className="max-h-[calc(100dvh-2rem)] min-w-0 gap-3 overflow-y-auto overscroll-contain p-4 sm:max-w-3xl sm:p-5"
          closeLabel={t("关闭验证", locale)}
          finalFocus={finalFocus}
          data-verification-dialog
        >
          <DialogHeader>
            <DialogTitle>{t("验证", locale)}</DialogTitle>
            <DialogDescription className="sr-only">
              {t("运行项目命令并查看会话的验证记录。", locale)}
            </DialogDescription>
          </DialogHeader>
          <VerificationDialogBody composerId={composerId} />
        </DialogContent>
      )}
    </Dialog>
  );
}
