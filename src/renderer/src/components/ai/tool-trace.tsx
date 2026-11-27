// @env browser
import {
  FilePenLineIcon,
  FileTextIcon,
  GlobeIcon,
  LayersIcon,
  LoaderCircleIcon,
  ListTreeIcon,
  PlugIcon,
  SearchIcon,
  TerminalIcon,
} from "lucide-react";
import { useMemo, useState, type JSX } from "react";

import { CodeBlock, CodeBlockContent } from "@renderer/components/ui/code-block";
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
import { PERMISSION_DECISIONS } from "@renderer/lib/constants";
import { formatDuration } from "@renderer/lib/duration";
import { t, useLocale } from "@renderer/lib/i18n";
import { describeToolScope } from "@renderer/lib/tool-rules";
import { parseToolFailure, stackDisplayPath } from "@renderer/lib/tool-trace";
import type { ToolFailure } from "@renderer/lib/types";
import { selectWorkingDirectory, useAgentStore } from "@renderer/stores/agent";
import { RUN_SUBTASK_TOOL_NAME } from "@shared/constants";
import type { SubtaskTrace, TranscriptLocation, UiPart, WebSource } from "@shared/contract";
import { toolInput } from "@shared/tool-input";
import { WEB_FETCH_TOOL, WEB_SEARCH_TOOL, isWebTool, webLink } from "@shared/web";

import { InlineWorkspaceReference } from "./workspace-reference";

const TOOL_ICONS = {
  bash: TerminalIcon,
  read_file: FileTextIcon,
  write_file: FilePenLineIcon,
  edit_file: FilePenLineIcon,
  glob: SearchIcon,
  grep: SearchIcon,
  [WEB_FETCH_TOOL]: GlobeIcon,
  [WEB_SEARCH_TOOL]: SearchIcon,
  [RUN_SUBTASK_TOOL_NAME]: ListTreeIcon,
} satisfies Record<string, typeof TerminalIcon>;

function SourceLinks({ sources }: { sources: WebSource[] }): JSX.Element {
  const locale = useLocale();
  return (
    <ul aria-label={t("网页来源", locale)} data-tool-sources className="grid min-w-0 gap-2">
      {sources.map((source) => {
        const url = webLink(source.url);
        if (!url) return null;
        return (
          <li key={url.href} className="flex min-w-0 flex-col gap-0.5">
            <a
              href={url.href}
              target="_blank"
              rel="noreferrer"
              title={url.href}
              className="w-fit max-w-full rounded-sm text-xs wrap-anywhere text-brand underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-ring"
            >
              {source.title}
            </a>
            <bdi className="text-xs wrap-anywhere text-muted-foreground">{url.hostname}</bdi>
          </li>
        );
      })}
    </ul>
  );
}

function ToolOutput({ text }: { text: string }): JSX.Element {
  return (
    <CodeBlock size="sm" className="ring-0">
      <CodeBlockContent wrap className="max-h-60 overscroll-contain">
        {text}
      </CodeBlockContent>
    </CodeBlock>
  );
}

function ToolDetails({
  title,
  text,
  reveal = false,
  field,
}: {
  title: string;
  text: string;
  reveal?: boolean;
  field?: TranscriptLocation["field"];
}): JSX.Element {
  const [open, setOpen] = useState(false);
  return (
    <TraceCollapsible open={reveal || open} onOpenChange={setOpen}>
      <TraceCollapsibleTrigger>
        <TraceLine>
          <TraceTitle>{title}</TraceTitle>
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent data-transcript-field={field}>
        <ToolOutput text={text} />
      </TraceCollapsibleContent>
    </TraceCollapsible>
  );
}

