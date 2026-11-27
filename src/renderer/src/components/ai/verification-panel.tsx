// @env browser
import { cn } from "cn";
import {
  ArrowUpRightIcon,
  CheckIcon,
  ChevronRightIcon,
  PlayIcon,
  RotateCcwIcon,
  SquareIcon,
} from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type JSX } from "react";

import { Button } from "@renderer/components/ui/button";
import { CodeBlock, CodeBlockContent } from "@renderer/components/ui/code-block";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@renderer/components/ui/collapsible";
import { Input } from "@renderer/components/ui/input";
import { VERIFICATION_LABELS, VERIFICATION_STATUS_LABELS } from "@renderer/lib/constants";
import { localizeError, t, useLocale } from "@renderer/lib/i18n";
import {
  selectPlanReview,
  selectProjectDirectory,
  selectWorkingDirectory,
  selectWorkspaceRun,
  useAgentStore,
} from "@renderer/stores/agent";
import { VERIFICATION_COMMAND_LIMIT } from "@shared/constants";
import {
  VERIFICATION_KINDS,
  type VerificationKind,
  type VerificationResult,
  type VerificationRun,
  type VerificationState,
} from "@shared/contract";

import { ProjectConfigDialog, ProjectConfigSource } from "./project-config-details";
import { VerificationSettingsDialog } from "./verification-settings-dialog";

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
        "text-xs text-muted-foreground",
        run.status === "failed" && "text-destructive",
        (run.status === "success" || run.status === "running") &&
          "text-emerald-700 dark:text-emerald-400",
      )}
    >
      {t(VERIFICATION_STATUS_LABELS[run.status], locale)}
    </span>
  );
}

function VerificationOutput({ output, active }: { output: string; active: boolean }): JSX.Element {
  const locale = useLocale();
  const viewport = useRef<HTMLPreElement>(null);
  const follow = useRef(true);
  useLayoutEffect(() => {
    if (active && follow.current && viewport.current)
      viewport.current.scrollTop = viewport.current.scrollHeight;
  }, [active, output]);
  return (
    <CodeBlock size="sm">
      <CodeBlockContent
        ref={viewport}
        wrap
        tabIndex={0}
        aria-label={t("输出", locale)}
        className="max-h-[min(36dvh,22rem)] min-h-24 overscroll-contain text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
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
  visible,
  busy,
  pending,
  canRepair,
  onStop,
  onRerun,
  onRepair,
}: {
  result: VerificationResult;
  visible: boolean;
  busy: boolean;
  pending: boolean;
  canRepair: boolean;
  onStop(): void;
  onRerun(): void;
  onRepair(): void;
}): JSX.Element {
  const locale = useLocale();
  const active = isRunning(result);
  const [now, setNow] = useState(Date.now);
  const [outputOpen, setOutputOpen] = useState<boolean>();
  const showOutput = outputOpen ?? result.status !== "success";
  useEffect(() => {
    if (!active || !visible) return;
    const timer = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(timer);
  }, [active, visible]);
  const duration = active ? Math.max(result.durationMs, now - result.startedAt) : result.durationMs;
  return (
    <div
      className="grid min-w-0 content-start gap-2.5"
      data-verification-detail={result.runId}
      data-verification-trigger={result.trigger}
    >
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
      {result.trigger === "after-turn" && (
        <p className="text-xs text-muted-foreground">{t("回合后验证", locale)}</p>
      )}
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
      <Collapsible open={showOutput} onOpenChange={setOutputOpen}>
        <CollapsibleTrigger render={<Button size="sm" variant="ghost" className="group px-2" />}>
          <ChevronRightIcon data-icon="inline-start" className="group-aria-expanded:rotate-90" />
          {t("输出", locale)}
        </CollapsibleTrigger>
        <CollapsibleContent keepMounted>
          <VerificationOutput output={result.output} active={visible && showOutput} />
          {result.truncated && (
            <p className="mt-1 text-xs text-muted-foreground">
              {t("输出较长，已省略前段。", locale)}
            </p>
          )}
        </CollapsibleContent>
      </Collapsible>
      {result.error && (
        <p role="alert" className="text-xs wrap-anywhere text-destructive">
          {localizeError(result.error, locale)}
        </p>
      )}
      {result.saveError && (
        <p role="alert" className="text-xs text-destructive">
          {t(result.saveError, locale)}
        </p>
      )}
      {result.status === "failed" && (
        <Button
          size="sm"
          variant="outline"
          className="justify-self-start"
          disabled={pending || !canRepair}
          onClick={onRepair}
        >
          <ArrowUpRightIcon data-icon="inline-start" />
          {t("交给 Agent 修复", locale)}
        </Button>
      )}
    </div>
  );
}

