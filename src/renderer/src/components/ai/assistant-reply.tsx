// @env browser
import { GlobeIcon } from "lucide-react";
import type { JSX } from "react";

import {
  Trace,
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@renderer/components/ui/trace";
import { formatDuration } from "@renderer/lib/duration";
import { t, useLocale } from "@renderer/lib/i18n";
import { replyInProgress, replySegments, stepCounts } from "@renderer/lib/reply-segments";
import type { ReplyEntry } from "@renderer/lib/types";
import { TURN_HOOK_TRACE_TOOL } from "@shared/constants";
import type { TranscriptLocation, UiMessage, WebSource } from "@shared/contract";
import { transcriptPartKey } from "@shared/transcript-search";

import { FileChangesCard } from "./file-changes-card";
import { MemorySuggestion } from "./memory-dialog";
import { MessageActions } from "./message-actions";
import { PlanCard } from "./plan-card";
import { Response } from "./response";
import { StepGroup } from "./step-group";
import { ThinkingBlock } from "./thinking-block";
import { ToolTrace } from "./tool-trace";
import { WebSourceLinks } from "./web-source-links";
import { WorkingLine } from "./working-line";

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
  const target = findLocation && transcriptPartKey(findLocation.messageId, findLocation.partIndex);
  const replyId = messages[0].id;
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
  const tools = entries.flatMap(({ part }) => (part.type === "tool" ? [part] : []));
  const changes = tools.flatMap(({ fileChange }) => (fileChange ? [fileChange] : []));
  const turnHooks = entries.filter(
    ({ part }) => part.type === "tool" && part.toolName === TURN_HOOK_TRACE_TOOL,
  );
  const segments = replySegments(entries);
  // 最后一组步骤之后的正文是这个回合的回答，复制和来源汇总都以它为准。
  const answer = segments
    .slice(segments.findLastIndex(({ kind }) => kind === "steps") + 1)
    .flatMap((segment) =>
      segment.kind === "text" && segment.entry.part.type === "text"
        ? [segment.entry.part.text]
        : [],
    );
  const finished = !live && tools.length > 0;
  const sources = new Map<string, WebSource>();
  if (finished && answer.length > 0) {
    for (const tool of tools)
      for (const source of tool.sources ?? [])
        if (!sources.has(source.url) || source.section) sources.set(source.url, source);
  }
  const end = messages.at(-1)?.timing;
  // A resumed run can finish the same reply after the user has been away.
  const start = end && messages.find(({ timing }) => timing?.runId === end.runId)?.timing;
  let summary = "";
  if (finished) {
    summary =
      start && end?.endedAt !== undefined
        ? t(tools.length === 1 ? "已处理 {0} · 1 步" : "已处理 {0} · {1} 步", locale, [
            formatDuration(Math.max(0, end.endedAt - start.startedAt), locale),
            tools.length,
          ])
        : t("已处理 {0} 步", locale, [tools.length]);
  }
  const step = ({ key, location, part }: ReplyEntry): JSX.Element | null =>
    part.type === "thinking" || part.type === "tool" ? (
      <div key={key} data-transcript-part={location}>
        {part.type === "thinking" ? (
          <ThinkingBlock part={part} reveal={location === target} />
        ) : (
          <ToolTrace
            part={part}
            replyId={replyId}
            searchField={location === target ? findLocation?.field : undefined}
          />
        )}
      </div>
    ) : null;

  return (
    <>
      {segments.map((segment, index) => {
        if (segment.kind === "text") {
          const { key, location, part, streaming } = segment.entry;
          if (part.type !== "text") return null;
          return (
            <div key={key} data-transcript-part={location} className="min-w-0 text-sm leading-6">
              <Response content={part.text} />
              {streaming && (
                <span
                  aria-hidden="true"
                  className="ml-0.5 inline-block h-4 w-1.5 rounded-xs bg-foreground align-text-bottom motion-safe:animate-pulse"
                />
              )}
            </div>
          );
        }
        const parts = segment.entries.map(({ part }) => part);
        const calls = parts.flatMap((part) => (part.type === "tool" ? [part] : []));
        const steps = segment.entries.map(step);
        return (
          <Trace key={segment.entries[0].key} data-reply-activity>
            {/* 单个步骤一行就能说清，两个以上才值得收成一组。 */}
            {calls.length > 1 ? (
              <StepGroup
                counts={stepCounts(parts)}
                failed={calls.filter((call) => call.state === "error").length}
                // 后面还没有正文时，这组步骤就是当前进度或最终结果，保持展开。
                autoOpen={index === segments.length - 1}
                reveal={segment.entries.some(({ location }) => location === target)}
              >
                {steps}
              </StepGroup>
            ) : (
              steps
            )}
          </Trace>
        );
      })}
      {turnHooks.length > 0 && <Trace data-reply-turn-hooks>{turnHooks.map(step)}</Trace>}
      {/* 运行期间计划钉在输入坞上方，回合结束后才回到轨迹里。 */}
      {plan?.part.type === "plan" && (!live || plan.location === target) && (
        <div data-transcript-part={plan.location}>
          <PlanCard steps={plan.part.steps} reveal={plan.location === target} />
        </div>
      )}
      {sources.size > 0 && (
        <Trace data-reply-sources>
          <TraceCollapsible>
            <TraceCollapsibleTrigger>
              <TraceLine>
                <TraceIcon>
                  <GlobeIcon />
                </TraceIcon>
                <TraceTitle>{t("网页来源（{0}）", locale, [sources.size])}</TraceTitle>
              </TraceLine>
            </TraceCollapsibleTrigger>
            <TraceCollapsibleContent>
              <WebSourceLinks sources={[...sources.values()]} />
            </TraceCollapsibleContent>
          </TraceCollapsible>
        </Trace>
      )}
      {changes.length > 0 && (
        <FileChangesCard changes={changes} sessionId={sessionId} replyId={replyId} busy={busy} />
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
      {summary && (
        <p data-reply-summary className="text-xs text-muted-foreground">
          {summary}
        </p>
      )}
      {!live && composerId && (
        <MessageActions
          composerId={composerId}
          messageId={messages.at(-1)!.id}
          kind="assistant"
          busy={hasActiveRun}
          hasLaterMessages={hasLaterMessages}
          text={answer.join("\n\n")}
        />
      )}
      {live && !replyInProgress(entries) && <WorkingLine startedAt={start?.startedAt} />}
    </>
  );
}
