// @env browser
import { useEffect, useState, type JSX, type RefObject } from "react";

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
  missing: "项目根目录没有 AGENTS.md。",
  empty: "AGENTS.md 没有内容。",
  unavailable: "无法读取 AGENTS.md。",
};

function InstructionSourceList({ composerId }: { composerId: string }): JSX.Element {
  const locale = useLocale();
  const [sources, setSources] = useState<SessionInstructionSources | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void window.pi.sessionInstructionSources(composerId).then(
      (value) => {
        if (active) setSources(value);
      },
      (cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : String(cause));
      },
    );
    return () => {
      active = false;
    };
  }, [composerId]);

  if (error) {
    return (
      <p role="alert" className="wrap-anywhere text-destructive">
        {localizeError(error, locale)}
      </p>
    );
  }
  if (!sources) return <output className="text-muted-foreground">{t("加载中…", locale)}</output>;
  return (
    <ol className="flex list-decimal flex-col gap-3 ps-5 marker:text-muted-foreground">
      <li>{t("应用指令", locale)}</li>
      <li>
        {t("项目指令", locale)}
        <p className="text-xs text-muted-foreground">
          {t(
            sources.project.status === "loaded" && !sources.running
              ? "将用于下一次请求"
              : PROJECT_SOURCE_LABELS[sources.project.status],
            locale,
          )}
        </p>
        {"path" in sources.project && (
          <p className="font-mono text-xs wrap-anywhere text-muted-foreground">
            {sources.project.path}
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
          className="max-h-[calc(100dvh-2rem)] gap-4 overflow-y-auto"
        >
          <DialogHeader className="pr-8">
            <DialogTitle>{t("指令来源", locale)}</DialogTitle>
            <DialogDescription>{t("指令冲突时，列表上方的来源优先。", locale)}</DialogDescription>
          </DialogHeader>
          <InstructionSourceList composerId={composerId} />
        </DialogContent>
      )}
    </Dialog>
  );
}
