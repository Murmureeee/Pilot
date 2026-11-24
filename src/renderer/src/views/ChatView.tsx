// @env browser
import { Activity, Fragment, useEffect, useMemo, useRef, useState, type JSX } from "react";
import { ArrowDownIcon, RotateCcwIcon } from "lucide-react";
import { AssistantReply } from "@renderer/components/ai/assistant-reply";
import { Composer } from "@renderer/components/ai/composer";
import { HomeStart } from "@renderer/components/ai/home-start";
import { MessageJump } from "@renderer/components/ai/message-jump";
import { OnboardingDialog } from "@renderer/components/ai/onboarding-dialog";
import { PermissionCard } from "@renderer/components/ai/permission-card";
import { PlanBar } from "@renderer/components/ai/plan-card";
import { SettingsRecoveryNotice } from "@renderer/components/ai/settings-recovery-notice";
import { InlineWorkspaceReference } from "@renderer/components/ai/workspace-reference";
import { Button } from "@renderer/components/ui/button";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
} from "@renderer/components/ui/message-scroller";
import { Message, MessageContent } from "@renderer/components/ui/message";
import { Bubble, BubbleContent } from "@renderer/components/ui/bubble";
import { localizeError, t, useLocale } from "@renderer/lib/i18n";
import type { ChatRow } from "@renderer/lib/types";
import { useAgentStore } from "@renderer/stores/agent";
import { cn } from "cn";
import type { UiMessage, UiPart } from "@shared/contract";
import { isLocalOpenAiProvider } from "@shared/providers";

function chatRows(messages: UiMessage[]): ChatRow[] {
  const rows: ChatRow[] = [];
  for (const message of messages) {
    if (message.role === "user") {
      rows.push({ id: message.id, role: "user", message });
    } else if (message.role === "assistant") {
      const previous = rows.at(-1);
      if (previous?.role === "assistant") previous.messages.push(message);
      else rows.push({ id: message.id, role: "assistant", messages: [message] });
    }
  }
  return rows;
}