export function VerificationPanel({
  composerId,
  visible,
  onRepairStarted,
}: {
  composerId: string;
  visible: boolean;
  onRepairStarted(): void;
}): JSX.Element {
  const locale = useLocale();
  const projectDirectory = useAgentStore(selectProjectDirectory);
  const workingDirectory = useAgentStore(selectWorkingDirectory);
  const shell = useAgentStore((store) => store.settings?.commandShell);
  const canRepair = useAgentStore(
    (store) =>
      store.sessionId === composerId && !selectWorkspaceRun(store) && !selectPlanReview(store),
  );
  const [state, setState] = useState<VerificationState>();
  const [runs, setRuns] = useState<VerificationRun[]>([]);
  const [latest, setLatest] = useState<VerificationResult>();
  const [loaded, setLoaded] = useState<VerificationResult>();
  const [selected, setSelected] = useState<string>();
  const [kind, setKind] = useState<VerificationKind>("test");
  const [drafts, setDrafts] = useState<Partial<Record<VerificationKind, string>>>({});
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const [configuring, setConfiguring] = useState(false);
  const [showProject, setShowProject] = useState(false);
  const configure = useRef<HTMLButtonElement>(null);
  const projectDetails = useRef<HTMLButtonElement>(null);
  const project = state?.project?.directory === projectDirectory ? state?.project : undefined;
  const command = drafts[kind] ?? state?.commands[kind] ?? "";
  const projectRevision =
    drafts[kind] === undefined && project?.commandSources?.includes(kind)
      ? project.configRevision
      : undefined;
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
      if (
        (event.type === "snapshot" && event.snapshot.composerId === composerId) ||
        (event.type === "project_trust_resolved" && event.run.sessionId === composerId)
      )
        setRetry((value) => value + 1);
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
  }, [composerId, projectDirectory, receive, retry, shell, visible, workingDirectory]);

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
  }, [composerId, selectedId, retry]);

  const perform = async (action: () => Promise<VerificationResult | void>): Promise<void> => {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      const next = await action();
      if (next) {
        receive(next);
        setSelected(next.runId);
      }
    } catch (cause) {
      setError(String(cause));
    } finally {
      setPending(false);
    }
  };

  return (
    <div
      data-verification-panel
      className="@container min-h-0 min-w-0 flex-1 overflow-y-auto overscroll-contain"
    >
      <div className="flex min-w-0 flex-col gap-3 p-3">
        {state?.workingDirectory && (
          <form
            className="grid gap-2 border-b border-border pb-3"
            onSubmit={(event) => {
              event.preventDefault();
              const workingDirectory = state.workingDirectory;
              if (workingDirectory && command.trim() && !busy) {
                void perform(() =>
                  window.pi.sessionStartVerification(composerId, {
                    workingDirectory,
                    kind,
                    command,
                    projectRevision,
                  }),
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
            <div className="flex min-w-0 flex-col gap-0.5 text-xs text-muted-foreground">
              <span>{t("工作目录", locale)}</span>
              <span className="font-mono wrap-anywhere text-foreground">
                {state.workingDirectory}
              </span>
            </div>
            <div className="flex items-end gap-2">
              <label className="flex min-w-0 flex-1 flex-col gap-1 text-xs text-muted-foreground">
                {t("命令", locale)}
                <Input
                  value={command}
                  onChange={(event) =>
                    setDrafts((values) => ({ ...values, [kind]: event.target.value }))
                  }
                  placeholder={t("输入验证命令", locale)}
                  maxLength={VERIFICATION_COMMAND_LIMIT}
                  className="font-mono text-sm"
                />
              </label>
              <Button type="submit" size="sm" disabled={busy || pending || !command.trim()}>
                <PlayIcon data-icon="inline-start" />
                {t("运行", locale)}
              </Button>
            </div>
            {projectRevision && <ProjectConfigSource />}
          </form>
        )}
        {project && (
          <div
            className="flex min-w-0 flex-wrap items-center justify-between gap-2 border-b border-border pb-3"
            data-after-turn-verification={project.afterTurn ? "enabled" : "disabled"}
          >
            <div className="grid min-w-0 flex-1 gap-0.5">
              <h3 className="text-sm font-medium">{t("回合后验证", locale)}</h3>
              <p className="text-xs wrap-anywhere text-muted-foreground">
                {project.afterTurn?.command ?? t("已停用", locale)}
              </p>
              {project.afterTurnSource === "project" && <ProjectConfigSource />}
            </div>
            <div className="flex flex-wrap gap-1.5">
              <Button
                ref={configure}
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setConfiguring(true)}
              >
                {t("配置回合后验证…", locale)}
              </Button>
              <Button
                ref={projectDetails}
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setShowProject(true)}
              >
                {t("项目配置…", locale)}
              </Button>
            </div>
            <ProjectConfigDialog
              composerId={composerId}
              open={showProject}
              onOpenChange={setShowProject}
              finalFocus={projectDetails}
            />
            {configuring && (
              <VerificationSettingsDialog
                key={project.directory}
                composerId={composerId}
                project={project}
                commands={state?.workingDirectory === project.directory ? state.commands : {}}
                defaultKind={kind}
                finalFocus={configure}
                onClose={() => setConfiguring(false)}
                onSaved={() => setRetry((value) => value + 1)}
              />
            )}
          </div>
        )}
        {state && !state.workingDirectory && (
          <p className="text-xs text-muted-foreground">{t("请先选择工作目录。", locale)}</p>
        )}
        {error && (
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p role="alert" className="min-w-0 text-xs wrap-anywhere text-destructive">
              {localizeError(error, locale)}
            </p>
            <Button
              variant="outline"
              size="xs"
              onClick={() => {
                setError("");
                setRetry((value) => value + 1);
              }}
            >
              {t("刷新验证记录", locale)}
            </Button>
          </div>
        )}
        {!state && !error && (
          <p role="status" className="text-xs text-muted-foreground">
            {t("加载中…", locale)}
          </p>
        )}
        {state && runs.length === 0 && (
          <p className="text-xs text-muted-foreground">
            {t("运行验证后，结果会显示在这里。", locale)}
          </p>
        )}
        {runs.length > 0 && (
          <div className="grid min-w-0 gap-3 @xl:grid-cols-[10rem_minmax(0,1fr)]">
            <ul
              aria-label={t("验证记录", locale)}
              className="max-h-36 min-w-0 overflow-y-auto overscroll-contain rounded-lg border border-border/65 @xl:max-h-[min(47dvh,28rem)]"
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
                      <span className="truncate text-xs text-muted-foreground">
                        {new Date(run.startedAt).toLocaleString(locale === "en" ? "en" : "zh-CN", {
                          dateStyle: "short",
                          timeStyle: "medium",
                        })}
                      </span>
                    </span>
                    {run.runId === selectedId && (
                      <CheckIcon aria-hidden="true" className="mt-0.5" />
                    )}
                  </Button>
                </li>
              ))}
            </ul>
            {result ? (
              <VerificationDetails
                key={result.runId}
                result={result}
                visible={visible}
                busy={busy}
                pending={pending}
                canRepair={canRepair}
                onStop={() =>
                  void perform(() => window.pi.sessionStopVerification(composerId, result.runId))
                }
                onRerun={() =>
                  void perform(() => window.pi.sessionRerunVerification(composerId, result.runId))
                }
                onRepair={() =>
                  void perform(async () => {
                    await window.pi.sessionRepairVerification(composerId, result.runId, locale);
                    onRepairStarted();
                  })
                }
              />
            ) : (
              !error && (
                <p role="status" className="text-xs text-muted-foreground">
                  {t("加载中…", locale)}
                </p>
              )
            )}
          </div>
        )}
      </div>
    </div>
  );
}
