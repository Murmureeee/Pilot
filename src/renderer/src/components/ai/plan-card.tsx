// @env browser
import { cn } from "cn";
import { CircleCheckIcon, CircleDashedIcon, CircleDotIcon, ListChecksIcon } from "lucide-react";
import type { JSX } from "react";

import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceDescription,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@renderer/components/ui/trace";
import { t, useLocale } from "@renderer/lib/i18n";
import type { PlanStep } from "@shared/contract";

const STATUS = {
  pending: { label: "待处理", Icon: CircleDashedIcon },
  in_progress: { label: "进行中", Icon: CircleDotIcon },
  completed: { label: "已完成", Icon: CircleCheckIcon },
} as const;

function PlanSteps({ steps }: { steps: PlanStep[] }): JSX.Element {
  const locale = useLocale();
  return (
    <ol className="grid gap-2">
      {steps.map((step, index) => {
        const { label, Icon } = STATUS[step.status];
        return (
          <li key={index}>
            <TraceLine
              className={cn(
                "items-start",
                step.status !== "pending" && "text-emerald-600 dark:text-emerald-400",
              )}
            >
              <TraceIcon className="mt-0.5">
                <Icon />
              </TraceIcon>
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="wrap-anywhere">{step.title}</span>
                <span className="text-xs text-muted-foreground">{t(label, locale)}</span>
              </span>
            </TraceLine>
          </li>
        );
      })}
    </ol>
  );
}

function progress(steps: PlanStep[]): [number, number] {
  return [steps.filter((step) => step.status === "completed").length, steps.length];
}

/** 回合结束后留在该回合轨迹里的最终计划。 */
export function PlanCard({ steps }: { steps: PlanStep[] }): JSX.Element {
  const locale = useLocale();
  const [done, total] = progress(steps);
  return (
    <Trace>
      {/* 全部完成的计划和成功的步骤一样收起；还有没做完的步骤才值得直接摆出来。 */}
      <TraceCollapsible defaultOpen={done < total}>
        <TraceCollapsibleTrigger>
          <TraceLine>
            <TraceIcon>
              <ListChecksIcon />
            </TraceIcon>
            <TraceTitle>{t("任务计划", locale)}</TraceTitle>
            <TraceDescription>{t("已完成 {0}/{1}", locale, [done, total])}</TraceDescription>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent>
          <PlanSteps steps={steps} />
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}

/** 运行期间钉在输入坞上方：一行显示当前步骤和进度，展开看全部步骤。 */
export function PlanBar({ steps }: { steps: PlanStep[] }): JSX.Element {
  const locale = useLocale();
  const current =
    steps.find((step) => step.status === "in_progress") ??
    steps.find((step) => step.status === "pending");
  return (
    <Trace
      data-plan-bar
      aria-label={t("任务计划", locale)}
      role="group"
      className="rounded-xl border bg-muted/50 px-3 py-2"
    >
      <TraceCollapsible>
        <TraceCollapsibleTrigger>
          <TraceLine>
            <TraceIcon>
              <ListChecksIcon />
            </TraceIcon>
            <TraceTitle>{current?.title ?? t("任务计划", locale)}</TraceTitle>
            <TraceDescription>{t("已完成 {0}/{1}", locale, progress(steps))}</TraceDescription>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent>
          <PlanSteps steps={steps} />
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}
