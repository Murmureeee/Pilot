// @env node
import { execFile, spawn } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, delimiter, isAbsolute, join } from "node:path";
import { promisify } from "node:util";

import { DEFAULT_EXTERNAL_EDITOR } from "../../shared/constants";
import type { ExternalEditor } from "../../shared/contract";
import { CODE_EDITOR_PRESETS, EDITOR_NOT_FOUND, EDITOR_START_FAILED } from "./constants";

const run = promisify(execFile);
const windows = process.platform === "win32";
const windowsProgram = /\.(exe|com)$/i;

function executable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

function findOnPath(command: string, allowAppBin = false): string | undefined {
  for (const entry of (process.env.PATH ?? "").split(delimiter)) {
    const directory = entry.replace(/^"(.*)"$/, "$1");
    if (!isAbsolute(directory)) continue;
    const path = join(directory, command);
    if (executable(path)) return path;
    if (allowAppBin && basename(directory).toLowerCase() === "bin") {
      const app = join(directory, "..", command);
      if (executable(app)) return app;
    }
  }
}

function findCustomLauncher(command: string): string | undefined {
  const program = command.replace(/^"(.*)"$/, "$1");
  if (isAbsolute(program)) {
    return (!windows || windowsProgram.test(program)) && executable(program) ? program : undefined;
  }
  // A relative launcher would depend on the shell that opened Pilot.
  if (!program || program === "." || program === ".." || /[/\\:]/.test(program)) return;
  return findOnPath(windows && !windowsProgram.test(program) ? program + ".exe" : program);
}

async function findPresetLauncher(
  kind: keyof typeof CODE_EDITOR_PRESETS,
): Promise<string | undefined> {
  const preset = CODE_EDITOR_PRESETS[kind];
  const command = windows ? preset.windowsExe : preset.command;
  const launcher = findOnPath(command, windows);
  if (launcher) return launcher;
  if (process.platform === "darwin") {
    return ["/Applications", join(homedir(), "Applications")]
      .map((directory) =>
        join(directory, preset.macBundle, "Contents", "Resources", "app", "bin", command),
      )
      .find(executable);
  }
  if (!windows) return;

  const installed = [
    process.env.LOCALAPPDATA && join(process.env.LOCALAPPDATA, "Programs"),
    process.env.ProgramFiles,
    process.env["ProgramFiles(x86)"],
  ]
    .filter((directory): directory is string => Boolean(directory && isAbsolute(directory)))
    .map((directory) => join(directory, preset.windowsFolder, command))
    .find(executable);
  if (installed) return installed;

  const registry = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "reg.exe");
  try {
    const { stdout } = await run(
      registry,
      ["query", "HKCR\\" + kind + "\\shell\\open\\command", "/ve"],
      { windowsHide: true, timeout: 1500 },
    );
    const editor = /REG_(?:EXPAND_)?SZ\s+"([^"]+)"/i.exec(stdout)?.[1];
    if (
      editor &&
      isAbsolute(editor) &&
      basename(editor).toLowerCase() === command.toLowerCase() &&
      executable(editor)
    )
      return editor;
  } catch {
    return undefined;
  }
}

function editorArguments(editor: ExternalEditor, path: string, line?: number): string[] {
  if (editor.kind === "custom") {
    return editor.args.map((argument) =>
      argument.replace(/\{file\}|\{line\}/g, (token) =>
        token === "{file}" ? path : String(line ?? 1),
      ),
    );
  }
  if (line === undefined) return [path];
  if (editor.kind === "jetbrains") return ["--line", String(line), path];
  return ["--goto", path + ":" + line + ":1"];
}

export async function openExternalEditor(
  path: string,
  line: number | undefined,
  editor: ExternalEditor = DEFAULT_EXTERNAL_EDITOR,
): Promise<void> {
  const launcher =
    "command" in editor
      ? findCustomLauncher(editor.command)
      : await findPresetLauncher(editor.kind);
  if (!launcher) throw new Error(EDITOR_NOT_FOUND);
  await new Promise<void>((resolve, reject) => {
    const child = spawn(launcher, editorArguments(editor, path, line), {
      cwd: homedir(),
      detached: true,
      stdio: "ignore",
    });
    child.once("error", (cause) => reject(new Error(EDITOR_START_FAILED, { cause })));
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}
