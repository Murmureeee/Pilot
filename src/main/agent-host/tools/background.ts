// @env node
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import { obj, str } from "@earendil-works/pi-schema";

import type { RunRef } from "../../../shared/contract";
import type { TerminalManager } from "../../terminal";
import { READ_BACKGROUND_TOOL_NAME, STOP_BACKGROUND_TOOL_NAME, TOOL_LABELS } from "./constants";

const jobParameters = obj({
  id: str({ description: "ID returned by bash with background: true." }),
});

export function createBackgroundTools(terminal: TerminalManager, run: RunRef): AgentTool[] {
  const read: AgentTool<typeof jobParameters> = {
    name: READ_BACKGROUND_TOOL_NAME,
    label: TOOL_LABELS[READ_BACKGROUND_TOOL_NAME],
    description:
      "Read the latest output and status of a background command started in the current task.",
    parameters: jobParameters,
    execute: async (_callId, params, signal): Promise<AgentToolResult> => {
      signal?.throwIfAborted();
      const { record, output } = terminal.readBackground(run, params.id);
      const exit = record.exitCode === undefined ? "" : ` (exit ${record.exitCode})`;
      return {
        content: [
          {
            type: "text",
            text: `${record.status}${exit}\n${record.error ?? ""}\n${output || "(no output yet)"}`,
          },
        ],
        details: {},
      };
    },
  };
  const stop: AgentTool<typeof jobParameters> = {
    name: STOP_BACKGROUND_TOOL_NAME,
    label: TOOL_LABELS[STOP_BACKGROUND_TOOL_NAME],
    description: "Stop a background command started in the current task.",
    parameters: jobParameters,
    executionMode: "sequential",
    execute: async (_callId, params, signal): Promise<AgentToolResult> => {
      signal?.throwIfAborted();
      await terminal.stopBackground(run, params.id);
      return {
        content: [{ type: "text", text: `Background command ${params.id} has ended.` }],
        details: {},
      };
    },
  };
  return [read, stop];
}
