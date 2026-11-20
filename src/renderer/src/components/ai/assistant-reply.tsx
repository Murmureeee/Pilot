// @env browser
import type { JSX } from "react";
import { LoaderCircleIcon } from "lucide-react";
import { Trace } from "@renderer/components/ui/trace";
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
  const plans = entries.filter(({ part }) => part.type === "plan");
  const changes = entries.flatMap(({ part }) =>
    part.type === "tool" && part.fileChange ? [part.fileChange] : [],
  );
  const content = entries.filter(({ part }) => part.type !== "plan");
  const activityEnd = content.findLastIndex(({ part }) => part.type !== "text") + 1;
  const activity = content.slice(0, activityEnd);
  const answer = content.slice(activityEnd);

  return (
    <>
      {activity.length > 0 && (
        <Trace data-reply-activity>
          {activity.map(({ key, part }) => {
            if (part.type === "thinking") return <ThinkingBlock key={key} part={part} />;
            if (part.type === "tool") return <ToolTrace key={key} part={part} />;
            if (part.type !== "text" || !part.text) return null;
            return (
              <div key={key} className="text-muted-foreground text-[13px] leading-6">
                <Response content={part.text} />
              </div>
            );
          })}
        </Trace>
      )}
      {plans.map(
        ({ key, part }) => part.type === "plan" && <PlanCard key={key} steps={part.steps} />,
      )}
      {answer.map(
        ({ key, part, streaming }) =>
          part.type === "text" &&
          part.text && (
            <div key={key} className="min-w-0 text-[15px] leading-7">
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
