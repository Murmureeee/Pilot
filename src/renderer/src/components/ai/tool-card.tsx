// @env browser
// 工具卡片：Trace 线（状态机）+ 可折叠的参数与输出详情。
import type { JSX } from "react";
import { CircleCheckIcon, CircleXIcon, LoaderCircleIcon, CircleDashedIcon } from "lucide-react";
import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@renderer/components/ui/trace";
import { t } from "@renderer/lib/i18n";
import { useAgentStore } from "@renderer/stores/agent";
import type { UiPart } from "@shared/contract";

type ToolPart = Extract<UiPart, { type: "tool" }>;

function StatusIcon({ state }: { state: ToolPart["state"] }): JSX.Element {
  switch (state) {
    case "running":
      return <LoaderCircleIcon className="size-3.5 animate-spin" />;
    case "success":
      return <CircleCheckIcon className="size-3.5" />;
    case "error":
      return <CircleXIcon className="size-3.5" />;
    default:
      return <CircleDashedIcon className="size-3.5" />;
  }
}

export function ToolCard({ part }: { part: ToolPart }): JSX.Element {
  const locale = useAgentStore((s) => s.locale);
  const line = (
    <TraceLine
      status={part.state === "running" ? "running" : part.state === "error" ? "error" : undefined}
    >
      <TraceIcon>
        <StatusIcon state={part.state} />
      </TraceIcon>
      <TraceTitle>
        {t(part.label, locale)} ·{" "}
        {part.state === "running"
          ? t("运行中…", locale)
          : part.state === "success"
            ? t("完成", locale)
            : part.state === "error"
              ? t("失败", locale)
              : t("排队", locale)}
      </TraceTitle>
    </TraceLine>
  );

  const hasDetails =
    part.inputSummary !== undefined || part.output !== undefined || part.error !== undefined;
  if (!hasDetails) return <Trace>{line}</Trace>;

  return (
    <Trace className="max-w-full">
      <TraceCollapsible defaultOpen={part.state === "error"}>
        <TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
        <TraceCollapsibleContent className="min-w-0">
          {part.inputSummary !== undefined && (
            <div className="mt-1 min-w-0">
              <p className="text-muted-foreground text-xs">{t("参数", locale)}</p>
              <pre className="mt-0.5 max-h-40 max-w-full overflow-auto rounded-md bg-muted px-2 py-1 font-mono text-xs break-all whitespace-pre-wrap">
                {part.inputSummary}
              </pre>
            </div>
          )}
          {(part.output !== undefined || part.error !== undefined) && (
            <div className="mt-1 min-w-0">
              <p className="text-muted-foreground text-xs">
                {t(part.error !== undefined ? "错误输出" : "输出", locale)}
              </p>
              <pre
                className={
                  part.error !== undefined
                    ? "mt-0.5 max-h-60 max-w-full overflow-auto rounded-md bg-destructive/10 px-2 py-1 font-mono text-xs break-all whitespace-pre-wrap text-destructive"
                    : "mt-0.5 max-h-60 max-w-full overflow-auto rounded-md bg-muted px-2 py-1 font-mono text-xs break-all whitespace-pre-wrap"
                }
              >
                {part.error ?? part.output}
              </pre>
            </div>
          )}
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}
