// @env node
import { existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import { directory } from "./files";
import type { ImportLocations } from "./types";

export function resolveImportLocations(
  home: string,
  settingsDir: string,
  skillsDir: string,
  project: string | null,
): ImportLocations {
  const workspace = project && isAbsolute(project) ? directory(project) : undefined;
  if (project && !workspace) throw new Error("无法读取所选项目目录。");
  const codexHome = process.env.CODEX_HOME || join(home, ".codex");
  const claudeHome = process.env.CLAUDE_CONFIG_DIR || join(home, ".claude");
  const customClaudeConfig = join(claudeHome, ".claude.json");
  return {
    home,
    codexHome,
    claudeHome,
    claudeConfig: existsSync(customClaudeConfig) ? customClaudeConfig : join(home, ".claude.json"),
    workspace,
    settingsDir,
    skillsDir,
  };
}
