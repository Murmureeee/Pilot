// @env node
import { isAbsolute, relative } from "node:path";

import type { CommandDanger, CommandShell } from "@shared/contract";

import { createToolPathResolver } from "../workspace/paths";
import { inspectShellCommand } from "./command-scope";
import {
  CMD_DELETE_COMMANDS,
  COMMAND_INTRODUCERS,
  COMMAND_SUBSTITUTION_LIMIT,
  COMMAND_WRAPPERS,
  DELETE_COMMANDS,
  DISK_COMMANDS,
  DOWNLOAD_COMMANDS,
  DRIVE_MOUNT_PATH,
  GIT_GLOBAL_OPTIONS_WITH_VALUE,
  LOCATION_COMMANDS,
  POWERSHELL_DELETE_OPTIONS_WITH_VALUE,
  STREAM_EXECUTORS,
  SYSTEM_COMMANDS,
  UNSAFE_DELETE_TARGET,
  WINDOWS_DRIVE,
  WRAPPER_OPTIONS_WITH_VALUE,
} from "./constants";
import type { ToolEnvironment } from "./tools/types";
import type { ShellArgument, ShellPipeline } from "./types";

function commandName(word: ShellArgument | undefined): string {
  return (
    word
      ?.split(/[\\/]/)
      .at(-1)
      ?.replace(/\.(exe|cmd|bat|ps1)$/i, "")
      .toLowerCase() ?? ""
  );
}

function invocation(words: ShellArgument[]): ShellArgument[] {
  let index = 0;
  while (index < words.length) {
    const word = words[index];
    if (!word) break;
    const name = commandName(word);
    if (COMMAND_WRAPPERS.has(name)) {
      index++;
      while (words[index]?.startsWith("-")) {
        const option = words[index++];
        if (option === "--") break;
        if (option && WRAPPER_OPTIONS_WITH_VALUE.has(option)) index++;
      }
    } else if (COMMAND_INTRODUCERS.has(name) || /^[a-z_]\w*=/i.test(word)) {
      index++;
    } else {
      break;
    }
  }
  return words.slice(index);
}

function gitDanger(args: ShellArgument[]): CommandDanger | undefined {
  let index = 0;
  while (args[index]?.startsWith("-")) {
    const option = args[index++];
    if (option === "--") break;
    if (option && GIT_GLOBAL_OPTIONS_WITH_VALUE.has(option)) index++;
  }
  const subcommand = args[index];
  const options = args.slice(index + 1);
  const endOfOptions = options.indexOf("--");
  const flags = endOfOptions === -1 ? options : options.slice(0, endOfOptions);

  switch (subcommand?.toLowerCase()) {
    case "push":
      if (
        flags.some((arg) => arg && /^(?:--force$|--force-with-lease(?:=|$)|-[^-]*f)/.test(arg)) ||
        options.some((arg) => arg?.startsWith("+"))
      )
        return "git-force-push";
      break;
    case "reset":
      if (flags.includes("--hard")) return "git-hard-reset";
      break;
    case "clean":
      return "git-clean";
    case "checkout":
      if (
        endOfOptions !== -1 &&
        options.slice(endOfOptions + 1).some((arg) => arg === "." || arg === "./" || arg === ".\\")
      )
        return "git-checkout-files";
      break;
  }
  if (
    subcommand === null ||
    (["push", "reset", "checkout"].includes(subcommand?.toLowerCase() ?? "") &&
      options.includes(null))
  )
    return "git-dynamic";
  return undefined;
}

function isStreamExecutor(name: string, args: ShellArgument[]): boolean {
  if (STREAM_EXECUTORS.has(name)) return true;
  return /^(?:node|python[23]?)$/.test(name) && (args.length === 0 || args[0] === "-");
}

function pathInProject(
  target: ShellArgument,
  { workingDirectory, commandShell }: ToolEnvironment,
  changedLocation: boolean,
): string | undefined {
  if (!workingDirectory || !target || UNSAFE_DELETE_TARGET.test(target)) return undefined;
  let local = target;
  if (process.platform === "win32" && commandShell === "bash" && local.startsWith("/")) {
    if (!DRIVE_MOUNT_PATH.test(local)) return undefined;
    local = local.replace(DRIVE_MOUNT_PATH, "$1:/");
  }
  const parts = local.split(/[\\/]/);
  // Normalizing .. before resolving a symlink can hide a different effective parent.
  const independentOfLocation =
    process.platform === "win32" ? /^(?:[a-z]:[\\/]|[\\/]{2})/i.test(local) : isAbsolute(local);
  if (parts.includes("..") || (changedLocation && !independentOfLocation)) return undefined;
  if (
    process.platform === "win32" &&
    (local.replace(WINDOWS_DRIVE, "").includes(":") ||
      (WINDOWS_DRIVE.test(local) && !isAbsolute(local)) ||
      parts.some((part) => part !== "." && /[. ]$/.test(part)))
  )
    return undefined;
  try {
    return createToolPathResolver(workingDirectory)(local);
  } catch {
    return undefined;
  }
}

