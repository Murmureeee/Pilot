// @env browser
import { ListTreeIcon, LoaderCircleIcon } from "lucide-react";
import { useState, type JSX } from "react";

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
import type { TranscriptLocation, UiMessage } from "@shared/contract";
import { transcriptPartKey } from "@shared/transcript-search";

import { FileChangesCard } from "./file-changes-card";
import { MemorySuggestion } from "./memory-dialog";
import { MessageActions } from "./message-actions";
import { PlanCard } from "./plan-card";
import { Response } from "./response";
import { ThinkingBlock } from "./thinking-block";
import { ToolTrace } from "./tool-trace";

export function AssistantReply({
  messages,
  sessionId,
  composerId,
  projectDirectory,
  live,
  busy,
  hasActiveRun,
  hasLaterMessages,
  findLocation,
}: {
  messages: UiMessage[];
  sessionId: string | null;
  composerId: string | null;
  projectDirectory: string | null;
  live: boolean;
  busy: boolean;
  hasActiveRun: boolean;
  hasLaterMessages: boolean;
  findLocation?: TranscriptLocation;
}): JSX.Element {
  const locale = useLocale();
  const [activityOpen, setActivityOpen] = useState(false);
  const target = findLocation && transcriptPartKey(findLocation.messageId, findLocation.partIndex);
  const entries: ReplyEntry[] = messages.flatMap((message) =>
    message.parts.map((part, index) => ({
      key: message.id + "/" + (part.type === "tool" ? part.callId : index),
      location: transcriptPartKey(message.id, index),
      part,
      streaming: message.streaming === true && index === message.parts.length - 1,
    })),
  );
  const plans = entries.filter(({ part }) => part.type === "plan");
  const plan = plans.find(({ location }) => location === target) ?? plans.at(-1);
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
  const planCard = plan?.part.type === "plan" && (!live || plan.location === target) && (
    <div data-transcript-part={plan.location}>
      <PlanCard steps={plan.part.steps} reveal={plan.location === target} />
    </div>
  );
  const matchedActivity =
    activity.some(({ location }) => location === target) ||
    (plan !== undefined && plan.location === target);
  const steps = activity.map(({ key, location, part }) => {
    if (part.type === "thinking" || part.type === "tool")
      return (
        <div key={key} data-transcript-part={location}>
          {part.type === "thinking" ? (
            <ThinkingBlock part={part} reveal={location === target} />
          ) : (
            <ToolTrace
              part={part}
              searchField={location === target ? findLocation?.field : undefined}
            />
          )}
        </div>
      );
    if (part.type !== "text" || !part.text) return null;
    return (
      <div
        key={key}
        data-transcript-part={location}
        className="text-[13px] leading-6 text-muted-foreground"
      >
        <Response content={part.text} />
      </div>
    );
  });

  return (
    <>
      {summarized ? (
        <Trace data-reply-activity>
          <TraceCollapsible open={activityOpen || matchedActivity} onOpenChange={setActivityOpen}>
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
        ({ key, location, part, streaming }) =>
          part.type === "text" &&
          part.text && (
            <div key={key} data-transcript-part={location} className="min-w-0 text-sm leading-6">
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
      {composerId &&
        tools.map(
          ({ callId, memory }) =>
            memory && (
              <MemorySuggestion
                key={callId}
                composerId={composerId}
                projectDirectory={projectDirectory}
                proposal={memory}
              />
            ),
        )}
      {!live && composerId && (
        <MessageActions
          composerId={composerId}
          messageId={messages.at(-1)!.id}
          kind="assistant"
          busy={hasActiveRun}
          hasLaterMessages={hasLaterMessages}
          text={answer
            .flatMap(({ part }) => (part.type === "text" && part.text ? [part.text] : []))
            .join("\n\n")}
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