export function ChatView({
  workingDirectory,
  projectDirectory,
}: {
  workingDirectory: string | null;
  projectDirectory: string | null;
}): JSX.Element {
  const locale = useLocale();
  const messages = useAgentStore((s) => s.messages);
  const sessionId = useAgentStore((s) => s.sessionId);
  const composerId = useAgentStore((s) => s.composerId);
  const busy = useAgentStore((s) => s.status !== "idle");
  const permission = useAgentStore((s) => s.pendingPermissions[0]);
  const activeRun = useAgentStore((s) => s.activeRun);
  const interruptedRun = useAgentStore((s) => s.interruptedRun);
  const resumeRun = useAgentStore((s) => s.resumeRun);
  const error = useAgentStore((s) => s.error);
  const projectError = useAgentStore((s) => s.projectError);
  const settings = useAgentStore((s) => s.settings);
  const setView = useAgentStore((s) => s.setView);
  const rows = useMemo(() => chatRows(messages), [messages]);
  const isEmpty = rows.length === 0;
  // run_started 先于新的用户消息到达。这段间隙里上一回合仍是最后一行，但它已经结束，
  // 不能当作进行中，否则收起的轨迹会闪开、旧计划会跳到输入坞上。可继续的中断回合除外。
  const lastRow = rows.at(-1);
  const idleRowKey =
    lastRow && interruptedRun?.sessionId !== sessionId ? sessionId + "/" + lastRow.id : null;
  const [finishedRowKey, setFinishedRowKey] = useState<string | null>(null);
  if (!busy && finishedRowKey !== idleRowKey) setFinishedRowKey(idleRowKey);
  const liveRow =
    busy && lastRow && sessionId + "/" + lastRow.id !== finishedRowKey ? lastRow : undefined;
  const livePlan = useMemo(() => {
    if (liveRow?.role !== "assistant") return undefined;
    return liveRow.messages
      .flatMap((message) => message.parts)
      .findLast((part): part is Extract<UiPart, { type: "plan" }> => part.type === "plan");
  }, [liveRow]);
  const needsSetup =
    isEmpty &&
    settings !== null &&
    !settings.providers.some((p) => p.hasKey || p.kind === "faux" || isLocalOpenAiProvider(p));
  const [onboardingOpen, setOnboardingOpen] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const composerColumn = useRef<HTMLDivElement>(null);
  const wasAwaitingApproval = useRef(false);

  useEffect(() => {
    const restoreFocus = wasAwaitingApproval.current && !permission;
    wasAwaitingApproval.current = Boolean(permission);
    if (restoreFocus && document.activeElement === document.body) {
      composerColumn.current?.querySelector<HTMLElement>("[contenteditable=true]")?.focus({
        preventScroll: true,
      });
    }
  }, [permission]);

  const fillDraft = (text: string): void => {
    const editor = composerColumn.current?.querySelector<HTMLElement>("[contenteditable=true]");
    if (!editor) return;
    editor.focus();
    // 走浏览器的编辑命令，输入框的 onInput 会接手草稿，Ctrl+Z 也能撤回。
    document.execCommand("selectAll");
    document.execCommand("insertText", false, text);
  };

  return (
    <div className={cn("relative flex min-h-0 flex-1 flex-col", isEmpty && "overflow-y-auto")}>
      {settings?.recovery && (
        <div className="workspace-column shrink-0 pt-4 pb-2">
          <SettingsRecoveryNotice recovery={settings.recovery} />
        </div>
      )}
      {!isEmpty && (
        <div className="relative flex min-h-0 flex-1 flex-col">
          <MessageJump
            key={"jump-" + sessionId}
            messages={messages}
            viewportRef={viewportRef}
            contentRef={contentRef}
          />
          <MessageScrollerProvider key={sessionId ?? "draft"} autoScroll>
            <MessageScroller className="min-h-0 flex-1">
              <MessageScrollerViewport
                ref={viewportRef}
                className="[overflow-anchor:none] [scrollbar-color:var(--border)_transparent] [scrollbar-gutter:stable_both-edges] [scrollbar-width:thin]"
              >
                <MessageScrollerContent
                  ref={contentRef}
                  className="workspace-column gap-7 pt-7 pb-5"
                >
                  {rows.map((row) => {
                    const isUser = row.role === "user";
                    const live = row === liveRow;
                    if (
                      !isUser &&
                      !live &&
                      !row.messages.some((message) => message.parts.length > 0)
                    )
                      return null;
                    return (
                      <MessageScrollerItem
                        key={row.id}
                        id={"msg-" + row.id}
                        messageId={row.id}
                        className={isUser ? "message-scroller-user-item" : undefined}
                      >
                        <Message align={isUser ? "end" : "start"} className="items-start">
                          <MessageContent className="gap-3">
                            {isUser ? (
                              <Bubble align="end" variant="secondary" className="max-w-[88%]">
                                <BubbleContent className="rounded-[18px] rounded-br-md px-4 py-2.5 text-sm leading-6 whitespace-pre-wrap">
                                  {row.message.parts.map((part, partIndex) => {
                                    if (part.type === "text")
                                      return <Fragment key={partIndex}>{part.text}</Fragment>;
                                    if (part.type !== "mention") return null;
                                    return (
                                      <InlineWorkspaceReference
                                        key={partIndex}
                                        chip
                                        kind={part.kind}
                                        path={part.id}
                                        workingDirectory={part.workingDirectory}
                                      >
                                        {part.label}
                                      </InlineWorkspaceReference>
                                    );
                                  })}
                                </BubbleContent>
                              </Bubble>
                            ) : (
                              <AssistantReply
                                messages={row.messages}
                                sessionId={sessionId}
                                live={live}
                                busy={busy}
                              />
                            )}
                          </MessageContent>
                        </Message>
                      </MessageScrollerItem>
                    );
                  })}
                </MessageScrollerContent>
              </MessageScrollerViewport>
              <MessageScrollerButton
                behavior="auto"
                aria-label={t("回到最新消息", locale)}
                title={t("回到最新消息", locale)}
                className="z-10 shadow-sm motion-reduce:transition-none"
              >
                <ArrowDownIcon aria-hidden="true" />
              </MessageScrollerButton>
            </MessageScroller>
          </MessageScrollerProvider>
        </div>
      )}

      <div
        ref={composerColumn}
        className={cn(
          "workspace-column flex shrink-0 flex-col",
          isEmpty ? "my-auto gap-6 pt-7 pb-[clamp(1.5rem,12vh,6rem)]" : "gap-2 pt-1.5 pb-4",
        )}
      >
        {isEmpty && (
          <h1 className="text-center text-[clamp(1.375rem,2.5vw,1.75rem)] leading-tight font-semibold tracking-tight text-balance">
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
                {t("配置模型", locale)}
              </Button>
            </div>
          </div>
        )}
        {projectError && (
          <p role="alert" className="text-destructive wrap-anywhere text-sm">
            {localizeError(projectError, locale)}
          </p>
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
        {interruptedRun && (
          <div className="bg-muted/60 flex flex-wrap items-center justify-between gap-2 rounded-lg px-3 py-2">
            <output className="min-w-0">
              <span className="block text-sm font-medium">{t("已中断", locale)}</span>
              <span className="text-muted-foreground block text-xs">
                {t("可以从已保存的消息和工具结果继续。", locale)}
              </span>
            </output>
            <Button
              size="sm"
              variant="outline"
              disabled={activeRun !== null}
              onClick={() => void resumeRun(interruptedRun)}
            >
              <RotateCcwIcon data-icon="inline-start" />
              {t("继续任务", locale)}
            </Button>
          </div>
        )}
        {livePlan && <PlanBar steps={livePlan.steps} />}
        {permission && activeRun && (
          <PermissionCard key={permission.requestId} request={permission} run={activeRun} />
        )}
        <Activity mode={permission ? "hidden" : "visible"}>
          {composerId && (
            <Composer
              key={composerId}
              composerId={composerId}
              workingDirectory={workingDirectory}
            />
          )}
        </Activity>
        {isEmpty && !permission && !interruptedRun && (
          <HomeStart
            sessionId={sessionId}
            projectDirectory={projectDirectory}
            workingDirectory={workingDirectory}
            needsSetup={needsSetup}
            onPick={fillDraft}
          />
        )}
      </div>
      {isEmpty && (
        <OnboardingDialog open={onboardingOpen} onClose={() => setOnboardingOpen(false)} />
      )}
    </div>
  );
}
