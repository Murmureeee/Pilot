// @env browser
import { useRef, useState, type JSX } from "react";
import { LoaderCircleIcon, SquareTerminalIcon } from "lucide-react";
import { Composer } from "@renderer/components/ai/composer";
import { MessageJump } from "@renderer/components/ai/message-jump";
import { OnboardingDialog } from "@renderer/components/ai/onboarding-dialog";
import { PlanCard } from "@renderer/components/ai/plan-card";
import { Response } from "@renderer/components/ai/response";
import { ThinkingBlock } from "@renderer/components/ai/thinking-block";
import { ToolCard } from "@renderer/components/ai/tool-card";
import { Button } from "@renderer/components/ui/button";
import {
  MessageScroller,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@renderer/components/ui/message-scroller";
import { Message, MessageContent } from "@renderer/components/ui/message";
import { Bubble, BubbleContent } from "@renderer/components/ui/bubble";
import { localizeError, t } from "@renderer/lib/i18n";
import { useAgentStore } from "@renderer/stores/agent";
import { cn } from "cn";
import type { UiPart } from "@shared/contract";
import { isLocalOpenAiProvider } from "@shared/providers";

function AssistantPart({
  part,
  streamingTail,
  thinkingStreaming,
}: {
  part: UiPart;
  streamingTail: boolean;
  /** 思考块仍在流式接收（最后一条 part 且 busy） */
  thinkingStreaming: boolean;
}): JSX.Element | null {
  if (part.type === "text") {
    return (
      <div className="min-w-0 text-[15px] leading-7">
        {part.text.length > 0 ? (
          <>
            <Response content={part.text} />
            {streamingTail && (
              <span className="ml-0.5 inline-block h-4 w-1.5 rounded-xs bg-emerald-500 align-text-bottom motion-safe:animate-pulse" />
            )}
          </>
        ) : (
          <LoaderCircleIcon
            aria-hidden="true"
            className="size-4 text-emerald-600 motion-safe:animate-spin dark:text-emerald-400"
          />
        )}
      </div>
    );
  }
  if (part.type === "thinking") {
    return <ThinkingBlock text={part.text} streaming={thinkingStreaming} />;
  }
  if (part.type === "tool") {
    return <ToolCard part={part} />;
  }
  if (part.type === "plan") {
    return <PlanCard steps={part.steps} />;
  }
  return null;
}

export function ChatView(): JSX.Element {
  const locale = useAgentStore((s) => s.locale);
  const messages = useAgentStore((s) => s.messages);
  const sessionId = useAgentStore((s) => s.sessionId);
  const busy = useAgentStore((s) => s.status !== "idle");
  const error = useAgentStore((s) => s.error);
  const settings = useAgentStore((s) => s.settings);
  const setView = useAgentStore((s) => s.setView);
  const isEmpty = messages.length === 0;
  const needsSetup =
    isEmpty &&
    settings !== null &&
    !settings.providers.some((p) => p.hasKey || p.kind === "faux" || isLocalOpenAiProvider(p));
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);

  return (
    <div className={cn("relative flex min-h-0 flex-1 flex-col", isEmpty && "overflow-y-auto")}>
      {!isEmpty && (
        <div className="relative flex min-h-0 flex-1 flex-col">
          <MessageJump
            key={sessionId}
            messages={messages}
            viewportRef={viewportRef}
            contentRef={contentRef}
          />
          <MessageScrollerProvider autoScroll>
            <MessageScroller className="min-h-0 flex-1">
              <MessageScrollerViewport
                ref={viewportRef}
                className="[scrollbar-color:var(--border)_transparent] [scrollbar-gutter:stable_both-edges] [scrollbar-width:thin]"
              >
                <MessageScrollerContent
                  ref={contentRef}
                  className="workspace-column gap-7 pt-7 pb-5"
                >
                  {messages.map((message, index) => {
                    const isLast = index === messages.length - 1;
                    const isUser = message.role === "user";
                    const isStreaming = isLast && busy;
                    if (message.role === "assistant" && !message.parts.length && !isStreaming)
                      return null;
                    const beginsReply = index === 0 || messages[index - 1].role === "user";
                    return (
                      <MessageScrollerItem
                        key={message.id}
                        id={`msg-${message.id}`}
                        className={isUser ? "message-scroller-user-item" : undefined}
                      >
                        <Message align={isUser ? "end" : "start"} className="items-start gap-3">
                          {!isUser && (
                            <span
                              aria-hidden="true"
                              className={cn(
                                "bg-secondary text-secondary-foreground mt-0.5 grid size-7 shrink-0 place-items-center rounded-[9px]",
                                !beginsReply && "invisible",
                              )}
                            >
                              <SquareTerminalIcon className="size-4" strokeWidth={1.65} />
                            </span>
                          )}
                          <MessageContent className="gap-3">
                            {isUser ? (
                              <Bubble align="end" variant="secondary" className="max-w-[88%]">
                                <BubbleContent className="rounded-[18px] rounded-br-md px-4 py-2.5 text-[15px] leading-6 whitespace-pre-wrap">
                                  {message.parts
                                    .map((part) => (part.type === "text" ? part.text : ""))
                                    .join("")}
                                </BubbleContent>
                              </Bubble>
                            ) : (
                              <>
                                {message.parts.map((part, partIndex) => {
                                  const streamingTail =
                                    isStreaming && partIndex === message.parts.length - 1;
                                  return (
                                    <AssistantPart
                                      key={partIndex}
                                      part={part}
                                      streamingTail={streamingTail && part.type === "text"}
                                      thinkingStreaming={streamingTail}
                                    />
                                  );
                                })}
                                {!message.parts.length && (
                                  <LoaderCircleIcon
                                    aria-hidden="true"
                                    className="mt-2 size-4 text-emerald-600 motion-safe:animate-spin dark:text-emerald-400"
                                  />
                                )}
                              </>
                            )}
                          </MessageContent>
                        </Message>
                      </MessageScrollerItem>
                    );
                  })}
                </MessageScrollerContent>
              </MessageScrollerViewport>
            </MessageScroller>
          </MessageScrollerProvider>
        </div>
      )}

      <div
        className={cn(
          "workspace-column flex shrink-0 flex-col",
          isEmpty ? "my-auto gap-6 pt-7 pb-[clamp(1.5rem,12vh,6rem)]" : "gap-2 pt-1.5 pb-4",
        )}
      >
        {isEmpty && (
          <h1 className="text-center text-[clamp(1.5rem,3vw,2rem)] leading-tight font-semibold tracking-tight text-balance">
            {t("我们要做什么？", locale)}
          </h1>
        )}
        {needsSetup && (
          <div className="bg-muted flex flex-wrap items-center justify-between gap-3 rounded-2xl border p-4">
            <div className="min-w-0">
              <p className="text-sm font-medium">{t("配置模型后即可开始对话", locale)}</p>
              <p className="text-muted-foreground mt-1 text-xs">
                {t("连接模型提供方，或先试用本地演示。", locale)}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-1">
              <Button
                size="sm"
                variant="ghost"
                onClick={() => {
                  useAgentStore.getState().setSettingsSection("providers");
                  setView("settings");
                }}
              >
                {t("设置", locale)}
              </Button>
              <Button size="sm" onClick={() => setOnboardingOpen(true)}>
                {t("开始配置", locale)}
              </Button>
            </div>
          </div>
        )}
        {error && (
          <div
            role="alert"
            className="border-destructive/25 bg-destructive/5 text-destructive rounded-xl border px-4 py-3"
          >
            <p className="text-sm font-medium">{t("请求失败", locale)}</p>
            <p className="wrap-anywhere text-xs">{localizeError(error, locale)}</p>
            <p className="mt-1 text-xs">
              {t("检查网络连接或模型设置，然后重新发送消息。", locale)}
            </p>
          </div>
        )}
        <Composer />
      </div>
      {isEmpty && (
        <OnboardingDialog open={onboardingOpen} onClose={() => setOnboardingOpen(false)} />
      )}
    </div>
  );
}
