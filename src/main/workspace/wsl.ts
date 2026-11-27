// @env node
import { execFile, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { homedir } from "node:os";
import { promisify } from "node:util";

import { wslProjectPath } from "../../shared/wsl-project";
import { WSL_COMMAND_SUPERVISOR, WSL_LIST_TIMEOUT_MS } from "./constants";
import { registerWslProcess } from "./process";
import type { WslLaunch } from "./types";

const exec = promisify(execFile);

export async function firstWslDistribution(): Promise<string> {
  if (process.platform !== "win32") throw new Error("WSL 项目需要 Windows。");
  let names: string[];
  try {
    const { stdout } = await exec("wsl.exe", ["--list", "--quiet"], {
      encoding: "buffer",
      env: { ...process.env, WSL_UTF8: "1" },
      timeout: WSL_LIST_TIMEOUT_MS,
      windowsHide: true,
    });
    names = stdout
      .toString(stdout.includes(0) ? "utf16le" : "utf8")
      .replace(/^\uFEFF/, "")
      .split(/\r?\n/)
      .map((line) => line.trim());
  } catch {
    throw new Error("无法读取 WSL 发行版。请检查 Windows 的 WSL 安装。");
  }
  const distribution = names.find(
    (name) => /^[a-z0-9][a-z0-9_.-]*$/i.test(name) && !/^docker-desktop(?:-data)?$/i.test(name),
  );
  if (!distribution) throw new Error("未找到可用的 WSL 发行版。请先安装用于开发的发行版。");
  return distribution;
}

export function wslLaunchSpec(
  directory: string | undefined,
  args: string[],
): WslLaunch | undefined {
  const project = wslProjectPath(directory);
  if (!project) return;
  return {
    executable: "wsl.exe",
    args: [
      "--distribution",
      project.distribution,
      "--cd",
      project.path,
      "--exec",
      "/bin/bash",
      ...args,
    ],
    cwd: homedir(),
  };
}

export function launchWslCommand(
  directory: string,
  command: string,
  environment?: NodeJS.ProcessEnv,
): ChildProcessWithoutNullStreams {
  const argumentsForBash = [
    "--noprofile",
    "--norc",
    "-c",
    WSL_COMMAND_SUPERVISOR,
    "pilot",
    command,
    environment?.PILOT_HOOK_EVENT ?? "",
    environment?.PILOT_HOOK_TOOL ?? "",
  ];
  const spec = wslLaunchSpec(directory, argumentsForBash);
  if (!spec) throw new Error("无法识别 WSL 项目路径。");
  const child = spawn(spec.executable, spec.args, {
    cwd: spec.cwd,
    env: { ...process.env, WSL_UTF8: "1" },
    windowsHide: true,
  });
  registerWslProcess(child);
  return child;
}
