// @env node
import { execFile, spawn } from "node:child_process";
import { accessSync, constants, statSync } from "node:fs";
import { basename, delimiter, isAbsolute, join } from "node:path";
import { promisify } from "node:util";

const run = promisify(execFile);

function executable(path: string): boolean {
  try {
    accessSync(path, constants.X_OK);
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

async function findVsCode(): Promise<string | undefined> {
  const windows = process.platform === "win32";
  const command = windows ? "Code.exe" : "code";
  for (const entry of (process.env.PATH ?? "").split(delimiter)) {
    const directory = entry.replace(/^"|"$/g, "");
    if (!isAbsolute(directory)) continue;
    const path = join(directory, command);
    if (executable(path)) return path;
    const app = join(directory, "..", command);
    if (windows && basename(directory).toLowerCase() === "bin" && executable(app)) return app;
  }
  if (process.platform === "darwin") {
    const app = "/Applications/Visual Studio Code.app/Contents/Resources/app/bin/code";
    return executable(app) ? app : undefined;
  }
  if (windows) {
    const registry = join(process.env.SystemRoot ?? "C:\\Windows", "System32", "reg.exe");
    try {
      const { stdout } = await run(
        registry,
        ["query", "HKCR\\vscode\\shell\\open\\command", "/ve"],
        {
          windowsHide: true,
          timeout: 1500,
        },
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
}

export async function openVsCodeAtLine(path: string, line: number): Promise<void> {
  const editor = await findVsCode();
  if (!editor) throw new Error("无法打开 VS Code。请检查编辑器是否已安装。");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(editor, ["--goto", `${path}:${line}:1`], {
      detached: true,
      stdio: "ignore",
    });
    child.once("error", (cause) =>
      reject(new Error("无法打开 VS Code。请检查编辑器是否已安装。", { cause })),
    );
    child.once("spawn", () => {
      child.unref();
      resolve();
    });
  });
}
