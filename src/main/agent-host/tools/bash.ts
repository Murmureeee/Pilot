// @env node
import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";

import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import { int, obj, opt, str } from "@earendil-works/pi-schema";

import { createToolPathResolver } from "../../workspace/paths";
import { stopProcessTree } from "../../workspace/process";
import { shellExecutable } from "../../workspace/shell";
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
  timeoutSec: opt(
    int({
      description: `Timeout in seconds, clamped to ${COMMAND_TIMEOUT_MIN_SEC}–${COMMAND_TIMEOUT_MAX_SEC}. Default ${COMMAND_TIMEOUT_DEFAULT_SEC}.`,
    }),
  ),
});

export function createBashTool({
  workingDirectory,
  commandShell,
}: ToolEnvironment): AgentTool<typeof bashParams> {
  const powershell = commandShell === "powershell";
  const shellName = powershell ? "PowerShell" : process.platform === "win32" ? "Git Bash" : "Bash";
  return {
    name: "bash",
    label: TOOL_LABELS.bash,
    description: `Run a ${shellName} command from the configured working directory and return its output.`,
    parameters: bashParams,
    executionMode: "sequential",
    execute: async (_id, params, signal, onUpdate): Promise<AgentToolResult> => {
      signal?.throwIfAborted();
      const cwd = createToolPathResolver(workingDirectory)(".");
      const executable = shellExecutable(commandShell);
      const args = powershell
        ? [
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            `[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; ${params.command}`,
          ]
        : ["--noprofile", "--norc", "-c", params.command];
      const timeoutSec = Math.max(
        COMMAND_TIMEOUT_MIN_SEC,
        Math.min(params.timeoutSec ?? COMMAND_TIMEOUT_DEFAULT_SEC, COMMAND_TIMEOUT_MAX_SEC),
      );
      const started = performance.now();
      const child = spawn(executable, args, {
        cwd,
        detached: process.platform !== "win32",
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      });
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
