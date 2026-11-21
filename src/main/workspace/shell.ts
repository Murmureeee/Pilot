// @env node
import { existsSync } from "node:fs";
import { delimiter, dirname, isAbsolute, join } from "node:path";
import type { CommandShell } from "../../shared/contract";

export function getCommandShell(shell?: CommandShell): CommandShell {
  return process.platform === "win32" && shell !== "bash" ? "powershell" : "bash";
}

export function shellExecutable(shell: CommandShell): string {
  if (shell === "powershell") return "powershell.exe";
  if (process.platform !== "win32") return "bash";
  const bash = findGitBash();
  if (!bash) throw new Error("找不到 Git Bash。请安装 Git for Windows，或切换到 PowerShell。");
  return bash;
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
