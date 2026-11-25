// @env browser
import { ListTreeIcon, LoaderCircleIcon } from "lucide-react";
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
import { formatDuration } from "@renderer/lib/duration";
import { t, useLocale } from "@renderer/lib/i18n";
import type { ReplyEntry } from "@renderer/lib/types";
import type { UiMessage } from "@shared/contract";

import { FileChangesCard } from "./file-changes-card";
import { PlanCard } from "./plan-card";
import { Response } from "./response";
import { ThinkingBlock } from "./thinking-block";
import { ToolTrace } from "./tool-trace";

export function AssistantReply({
  messages,
  sessionId,
  live,
  busy,
}: {
  messages: UiMessage[];
  sessionId: string | null;
  live: boolean;
  busy: boolean;
}): JSX.Element {
  const locale = useLocale();
  const entries: ReplyEntry[] = messages.flatMap((message) =>
    message.parts.map((part, index) => ({
      key: message.id + "/" + (part.type === "tool" ? part.callId : index),
      part,
      streaming: message.streaming === true && index === message.parts.length - 1,
    })),
  );
  const plan = entries.findLast(({ part }) => part.type === "plan")?.part;
  const changes = entries.flatMap(({ part }) =>
    part.type === "tool" && part.fileChange ? [part.fileChange] : [],
  );
  const content = entries.filter(({ part }) => part.type !== "plan");
  const activityEnd = content.findLastIndex(({ part }) => part.type !== "text") + 1;
  const activity = content.slice(0, activityEnd);
  const answer = content.slice(activityEnd);
  const tools = activity.flatMap(({ part }) => (part.type === "tool" ? [part] : []));
  const failed = tools.filter((tool) => tool.state === "error").length;
  // 给出回答的回合把过程收成一行；没有回答（中断或失败）时过程就是结果，保持展开。
  const summarized =
    !live &&
    tools.length > 0 &&
    answer.some(({ part }) => part.type === "text" && part.text.trim());
  let summary = "";
  if (summarized) {
    const end = messages.at(-1)?.timing;
    // A resumed run can finish the same reply after the user has been away.
    const start = end && messages.find(({ timing }) => timing?.runId === end.runId)?.timing;
    summary =
      start && end?.endedAt !== undefined
        ? t(tools.length === 1 ? "已处理 {0} · 1 步" : "已处理 {0} · {1} 步", locale, [
            formatDuration(Math.max(0, end.endedAt - start.startedAt), locale),
            tools.length,
          ])
        : t("已处理 {0} 步", locale, [tools.length]);
  }
  // 运行期间计划钉在输入坞上方，回合结束后才回到轨迹里。
  const planCard = !live && plan?.type === "plan" && <PlanCard steps={plan.steps} />;
  const steps = activity.map(({ key, part }) => {
    if (part.type === "thinking") return <ThinkingBlock key={key} part={part} />;
    if (part.type === "tool") return <ToolTrace key={key} part={part} />;
    if (part.type !== "text" || !part.text) return null;
    return (
      <div key={key} className="text-[13px] leading-6 text-muted-foreground">
        <Response content={part.text} />
      </div>
    );
  });

  return (
    <>
      {summarized ? (
        <Trace data-reply-activity>
          <TraceCollapsible>
            <TraceCollapsibleTrigger>
              <TraceLine>
                <TraceIcon>
                  <ListTreeIcon />
                </TraceIcon>
                <TraceTitle title={summary}>{summary}</TraceTitle>
                {failed > 0 && (
                  <TraceDescription className="text-destructive">
                    {t("{0} 步失败", locale, [failed])}
                  </TraceDescription>
                )}
              </TraceLine>
            </TraceCollapsibleTrigger>
            <TraceCollapsibleContent>
              <div className="flex min-w-0 flex-col gap-2">
                <Trace>{steps}</Trace>
                {planCard}
              </div>
            </TraceCollapsibleContent>
          </TraceCollapsible>
        </Trace>
      ) : (
        <>
          {activity.length > 0 && <Trace data-reply-activity>{steps}</Trace>}
          {planCard}
        </>
      )}
      {answer.map(
        ({ key, part, streaming }) =>
          part.type === "text" &&
          part.text && (
            <div key={key} className="min-w-0 text-sm leading-6">
              <Response content={part.text} />
              {streaming && (
                <span
                  aria-hidden="true"
                  className="ml-0.5 inline-block h-4 w-1.5 rounded-xs bg-emerald-500 align-text-bottom motion-safe:animate-pulse"
                />
              )}
            </div>
          ),
      )}
      {changes.length > 0 && (
        <FileChangesCard
          changes={changes}
          sessionId={sessionId}
          replyId={messages[0].id}
          busy={busy}
        />
      )}
      {entries.length === 0 && live && (
        <span role="status" className="mt-2 w-fit text-emerald-700 dark:text-emerald-400">
          <LoaderCircleIcon aria-hidden="true" className="size-4 motion-safe:animate-spin" />
          <span className="sr-only">{t("回复中…", locale)}</span>
        </span>
      )}
    </>
  );
}
