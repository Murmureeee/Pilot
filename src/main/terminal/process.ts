// @env node
import { createRequire } from "node:module";

import type { CommandShell, TerminalSize } from "../../shared/contract";
import { stopProcessTree } from "../workspace/process";
import { launchCommand, shellExecutable } from "../workspace/shell";
import { wslLaunchSpec } from "../workspace/wsl";
import type { TerminalExit, TerminalProcess } from "./types";

const requireNative = createRequire(__filename);

export function launchInteractiveShell(
  shell: CommandShell,
  cwd: string,
  size: TerminalSize,
  append: (data: string) => void,
): TerminalProcess {
  const args =
    shell === "powershell"
      ? [
          "-NoLogo",
          "-NoProfile",
          "-NoExit",
          "-Command",
          "[Console]::OutputEncoding = [Console]::InputEncoding = [Text.UTF8Encoding]::new($false)",
        ]
      : ["--noprofile", "--norc", "-i"];
  const wsl = wslLaunchSpec(cwd, args);
  const { spawn } = requireNative("@lydell/node-pty") as typeof import("@lydell/node-pty");
  const pty = spawn(wsl?.executable ?? shellExecutable(shell), wsl?.args ?? args, {
    cwd: wsl?.cwd ?? cwd,
    cols: size.columns,
    rows: size.rows,
    name: "xterm-256color",
    env: { ...process.env, TERM: "xterm-256color", ...(wsl && { WSL_UTF8: "1" }) },
    ...(process.platform === "win32" ? { useConptyDll: true } : {}),
  });
  const completion = Promise.withResolvers<TerminalExit>();
  const output = pty.onData(append);
  const exit = pty.onExit(({ exitCode }) => {
    output.dispose();
    exit.dispose();
    completion.resolve({ exitCode });
  });
  return {
    done: completion.promise,
    stop: () => pty.kill(),
    write: (data) => pty.write(data),
    resize: ({ columns, rows }) => pty.resize(columns, rows),
  };
}

export function launchBackgroundCommand(
  shell: CommandShell,
  cwd: string,
  command: string,
  append: (data: string) => void,
): TerminalProcess {
  const child = launchCommand(shell, cwd, command);
  const startup = Promise.withResolvers<void>();
  const completion = Promise.withResolvers<TerminalExit>();
  let error: string | undefined;
  child.stdout.setEncoding("utf8").on("data", append);
  child.stderr.setEncoding("utf8").on("data", append);
  child.once("spawn", startup.resolve);
  child.on("error", (cause) => {
    error = cause.message;
    startup.reject(cause);
  });
  child.once("close", (code, signal) => {
    completion.resolve({ exitCode: code ?? undefined, error: error ?? signal ?? undefined });
  });
  return {
    done: completion.promise,
    ready: startup.promise,
    stop: () => stopProcessTree(child),
  };
}