function FailureDetails({
  failure,
  output,
  revealOutput = false,
  translateFirstLine = false,
}: {
  failure: ToolFailure;
  output: string;
  revealOutput?: boolean;
  translateFirstLine?: boolean;
}): JSX.Element {
  const locale = useLocale();
  const workspace = useAgentStore(selectWorkingDirectory) ?? undefined;
  const project = failure.frames.filter((frame) => !frame.framework);
  const framework = failure.frames.filter((frame) => frame.framework);
  const [frameworkOpen, setFrameworkOpen] = useState(false);
  const message = failure.frames.length ? failure.summary : failure.message;
  const [first, ...rest] = message.split("\n");
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <p className="max-h-56 overflow-auto overscroll-contain font-mono text-xs leading-relaxed wrap-anywhere whitespace-pre-wrap text-destructive">
        {translateFirstLine ? [t(first, locale), ...rest].join("\n") : t(message, locale)}
      </p>
      {project.length > 0 && (
        <ol className="grid max-h-48 min-w-0 gap-1 overflow-auto overscroll-contain px-px text-[13px]">
          {project.map(({ text, name, reference }, index) => {
            const location = reference
              ? stackDisplayPath(reference.path, workspace) + ":" + reference.line
              : "";
            return (
              <li key={index} className="min-w-0 wrap-anywhere">
                {reference ? (
                  <InlineWorkspaceReference {...reference} workingDirectory={workspace}>
                    {name ? t("{0} 位于 {1}", locale, [name, location]) : location}
                  </InlineWorkspaceReference>
                ) : (
                  text
                )}
              </li>
            );
          })}
        </ol>
      )}
      {framework.length > 0 && (
        <TraceCollapsible open={revealOutput || frameworkOpen} onOpenChange={setFrameworkOpen}>
          <TraceCollapsibleTrigger>
            <TraceLine>
              <TraceIcon>
                <LayersIcon />
              </TraceIcon>
              <TraceTitle>{t("{0} 个框架堆栈帧", locale, [framework.length])}</TraceTitle>
            </TraceLine>
          </TraceCollapsibleTrigger>
          <TraceCollapsibleContent>
            <ToolOutput text={framework.map((frame) => frame.text).join("\n")} />
          </TraceCollapsibleContent>
        </TraceCollapsible>
      )}
      {failure.frames.length > 0 && failure.message !== failure.summary && (
        <ToolDetails
          title={t("完整输出", locale)}
          text={output}
          reveal={revealOutput}
          field="output"
        />
      )}
    </div>
  );
}

function SubtaskDetails({ trace }: { trace: SubtaskTrace }): JSX.Element {
  const locale = useLocale();
  const { input, output, cacheRead, cacheWrite } = trace.usage;
  const tokens = input + output + cacheRead + cacheWrite;
  return (
    <div data-subtask-trace className="grid min-w-0 gap-2">
      {trace.steps.length > 0 && (
        <Trace role="group" aria-label={t("子任务步骤", locale)}>
          {trace.steps.map(({ id, ...step }, index) => (
            <ToolTrace
              key={id + ":" + index}
              part={{
                ...step,
                type: "tool",
                callId: id,
                error: step.state === "error" ? step.output : undefined,
              }}
            />
          ))}
        </Trace>
      )}
      {tokens > 0 && (
        <p data-subtask-usage className="text-xs text-muted-foreground">
          {t("子任务用量 {0} token", locale, [tokens])}
        </p>
      )}
    </div>
  );
}

