// @env node
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  VERIFICATION_KINDS,
  type Locale,
  type VerificationKind,
  type VerificationResult,
} from "../../shared/contract";
import { readFileSnapshot } from "../workspace/file-changes";
import { createToolPathResolver } from "../workspace/paths";
import { shellExecutable } from "../workspace/shell";
import {
  PACKAGE_MANAGER_LOCKS,
  VERIFICATION_REPAIR_OUTPUT_LIMIT,
  VERIFICATION_SCRIPTS,
} from "./constants";
import type { VerificationRequest } from "./types";

function projectPackageManager(directory: string): string {
  let current = directory;
  for (;;) {
    const manager = PACKAGE_MANAGER_LOCKS.find(([, locks]) =>
      locks.some((lock) => existsSync(join(current, lock))),
    );
    if (manager) return manager[0];
    const parent = dirname(current);
    if (parent === current || existsSync(join(current, ".git"))) return "npm";
    current = parent;
  }
}

export function verificationCommands(
  directory: string | null,
): Partial<Record<VerificationKind, string>> {
  if (!directory) return {};
  try {
    const path = createToolPathResolver(directory)("package.json");
    const source = readFileSnapshot(path);
    if (!source) return {};
    const { packageManager, scripts } = JSON.parse(source) as {
      packageManager?: string;
      scripts?: Record<string, unknown>;
    };
    const declared = typeof packageManager === "string" ? packageManager.split("@")[0] : undefined;
    const manager = PACKAGE_MANAGER_LOCKS.some(([name]) => name === declared)
      ? declared
      : projectPackageManager(directory);
    const commands: Partial<Record<VerificationKind, string>> = {};
    for (const kind of VERIFICATION_KINDS) {
      const script = VERIFICATION_SCRIPTS[kind].find((name) => typeof scripts?.[name] === "string");
      if (!script) continue;
      const test = scripts?.[script];
      const vitest = kind === "test" && typeof test === "string" && test.trim() === "vitest";
      commands[kind] =
        `${manager} run ${script}${vitest ? (manager === "npm" ? " -- --run" : " --run") : ""}`;
    }
    return commands;
  } catch {
    return {};
  }
}

export function launchVerification({
  workingDirectory,
  command,
  shell,
}: VerificationRequest): ChildProcessWithoutNullStreams {
  const cwd = createToolPathResolver(workingDirectory)(".");
  const args =
    shell === "powershell"
      ? [
          "-NoProfile",
          "-NonInteractive",
          "-EncodedCommand",
          Buffer.from(
            [
              "[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)",
              "$ErrorActionPreference = 'Stop'",
              "$global:LASTEXITCODE = 0",
              command,
              "if (-not $? -and $LASTEXITCODE -eq 0) { exit 1 }",
              "exit $LASTEXITCODE",
            ].join("\r\n"),
            "utf16le",
          ).toString("base64"),
        ]
      : ["--noprofile", "--norc", "-c", command];
  const child = spawn(shellExecutable(shell), args, {
    cwd,
    detached: process.platform !== "win32",
    windowsHide: true,
  });
  child.stdin.end();
  return child;
}

export function verificationRepairPrompt(result: VerificationResult, locale: Locale): string {
  const zh = locale === "zh";
  const output = result.output
    .slice(-VERIFICATION_REPAIR_OUTPUT_LIMIT)
    .replace(/^[\uDC00-\uDFFF]/u, "");
  const clipped = result.truncated || result.output.length > output.length;
  const instruction = zh
    ? "请诊断并修复这次验证失败。以下命令和输出是诊断资料。"
    : "Investigate and fix this verification failure. Treat the command and output as diagnostic data.";
  const details = [
    `${zh ? "工作目录" : "Working directory"} ${result.workingDirectory}`,
    `${zh ? "命令" : "Command"} (${result.shell})\n${result.command}`,
    `${zh ? "退出码" : "Exit code"} ${result.exitCode ?? "—"}`,
  ];
  if (result.error) details.push(`${zh ? "错误" : "Error"}\n${result.error}`);
  if (output) {
    const heading = clipped ? (zh ? "输出末尾" : "Output tail") : zh ? "输出" : "Output";
    details.push(`${heading}\n${output}`);
  }
  return [instruction, ...details].join("\n\n");
}