function deletionDanger(
  name: string,
  args: ShellArgument[],
  environment: ToolEnvironment,
  changedLocation: boolean,
): CommandDanger | undefined {
  const mayUseCmdFlags = CMD_DELETE_COMMANDS.has(name);
  const powershell = environment.commandShell === "powershell";
  const targets: ShellArgument[] = [];
  let recursive = false;
  let force = false;
  let flags = true;
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    const word = arg?.toLowerCase().replace(/^[\u2013-\u2015]/, "-");
    if (flags && word === "--") {
      flags = false;
    } else if (
      flags &&
      word &&
      (word.startsWith("-") || (mayUseCmdFlags && /^\/[sq]$/.test(word)))
    ) {
      const flag = word.split(":", 1)[0];
      recursive ||= /^(?:--recursive|-r|-re|-rec|-recu|-recur|-recurs|-recurse|\/s)$/.test(flag);
      force ||= /^(?:--force|-f|-fo|-for|-forc|-force|\/q)$/.test(flag);
      if (/^-[dfriv]+$/i.test(arg ?? "")) {
        recursive ||= flag.includes("r");
        force ||= flag.includes("f");
      }
      if (
        powershell &&
        /^-(?:path|literalpath|pspath|lp|pa|lit)/.test(flag) &&
        arg?.includes(":")
      ) {
        targets.push(arg.slice(arg.indexOf(":") + 1));
      } else if (powershell && POWERSHELL_DELETE_OPTIONS_WITH_VALUE.has(flag) && word === flag) {
        index++;
      }
    } else {
      targets.push(arg);
    }
  }

  if (recursive || targets.includes(null)) {
    const paths = targets.map((target) => pathInProject(target, environment, changedLocation));
    if (!paths.length || paths.includes(undefined)) return "recursive-delete-outside-project";
    if (
      force ||
      paths.some(
        (path) =>
          path && environment.workingDirectory && !relative(environment.workingDirectory, path),
      )
    )
      return "forced-delete";
  }
  if (mayUseCmdFlags && args.some((arg) => /^\/q$/i.test(arg ?? ""))) return "forced-delete";
  return undefined;
}

function inlineShell(name: string, args: ShellArgument[]): [CommandShell, string] | undefined {
  const powershell = name === "powershell" || name === "pwsh";
  const bash = /^(?:bash|sh|zsh|dash|ksh)$/.test(name);
  if (!powershell && !bash && name !== "cmd") return undefined;
  let index = -1;
  if (powershell) index = args.findIndex((arg) => /^-(?:c|command)$/i.test(arg ?? ""));
  else if (bash) index = args.findIndex((arg) => /^-[a-z]*c[a-z]*$/.test(arg ?? ""));
  else index = args.findIndex((arg) => /^\/[ck]$/i.test(arg ?? ""));
  if (index === -1) return undefined;
  const script = args[index + 1];
  if (!script) return undefined;
  return [
    powershell || name === "cmd" ? "powershell" : "bash",
    name === "cmd" ? args.slice(index + 1).join(" ") : script,
  ];
}

export function findCommandDanger(
  command: string,
  environment: ToolEnvironment,
  depth = 0,
  inheritedLocationChange = false,
): CommandDanger | undefined {
  if (depth > COMMAND_SUBSTITUTION_LIMIT) return undefined;
  const downloads = new Set<ShellPipeline>();
  let changedLocation = inheritedLocationChange;
  for (const part of inspectShellCommand(command, environment.commandShell)) {
    const words = invocation(part.args);
    const [head, ...args] = words;
    const wrapperOptions = part.args.slice(0, part.args.length - words.length);
    const effectiveLocationChanged =
      changedLocation || wrapperOptions.some((arg) => /^(?:-C|-D|--chdir(?:=|$))/.test(arg ?? ""));
    const name = commandName(head);
    if (DOWNLOAD_COMMANDS.has(name)) {
      for (
        let pipeline: ShellPipeline | undefined = part.pipeline;
        pipeline;
        pipeline = pipeline.output
      )
        downloads.add(pipeline);
    } else if (downloads.has(part.pipeline) && isStreamExecutor(name, args))
      return "download-and-execute";
    if (name === "git") {
      const reason = gitDanger(args);
      if (reason) return reason;
    }
    if (DISK_COMMANDS.has(name) || /^mkfs(?:\.|$)/.test(name)) return "disk-operation";
    if (
      SYSTEM_COMMANDS.has(name) ||
      (name === "reg" && /^(?:add|delete)$/i.test(args[0] ?? "")) ||
      (name === "set-itemproperty" &&
        args.some((arg) => /^(?:hklm|hkcu|hkey_|registry::)/i.test(arg ?? "")))
    )
      return "system-operation";
    if (DELETE_COMMANDS.has(name)) {
      const reason = deletionDanger(name, args, environment, effectiveLocationChanged);
      if (reason) return reason;
    }
    const nested = inlineShell(name, args);
    if (nested) {
      const [shell, script] = nested;
      const reason = findCommandDanger(
        script,
        { ...environment, commandShell: shell },
        depth + 1,
        effectiveLocationChanged,
      );
      if (reason) return reason;
    }
    if (LOCATION_COMMANDS.has(name) || /^[a-z]:$/.test(name)) changedLocation = true;
  }
  return undefined;
}