export function ToolTrace({
  part,
  searchField,
}: {
  part: Extract<UiPart, { type: "tool" }>;
  searchField?: TranscriptLocation["field"];
}): JSX.Element {
  const locale = useLocale();
  const [open, setOpen] = useState<boolean | null>(null);
  const input = useMemo(() => toolInput(part.inputSummary), [part.inputSummary]);
  const output = part.output?.trim() && part.output !== "(无输出)" ? part.output : undefined;
  const failureText =
    part.state === "error"
      ? [part.error, part.error !== output && output].filter(Boolean).join("\n").trim() ||
        t("工具执行失败", locale)
      : "";
  const failure = useMemo(
    () => (failureText ? parseToolFailure(failureText) : undefined),
    [failureText],
  );
  const shell = part.toolName === "bash";
  const subtask = part.toolName === RUN_SUBTASK_TOOL_NAME;
  const action = [t(part.label, locale), part.subtask?.question ?? input.preview]
    .filter(Boolean)
    .join(" ");
  const target = shell && input.preview ? input.preview : action;
  const stopped = part.subtask?.status === "stopped";
  const interrupted = part.subtask?.status === "interrupted";
  const title =
    stopped || interrupted
      ? t(stopped ? "已停止 {0}" : "已中断 {0}", locale, [target])
      : failure
        ? t("失败 {0}", locale, [subtask ? target : t(failure.summary, locale)])
        : part.state === "pending"
          ? t("等待执行 {0}", locale, [target])
          : part.state === "running"
            ? t("正在执行 {0}", locale, [target])
            : shell && input.preview
              ? t("运行了 {0}", locale, [input.preview])
              : action;
  const ToolIcon = Object.hasOwn(TOOL_ICONS, part.toolName)
    ? TOOL_ICONS[part.toolName as keyof typeof TOOL_ICONS]
    : PlugIcon;
  const line = (
    <TraceLine
      status={stopped || interrupted || part.state === "success" ? undefined : part.state}
      data-tool-state={part.state}
      data-subtask-status={part.subtask?.status}
      className={
        subtask && part.state === "running" ? "text-emerald-700 dark:text-emerald-400" : undefined
      }
    >
      <TraceIcon>
        {part.state === "running" ? (
          <LoaderCircleIcon className="motion-safe:animate-spin" />
        ) : (
          <ToolIcon />
        )}
      </TraceIcon>
      <TraceTitle title={title} data-transcript-field="input">
        {title}
      </TraceTitle>
      {/* 不到一秒的步骤不标耗时，一排零点几秒只是噪音。 */}
      {part.state === "success" && part.durationMs !== undefined && part.durationMs >= 1000 && (
        <TraceDescription>{formatDuration(part.durationMs, locale)}</TraceDescription>
      )}
    </TraceLine>
  );

  const { approval, sources } = part;
  if (!output && !failure && !input.details && !approval && !sources && !part.subtask) return line;

  const showArguments =
    input.details && (failure || input.details !== input.preview || input.details.includes("\n"));
  // 命令运行时跟着输出展开，成功后收起；失败始终展开。用户手动开合过就以用户为准。
  const autoOpen = Boolean(
    failure || part.subtask?.status === "running" || (shell && output && part.state === "running"),
  );
  return (
    <TraceCollapsible open={Boolean(searchField) || (open ?? autoOpen)} onOpenChange={setOpen}>
      <TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
      <TraceCollapsibleContent className="mt-1.5">
        <div className="flex min-w-0 flex-col gap-2">
          {approval && (
            <div
              className="grid gap-0.5 text-xs wrap-anywhere"
              data-tool-approval={approval.decision}
            >
              <p>
                {t("审批结果 {0}", locale, [t(PERMISSION_DECISIONS[approval.decision], locale)])}
              </p>
              {approval.rule && (
                <p className="text-muted-foreground">{describeToolScope(approval.rule, locale)}</p>
              )}
            </div>
          )}
          {sources && <SourceLinks sources={sources} />}
          {failure ? (
            <div data-transcript-field="output">
              <FailureDetails
                failure={failure}
                output={failureText}
                revealOutput={searchField === "output"}
                translateFirstLine={isWebTool(part.toolName) || subtask}
              />
            </div>
          ) : (
            (output || input.details) && (
              <div data-transcript-field={output ? "output" : "input"}>
                <ToolOutput text={output ?? input.details} />
              </div>
            )
          )}
          {part.subtask && <SubtaskDetails trace={part.subtask} />}
          {!part.subtask && (failure || output) && showArguments && (
            <ToolDetails
              title={t(shell ? "命令" : "参数", locale)}
              text={input.details}
              reveal={searchField === "input"}
              field="input"
            />
          )}
        </div>
      </TraceCollapsibleContent>
    </TraceCollapsible>
  );
}
