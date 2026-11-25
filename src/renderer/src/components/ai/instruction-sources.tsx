// @env browser
import { useEffect, useState, type JSX, type RefObject } from "react";

import { Button } from "@renderer/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@renderer/components/ui/dialog";
import { localizeError, t, useLocale } from "@renderer/lib/i18n";
import type { ProjectInstructionSource, SessionInstructionSources } from "@shared/contract";

const PROJECT_SOURCE_LABELS: Record<ProjectInstructionSource["status"], string> = {
  unlinked: "未关联项目",
  loaded: "已加载",
  missing: "在项目根目录添加 AGENTS.md 或 CLAUDE.md 即可加载。",
  empty: "指令文件为空。可补充项目约定。",
  unavailable: "无法读取指令文件。请检查文件是否在项目内且可访问。",
};

function ProjectSourceRow({
  source,
  directory,
  running,
}: {
  source: ProjectInstructionSource;
  directory?: string;
  running: boolean;
}): JSX.Element {
  const locale = useLocale();
  let label = PROJECT_SOURCE_LABELS[source.status];
  if (source.status === "loaded" && !running)
    label = directory ? "按目标路径加载" : "将用于下一次请求";
  return (
    <li className="grid min-w-0 gap-0.5" data-instruction-scope={directory ?? "."}>
      {source.status !== "unlinked" && (
        <p className="text-xs wrap-anywhere">
          {directory ? t("适用目录 {0}", locale, [directory + "/"]) : t("项目根目录", locale)}
        </p>
      )}
      {"path" in source && source.status !== "missing" && (
        <p className="font-mono text-xs wrap-anywhere text-muted-foreground">{source.path}</p>
      )}
      <p
        className={
          source.status === "unavailable"
            ? "text-xs text-destructive"
            : "text-xs text-muted-foreground"
        }
      >
        {t(label, locale)}
      </p>
    </li>
  );
}

function InstructionSourceList({ composerId }: { composerId: string }): JSX.Element {
  const locale = useLocale();
  const [sources, setSources] = useState<SessionInstructionSources | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    let revision = 0;
    const loadSources = (): void => {
      const request = ++revision;
      void window.pi.sessionInstructionSources(composerId).then(
        (value) => {
          if (!active || request !== revision) return;
          setError(null);
          setSources(value);
        },
        (cause: unknown) => {
          if (active && request === revision)
            setError(cause instanceof Error ? cause.message : String(cause));
        },
      );
    };
    loadSources();
    const unsubscribe = window.pi.onAgentEvent((event) => {
      if (!("run" in event) || event.run.sessionId !== composerId) return;
      if (
        event.type === "run_started" ||
        event.type === "assistant_start" ||
        event.type === "permission_request" ||
        event.type === "tool_end" ||
        (event.type === "status" && event.status === "idle")
      )
        loadSources();
    });
    return () => {
      active = false;
      unsubscribe();
    };
  }, [composerId, attempt]);

  if (error) {
    return (
      <div className="flex flex-col items-start gap-2">
        <p role="alert" className="wrap-anywhere text-destructive">
          {localizeError(error, locale)}
        </p>
        <Button size="sm" variant="outline" onClick={() => setAttempt((value) => value + 1)}>
          {t("重试", locale)}
        </Button>
      </div>
    );
  }
  if (!sources) return <output className="text-muted-foreground">{t("加载中…", locale)}</output>;
  const scopedProject = sources.scopedProject ?? [];
  return (
    <ol className="flex list-decimal flex-col gap-3 ps-5 marker:text-muted-foreground">
      <li>{t("应用指令", locale)}</li>
      <li className="min-w-0">
        {t("项目指令", locale)}
        {scopedProject.length > 0 && (
          <p className="mt-1 text-xs text-muted-foreground">
            {t("同一路径上，越接近目标的目录越优先。", locale)}
          </p>
        )}
        <ol className="mt-2 grid gap-2.5">
          {scopedProject.map(({ directory, source }) => (
            <ProjectSourceRow
              key={directory}
              directory={directory}
              source={source}
              running={sources.running}
            />
          ))}
          <ProjectSourceRow source={sources.project} running={sources.running} />
        </ol>
        {!sources.running && scopedProject.length > 0 && (
          <p className="mt-2 text-xs text-muted-foreground">
            {t("空闲时根据草稿引用或最近任务的目标路径核对。", locale)}
          </p>
        )}
      </li>
      <li>
        {t(sources.personalization === "global" ? "全局个性化" : "会话指令", locale)}
        {sources.personalization === null && (
          <p className="text-xs text-muted-foreground">
            {t("未设置会话指令或全局个性化。", locale)}
          </p>
        )}
      </li>
      <li>
        {t("技能", locale)}
        {sources.enabledSkills.length > 0 && (
          <p className="text-xs wrap-anywhere text-muted-foreground">
            {sources.enabledSkills.join(", ")}
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          {t("按需读取技能，也可在消息中指定。", locale)}
        </p>
      </li>
    </ol>
  );
}

export function InstructionSourcesDialog({
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
          closeLabel={t("关闭", locale)}
          finalFocus={finalFocus}
          className="max-h-[calc(100dvh-2rem)] grid-rows-[auto_minmax(0,1fr)] gap-4"
        >
          <DialogHeader className="pr-8">
            <DialogTitle>{t("指令来源", locale)}</DialogTitle>
            <DialogDescription>{t("指令冲突时，列表上方的来源优先。", locale)}</DialogDescription>
          </DialogHeader>
          <div
            role="region"
            aria-label={t("指令生效顺序", locale)}
            tabIndex={0}
            className="min-h-0 min-w-0 overflow-y-auto overscroll-contain rounded-sm outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset"
          >
            <InstructionSourceList composerId={composerId} />
          </div>
        </DialogContent>
      )}
    </Dialog>
  );
}
