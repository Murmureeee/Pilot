// @env browser
import { useMemo, useState, type JSX } from "react";
import {
  FilePenLineIcon,
  FileTextIcon,
  LayersIcon,
  LoaderCircleIcon,
  PlugIcon,
  SearchIcon,
  TerminalIcon,
} from "lucide-react";
import { CodeBlock, CodeBlockContent } from "@renderer/components/ui/code-block";
import {
  TraceCollapsible,
  TraceCollapsibleContent,
  TraceCollapsibleTrigger,
  TraceIcon,
  TraceLine,
  TraceTitle,
} from "@renderer/components/ui/trace";
import { t, useLocale } from "@renderer/lib/i18n";
import { parseToolFailure, stackDisplayPath } from "@renderer/lib/tool-trace";
import type { ToolFailure } from "@renderer/lib/types";
import { useAgentStore } from "@renderer/stores/agent";
import type { UiPart } from "@shared/contract";
import { InlineWorkspaceReference } from "./workspace-reference";

const TOOL_ICONS = {
  bash: TerminalIcon,
  read_file: FileTextIcon,
  write_file: FilePenLineIcon,
  edit_file: FilePenLineIcon,
  glob: SearchIcon,
  grep: SearchIcon,
} satisfies Record<string, typeof TerminalIcon>;

function toolInput(source: string | undefined): { preview: string; details: string } {
  if (!source || source === "{}") return { preview: "", details: "" };
  try {
    const input = JSON.parse(source) as unknown;
    if (!input || typeof input !== "object") return { preview: source, details: source };
    const fields = input as Record<string, unknown>;
    const primary = [fields.command, fields.path, fields.pattern].find(
      (value): value is string => typeof value === "string" && Boolean(value.trim()),
    );
    return {
      preview: primary ?? source,
      details:
        primary && Object.keys(fields).length === 1 ? primary : JSON.stringify(input, null, 2),
    };
  } catch {
    return { preview: source, details: source };
  }
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

function ToolDetails({ title, text }: { title: string; text: string }): JSX.Element {
  return (
    <TraceCollapsible>
      <TraceCollapsibleTrigger>
        <TraceLine>
          <TraceTitle>{title}</TraceTitle>
        </TraceLine>
      </TraceCollapsibleTrigger>
      <TraceCollapsibleContent>
        <ToolOutput text={text} />
      </TraceCollapsibleContent>
    </TraceCollapsible>
  );
}

function FailureDetails({
  failure,
  output,
}: {
  failure: ToolFailure;
  output: string;
}): JSX.Element {
  const locale = useLocale();
  const workspace = useAgentStore((state) => state.settings?.workingDirectory) ?? undefined;
  const project = failure.frames.filter((frame) => !frame.framework);
  const framework = failure.frames.filter((frame) => frame.framework);
  return (
    <div className="flex min-w-0 flex-col gap-1.5">
      <p className="text-destructive max-h-56 overflow-auto overscroll-contain font-mono text-xs leading-relaxed wrap-anywhere whitespace-pre-wrap">
        {t(failure.frames.length ? failure.summary : failure.message, locale)}
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
        <TraceCollapsible>
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
        <ToolDetails title={t("完整输出", locale)} text={output} />
      )}
    </div>
  );
}

export function ToolTrace({ part }: { part: Extract<UiPart, { type: "tool" }> }): JSX.Element {
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
  const action = [t(part.label, locale), input.preview].filter(Boolean).join(" ");
  const target = shell && input.preview ? input.preview : action;
  const title = failure
    ? t("失败 {0}", locale, [t(failure.summary, locale)])
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
      status={part.state === "success" ? undefined : part.state}
      data-tool-state={part.state}
    >
      <TraceIcon>
        {part.state === "running" ? (
          <LoaderCircleIcon className="motion-safe:animate-spin" />
        ) : (
          <ToolIcon />
        )}
      </TraceIcon>
      <TraceTitle title={title}>{title}</TraceTitle>
    </TraceLine>
  );

  if (!output && !failure && !input.details) return line;

  const showArguments =
    input.details && (failure || input.details !== input.preview || input.details.includes("\n"));
  return (
    <TraceCollapsible open={open ?? Boolean(failure || (shell && output))} onOpenChange={setOpen}>
      <TraceCollapsibleTrigger>{line}</TraceCollapsibleTrigger>
      <TraceCollapsibleContent className="mt-1.5">
        <div className="flex min-w-0 flex-col gap-2">
          {failure ? (
            <FailureDetails failure={failure} output={failureText} />
          ) : (
            <ToolOutput text={output ?? input.details} />
          )}
          {(failure || output) && showArguments && (
            <ToolDetails title={t(shell ? "命令" : "参数", locale)} text={input.details} />
          )}
        </div>
      </TraceCollapsibleContent>
    </TraceCollapsible>
  );
}
