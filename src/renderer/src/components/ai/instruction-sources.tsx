// @env browser
import { useState, type JSX } from "react";
import { FileTextIcon } from "lucide-react";
import { Button } from "@renderer/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
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

export function InstructionSources({ composerId }: { composerId: string }): JSX.Element {
  const locale = useLocale();
  const [open, setOpen] = useState(false);
  const [sources, setSources] = useState<SessionInstructionSources | null>(null);
  const [error, setError] = useState<string | null>(null);
  const label = t("指令来源", locale);

  const onOpenChange = (nextOpen: boolean): void => {
    setOpen(nextOpen);
    if (!nextOpen) return;
    setSources(null);
    setError(null);
    void window.pi.sessionInstructionSources(composerId).then(setSources, (cause: unknown) => {
      setError(cause instanceof Error ? cause.message : String(cause));
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTrigger render={<Button variant="ghost" size="sm" aria-label={label} title={label} />}>
        <FileTextIcon data-icon="inline-start" />
        {t("指令", locale)}
      </DialogTrigger>
      <DialogContent
        closeLabel={t("关闭", locale)}
        className="max-h-[calc(100dvh-2rem)] gap-4 overflow-y-auto"
      >
        <DialogHeader className="pr-8">
          <DialogTitle>{label}</DialogTitle>
          <DialogDescription>{t("指令冲突时，列表上方的来源优先。", locale)}</DialogDescription>
        </DialogHeader>
        {error ? (
          <p role="alert" className="text-destructive wrap-anywhere">
            {localizeError(error, locale)}
          </p>
        ) : sources ? (
          <ol className="marker:text-muted-foreground flex list-decimal flex-col gap-3 ps-5">
            <li>{t("应用指令", locale)}</li>
            <li>
              {t("项目指令", locale)}
              <p className="text-muted-foreground text-xs">
                {t(
                  sources.project.status === "loaded" && !sources.running
                    ? "将用于下一次请求"
                    : PROJECT_SOURCE_LABELS[sources.project.status],
                  locale,
                )}
              </p>
              {"path" in sources.project && (
                <p className="text-muted-foreground font-mono text-xs wrap-anywhere">
                  {sources.project.path}
                </p>
              )}
            </li>
            <li>
              {t(sources.personalization === "global" ? "全局个性化" : "会话指令", locale)}
              {sources.personalization === null && (
                <p className="text-muted-foreground text-xs">
                  {t("未设置会话指令或全局个性化。", locale)}
                </p>
              )}
            </li>
            <li>
              {t("技能", locale)}
              {sources.enabledSkills.length > 0 && (
                <p className="text-muted-foreground text-xs wrap-anywhere">
                  {sources.enabledSkills.join(", ")}
                </p>
              )}
              <p className="text-muted-foreground text-xs">{t("包含随消息选择的技能。", locale)}</p>
            </li>
          </ol>
        ) : (
          <output className="text-muted-foreground">{t("加载中…", locale)}</output>
        )}
      </DialogContent>
    </Dialog>
  );
}
