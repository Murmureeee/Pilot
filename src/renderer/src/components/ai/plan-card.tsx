// @env browser
import type { JSX } from "react";
import { CircleCheckIcon, CircleDashedIcon, CircleDotIcon, ListChecksIcon } from "lucide-react";
import { cn } from "cn";
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

export function PlanCard({ steps }: { steps: PlanStep[] }): JSX.Element {
  const locale = useLocale();
  const completed = steps.filter((step) => step.status === "completed").length;
  return (
    <Trace>
      <TraceCollapsible defaultOpen>
        <TraceCollapsibleTrigger>
          <TraceLine>
            <TraceIcon>
              <ListChecksIcon />
            </TraceIcon>
            <TraceTitle>{t("任务计划", locale)}</TraceTitle>
            <TraceDescription>
              {t("已完成 {0}/{1}", locale, [completed, steps.length])}
            </TraceDescription>
          </TraceLine>
        </TraceCollapsibleTrigger>
        <TraceCollapsibleContent>
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
        </TraceCollapsibleContent>
      </TraceCollapsible>
    </Trace>
  );
}
