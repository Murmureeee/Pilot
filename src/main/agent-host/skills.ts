// @env node
// 技能系统（FR-5.8 / FR-2.8 应用层）：userData/skills/<id>/SKILL.md，
// frontmatter（name/description）+ 正文 = 给模型的指令。
// 扫描 / 导入 / 读正文在主进程完成；启停状态持久化在 settings.skillsEnabled；
// 注入 = host 组装 systemPrompt 时把启用技能的正文作为 sections 拼接（下一轮请求生效）。
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, realpathSync } from "node:fs";
import { basename, join } from "node:path";
import type { SkillMeta } from "@shared/contract";

/** 解析 SKILL.md：frontmatter（--- 包裹的 name/description）+ 正文；无 frontmatter 时 name=目录名、description=首行 */
export function parseSkillMarkdown(
  dirName: string,
  raw: string,
): { name: string; description: string; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(raw);
  if (match) {
    const meta: Record<string, string> = {};
    for (const line of match[1].split(/\r?\n/)) {
      const kv = /^(\w[\w-]*):\s*(.*)$/.exec(line.trim());
      if (kv) meta[kv[1]] = kv[2].trim();
    }
    const body = raw.slice(match[0].length).trim();
    return {
      name: meta.name || dirName,
      description: meta.description || body.split("\n")[0]?.slice(0, 80) || "",
      body,
    };
  }
  const trimmed = raw.trim();
  return {
    name: dirName,
    description: trimmed.split("\n")[0]?.slice(0, 80) || "",
    body: trimmed,
  };
}

/** 扫描技能目录：一级子目录下的 SKILL.md（没有 SKILL.md 的目录跳过） */
export function scanSkills(skillsDir: string, enabledIds: readonly string[]): SkillMeta[] {
  if (!existsSync(skillsDir)) return [];
  const metas: SkillMeta[] = [];
  for (const entry of readdirSync(skillsDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillFile = join(skillsDir, entry.name, "SKILL.md");
    if (!existsSync(skillFile)) continue;
    try {
      const parsed = parseSkillMarkdown(entry.name, readFileSync(skillFile, "utf-8"));
      metas.push({
        id: entry.name,
        name: parsed.name,
        description: parsed.description,
        enabled: enabledIds.includes(entry.name),
      });
    } catch (error) {
      console.error(`[skills] 解析失败 ${entry.name}:`, error);
    }
  }
  return metas.sort((a, b) => a.id.localeCompare(b.id));
}

/** 读取单个技能的正文（host 注入 systemPrompt 用；不存在返回 null） */
export function loadSkillBody(skillsDir: string, id: string): string | null {
  const skillFile = join(skillsDir, id, "SKILL.md");
  if (!existsSync(skillFile)) return null;
  try {
    return parseSkillMarkdown(id, readFileSync(skillFile, "utf-8")).body;
  } catch (error) {
    console.error(`[skills] 读取正文失败 ${id}:`, error);
    return null;
  }
}

export function skillSection(name: string, body: string): string {
  return `## 技能：${name}\n\n${body}`;
}

/** 导入本地技能目录（复制整个目录）；重名自动加 -2/-3 后缀；返回新技能 id，取消/失败抛异常 */
export function importSkill(srcDir: string, skillsDir: string): string {
  if (!existsSync(srcDir)) throw new Error("源目录不存在");
  if (!existsSync(join(srcDir, "SKILL.md"))) {
    throw new Error("所选目录不含 SKILL.md，不是有效技能");
  }
  mkdirSync(skillsDir, { recursive: true });
  const base = basename(srcDir);
  let id = base;
  for (let n = 2; existsSync(join(skillsDir, id)); n++) id = `${base}-${n}`;
  // Codex can discover a skill through a directory link. Install the target as a local copy.
  cpSync(realpathSync(srcDir), join(skillsDir, id), { recursive: true });
  return id;
}
