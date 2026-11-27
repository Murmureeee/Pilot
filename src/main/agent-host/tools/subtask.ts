// @env node
import { addAbortListener } from "node:events";

import { Agent, type AgentTool, type AgentToolResult } from "@earendil-works/pi-agent-core";
import { obj, str } from "@earendil-works/pi-schema";

import type { SubtaskStep, SubtaskTrace } from "@shared/contract";

import { RUN_SUBTASK_TOOL_NAME } from "../../../shared/constants";
import {
  MAX_CONCURRENT_SUBTASKS,
  MAX_SUBTASK_REQUESTS,
  MAX_SUBTASK_STEPS,
  SUBTASK_CONCLUSION_LIMIT,
  SUBTASK_CONCURRENCY_EXHAUSTED,
  SUBTASK_EMPTY_CONCLUSION,
  SUBTASK_EMPTY_QUESTION,
  SUBTASK_MODEL_FAILURE,
  SUBTASK_QUESTION_LIMIT,
  SUBTASK_REQUESTS_EXHAUSTED,
  SUBTASK_STEP_OUTPUT_LIMIT,
  SUBTASK_STOPPED,
  SUBTASK_SYSTEM_PROMPT,
} from "../constants";
import { accumulateUsage, assistantUsage } from "../context-compaction";
import { loadProjectInstructions, ProjectInstructionScopes } from "../project-instructions";
import { finishSubtaskTrace } from "../subtask-record";
import type { SubtaskToolOptions } from "../types";
import { TOOL_LABELS } from "./constants";
import { labelOf } from "./index";
import { truncate } from "./output";

const parameters = obj({
  question: str({
    minLength: 1,
    maxLength: SUBTASK_QUESTION_LIMIT,
    description: "A self-contained research question with the paths and context the subtask needs.",
  }),
});

export function createSubtaskTool(options: SubtaskToolOptions): AgentTool<typeof parameters> {
  const tools = options.tools.filter(
    ({ name }) => name === "read_file" || name === "glob" || name === "grep",
  );
  let active = 0;
  return {
    name: RUN_SUBTASK_TOOL_NAME,
    label: TOOL_LABELS[RUN_SUBTASK_TOOL_NAME],
    description: [
      "Delegate a focused, read-only research question in the current project to a separate Agent.",
      "Use it to investigate complex or independent questions. Include the relevant paths and task context.",
      "It uses local project read and search tools and returns a concise conclusion with evidence.",
      "You can start at most two subtasks concurrently.",
    ].join(" "),
    parameters,
    execute: async (callId, input, toolSignal): Promise<AgentToolResult> => {
      const question = input.question.trim();
      if (!question) throw new Error(SUBTASK_EMPTY_QUESTION);
      if (active >= MAX_CONCURRENT_SUBTASKS) throw new Error(SUBTASK_CONCURRENCY_EXHAUSTED);
      const signal = toolSignal ? AbortSignal.any([options.signal, toolSignal]) : options.signal;
      active++;
      try {
        return await runSubtask(callId, question, tools, signal, options);
      } finally {
        active--;
      }
    },
  };
}

