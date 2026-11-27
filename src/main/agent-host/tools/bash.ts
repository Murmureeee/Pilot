// @env node
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";

import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import { bool, int, obj, opt, str } from "@earendil-works/pi-schema";

import type { TerminalRecord } from "../../../shared/contract";
import { stopProcessTree } from "../../workspace/process";
import { launchCommand } from "../../workspace/shell";
import {
  COMMAND_CLOSE_TIMEOUT_MS,
  COMMAND_TIMEOUT_DEFAULT_SEC,
  COMMAND_TIMEOUT_MAX_SEC,
  COMMAND_TIMEOUT_MIN_SEC,
  TOOL_LABELS,
} from "./constants";
import { CommandOutput } from "./output";
import type { ToolEnvironment } from "./types";

const bashParams = obj({
  command: str({ description: "Command in the configured shell syntax." }),
  background: opt(
    bool({
      description:
        "Start a long-running command in the background for the current task. Use read_background_command or stop_background_command with the returned ID.",
    }),
  ),
  timeoutSec: opt(
    int({
      description: `Timeout in seconds, clamped to ${COMMAND_TIMEOUT_MIN_SEC}–${COMMAND_TIMEOUT_MAX_SEC}. Default ${COMMAND_TIMEOUT_DEFAULT_SEC}.`,
    }),
  ),
});

export function createBashTool(
  { workingDirectory, commandShell }: ToolEnvironment,
  startBackground?: (command: string, signal?: AbortSignal) => Promise<TerminalRecord>,
  commandEnvironment?: NodeJS.ProcessEnv,
): AgentTool<typeof bashParams> {
  const powershell = commandShell === "powershell";
  const shellName = powershell ? "PowerShell" : process.platform === "win32" ? "Git Bash" : "Bash";
  return {
    name: "bash",
    label: TOOL_LABELS.bash,
    description: `Run a ${shellName} command from the configured working directory. Set background to true to keep the command running while this task continues.`,
    parameters: bashParams,
    executionMode: "sequential",
    execute: async (_id, params, signal, onUpdate): Promise<AgentToolResult> => {
      signal?.throwIfAborted();
      if (params.background) {
        if (!startBackground) throw new Error("Background commands are unavailable in this task.");
        const record = await startBackground(params.command, signal);
        return {
          content: [
            {
              type: "text",
              text:
                "Background command " +
                record.id +
                " started in " +
                record.workingDirectory +
                ". Use read_background_command or stop_background_command with this ID. Active commands stop when the task ends.",
            },
          ],
          details: {},
        };
      }
      const timeoutSec = Math.max(
        COMMAND_TIMEOUT_MIN_SEC,
        Math.min(params.timeoutSec ?? COMMAND_TIMEOUT_DEFAULT_SEC, COMMAND_TIMEOUT_MAX_SEC),
      );
      const started = performance.now();
      const child = launchCommand(
        commandShell,
        workingDirectory,
        params.command,
        commandEnvironment,
      );
      const closed = once(child, "close") as Promise<[number | null, NodeJS.Signals | null]>;
      const output = new CommandOutput();
      const collect = (chunk: string): void => {
        output.append(chunk);
        onUpdate?.({ content: [{ type: "text", text: output.text() }], details: {} });
      };
      child.stdout.setEncoding("utf8").on("data", collect);
      child.stderr.setEncoding("utf8").on("data", collect);

      const stop = Promise.withResolvers<"abort" | "timeout">();
      const onAbort = (): void => stop.resolve("abort");
      const timer = setTimeout(() => stop.resolve("timeout"), timeoutSec * 1000);
      signal?.addEventListener("abort", onAbort, { once: true });
      const failure = (message: string, cause?: unknown): Error =>
        new Error(`${message}\n输出:\n${output.text() || "(无输出)"}`, { cause });

      try {
        const result = await Promise.race([closed, stop.promise]);
        if (typeof result === "string") {
          const elapsed = ((performance.now() - started) / 1000).toFixed(2);
          const message =
            result === "abort"
              ? "命令被用户中止"
              : `命令超时（已运行 ${elapsed} 秒，上限 ${timeoutSec} 秒）`;
          const wait = new AbortController();
          try {
            await stopProcessTree(child);
            await Promise.race([
              closed,
              delay(COMMAND_CLOSE_TIMEOUT_MS, undefined, { signal: wait.signal }).then(() => {
                throw new Error("等待命令输出管道关闭超时。");
              }),
            ]);
          } catch (cause) {
            child.unref();
            throw failure(`${message}，未能确认命令进程树已结束`, cause);
          } finally {
            wait.abort();
          }
          throw failure(message);
        }
        const [code, exitSignal] = result;
        if (code !== 0) throw failure(`命令失败（${exitSignal ?? `exit ${code}`}）`);
        return { content: [{ type: "text", text: output.text() || "(无输出)" }], details: {} };
      } finally {
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        child.stdout.destroy();
        child.stderr.destroy();
      }
    },
  };
}
