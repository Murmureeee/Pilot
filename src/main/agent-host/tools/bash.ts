// @env node
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, dirname, isAbsolute, join } from "node:path";
import type { AgentTool, AgentToolResult } from "@earendil-works/pi-agent-core";
import { int, obj, opt, str } from "@earendil-works/pi-schema";
import type { CommandShell } from "@shared/contract";
import { TOOL_LABELS } from "./constants";
import { normalizeWorkingDirectory, truncate } from "./paths";
import type { ToolEnvironment } from "./types";

const MAX_OUTPUT = 100_000;

const bashParams = obj({
  command: str({ description: "Command in the configured shell syntax." }),
  timeoutSec: opt(int({ description: "Timeout in seconds. Default 60, maximum 300." })),
});

export function getCommandShell(shell?: CommandShell): CommandShell {
  return process.platform === "win32" && shell !== "bash" ? "powershell" : "bash";
}

export function findGitBash(): string | undefined {
  const roots = [
    process.env.ProgramFiles && join(process.env.ProgramFiles, "Git"),
    process.env["ProgramFiles(x86)"] && join(process.env["ProgramFiles(x86)"], "Git"),
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "Programs", "Git"),
  ];
  for (const entry of (process.env.PATH ?? "").split(delimiter)) {
    const path = entry.replace(/^"|"$/g, "");
    if (isAbsolute(path) && existsSync(join(path, "git.exe"))) roots.push(dirname(path));
  }
  // System32 的 bash.exe 可能是 WSL 启动器，必须定位到 Git for Windows。
  for (const root of roots) {
    if (!root) continue;
    const bash = join(root, "bin", "bash.exe");
    if (existsSync(bash)) return bash;
  }
  return undefined;
}

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
      const cwd = workingDirectory ? normalizeWorkingDirectory(workingDirectory) : homedir();
      const executable = powershell
        ? "powershell.exe"
        : process.platform === "win32"
          ? findGitBash()
          : "bash";
      if (!executable)
        throw new Error("找不到 Git Bash。请安装 Git for Windows，或切换到 PowerShell。");
      const args = powershell
        ? [
            "-NoProfile",
            "-NonInteractive",
            "-Command",
            `[Console]::OutputEncoding=[System.Text.Encoding]::UTF8; ${params.command}`,
          ]
        : ["--noprofile", "--norc", "-c", params.command];
      const timeoutSec = Math.min(params.timeoutSec ?? 60, 300);

      return await new Promise<AgentToolResult>((resolveP, reject) => {
        const child = spawn(executable, args, { cwd, windowsHide: true });
        let output = "";
        const collect = (chunk: string): void => {
          output = (output + chunk).slice(-MAX_OUTPUT);
          onUpdate?.({ content: [{ type: "text", text: output }], details: {} });
        };
        child.stdout.setEncoding("utf8").on("data", collect);
        child.stderr.setEncoding("utf8").on("data", collect);

        const stop = (message: string): void => {
          clearTimeout(timer);
          child.kill();
          reject(new Error(truncate(`${message}\n输出:\n${output}`, 4000)));
        };
        const onAbort = (): void => stop("命令被用户中止");
        const timer = setTimeout(() => stop(`命令超时（${timeoutSec}s）`), timeoutSec * 1000);
        signal?.addEventListener("abort", onAbort, { once: true });

        const cleanup = (): void => {
          clearTimeout(timer);
          signal?.removeEventListener("abort", onAbort);
        };
        child.on("error", (error) => {
          cleanup();
          reject(error);
        });
        child.on("close", (code) => {
          cleanup();
          if (code === 0) {
            resolveP({ content: [{ type: "text", text: output || "(无输出)" }], details: {} });
          } else {
            reject(new Error(truncate(`命令失败（exit ${code}）\n输出:\n${output}`, 4000)));
          }
        });
      });
    },
  };
}