async function runSubtask(
  callId: string,
  question: string,
  tools: AgentTool[],
  signal: AbortSignal,
  { parent, stream, projectDirectory, report }: SubtaskToolOptions,
): Promise<AgentToolResult> {
  signal.throwIfAborted();
  const { model, thinkingLevel } = parent.state;
  const project = loadProjectInstructions(projectDirectory);
  const scopes = new ProjectInstructionScopes(projectDirectory);
  const systemPrompt = [SUBTASK_SYSTEM_PROMPT, project.body].filter(Boolean).join("\n\n");
  let requests = 0;
  let calls = 0;
  let apiKey: string | undefined;
  const redact = (text: string): string => (apiKey ? text.replaceAll(apiKey, "••••") : text);
  let trace: SubtaskTrace = {
    question,
    status: "running",
    steps: [],
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costTotal: 0 },
  };
  const child = new Agent({
    initialState: { model, thinkingLevel, systemPrompt, tools },
    getApiKey: parent.getApiKey,
    streamFn: (requestModel, context, options) => {
      if (++requests > MAX_SUBTASK_REQUESTS) throw new Error(SUBTASK_REQUESTS_EXHAUSTED);
      apiKey = options?.apiKey;
      return stream(requestModel, context, { ...options, maxRetries: 0 });
    },
    transformContext: async (messages) => {
      const scoped = scopes.prompt().text;
      const first = messages[0];
      return scoped && first?.role === "system"
        ? messages.with(0, { ...first, content: systemPrompt + "\n\n" + scoped })
        : messages;
    },
    beforeToolCall: async ({ toolCall, args }) => {
      signal.throwIfAborted();
      if (++calls > MAX_SUBTASK_STEPS)
        return {
          block: true,
          reason: "The subtask reached its tool-call limit. Return your findings now.",
        };
      scopes.includeTool(toolCall.name, args);
    },
  });
  const unsubscribe = child.subscribe((event) => {
    if (event.type === "tool_execution_start" && trace.steps.length < MAX_SUBTASK_STEPS) {
      const step: SubtaskStep = {
        id: event.toolCallId,
        toolName: event.toolName,
        label: labelOf(event.toolName),
        inputSummary: truncate(
          redact(JSON.stringify(event.args) ?? "{}"),
          SUBTASK_STEP_OUTPUT_LIMIT,
        ),
        state: "running",
      };
      trace = { ...trace, steps: [...trace.steps, step] };
      report(callId, { trace });
    } else if (event.type === "tool_execution_end") {
      const index = trace.steps.findLastIndex(
        ({ id, state }) => id === event.toolCallId && state === "running",
      );
      if (index < 0) return;
      const result: AgentToolResult = event.result;
      const output = (result.content ?? [])
        .flatMap((part) => (part.type === "text" ? [part.text] : []))
        .join("\n");
      trace = {
        ...trace,
        steps: trace.steps.with(index, {
          ...trace.steps[index],
          state: event.isError ? "error" : "success",
          output: output ? truncate(redact(output), SUBTASK_STEP_OUTPUT_LIMIT) : undefined,
          durationMs: event.durationMs,
        }),
      };
      report(callId, { trace });
    } else if (
      event.type === "message_end" &&
      event.message.role === "assistant" &&
      event.message.usage
    ) {
      const usageDelta = assistantUsage(event.message.usage);
      const usage = { ...trace.usage };
      accumulateUsage(usage, usageDelta);
      trace = { ...trace, usage };
      report(callId, { trace, usageDelta });
    }
  });
  const cancellation = addAbortListener(signal, () => child.abort());
  let conclusion: string;
  try {
    report(callId, { trace });
    signal.throwIfAborted();
    await child.prompt(question);
    signal.throwIfAborted();
    const reply = child.state.messages.at(-1);
    if (reply?.role === "assistant" && reply.stopReason === "error") {
      const detail = reply.errorMessage?.trim();
      if (detail === SUBTASK_REQUESTS_EXHAUSTED) throw new Error(detail);
      throw new Error([SUBTASK_MODEL_FAILURE, detail].filter(Boolean).join("\n"));
    }
    const text =
      reply?.role === "assistant"
        ? reply.content
            .flatMap((part) => (part.type === "text" ? [part.text] : []))
            .join("\n")
            .trim()
        : "";
    if (!text) throw new Error(SUBTASK_EMPTY_CONCLUSION);
    conclusion = truncate(redact(text), SUBTASK_CONCLUSION_LIMIT);
  } catch (error) {
    const text = signal.aborted
      ? SUBTASK_STOPPED
      : truncate(
          redact(error instanceof Error ? error.message : String(error)),
          SUBTASK_STEP_OUTPUT_LIMIT,
        );
    report(callId, {
      trace: finishSubtaskTrace(trace, signal.aborted ? "stopped" : "error", text),
      text,
    });
    throw new Error(text, { cause: error });
  } finally {
    cancellation[Symbol.dispose]();
    unsubscribe();
  }
  const finished = finishSubtaskTrace(trace, "success");
  report(callId, { trace: finished, text: conclusion });
  return {
    content: [{ type: "text", text: conclusion }],
    details: { pilotSubtask: finished },
  };
}
