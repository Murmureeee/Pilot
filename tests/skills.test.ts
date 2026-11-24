import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempDisposableSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  deleteSkillDirectory,
  importSkill,
  parseSkillMarkdown,
  readSkillFile,
  scanSkills,
} from "../src/main/agent-host/skills";

function makeSkillDir(root: string, id: string, content: string): void {
  mkdirSync(join(root, id), { recursive: true });
  writeFileSync(join(root, id, "SKILL.md"), content, "utf-8");
}

describe("skills (FR-5.8)", () => {
  it("parses frontmatter (name/description) and body", () => {
    const parsed = parseSkillMarkdown("t", "---\nname: 翻译\ndescription: 中英互译\n---\n正文指令");
    expect(parsed.name).toBe("翻译");
    expect(parsed.description).toBe("中英互译");
    expect(parsed.body).toBe("正文指令");
  });

  it("falls back to dir name and first line without frontmatter", () => {
    const parsed = parseSkillMarkdown("fallback", "第一行说明\n正文");
    expect(parsed.name).toBe("fallback");
    expect(parsed.description).toBe("第一行说明");
    expect(parsed.body).toBe("第一行说明\n正文");
  });

  it("scans skill dirs and merges enabled flags", () => {
    using root = mkdtempDisposableSync(join(tmpdir(), "pi-skills-"));
    makeSkillDir(root.path, "alpha", "---\nname: A\n---\nbody-a");
    makeSkillDir(root.path, "beta", "plain body");
    // 无 SKILL.md 的目录跳过
    mkdirSync(join(root.path, "empty"), { recursive: true });

    const list = scanSkills(root.path, ["beta"]);
    expect(list.map((s) => s.id)).toEqual(["alpha", "beta"]);
    expect(list.find((s) => s.id === "alpha")).toMatchObject({ name: "A", enabled: false });
    expect(list.find((s) => s.id === "beta")).toMatchObject({ enabled: true });
  });

  it("imports a skill dir and renames on conflict", () => {
    using root = mkdtempDisposableSync(join(tmpdir(), "pi-skills-dst-"));
    using src = mkdtempDisposableSync(join(tmpdir(), "pi-skills-src-"));
    // 导入的是"技能目录本身"（目录下直接放 SKILL.md）；目录名取源路径 basename，
    // mkdtemp 的随机后缀 → 断言只看行为（复制/重名后缀/正文完整）
    writeFileSync(join(src.path, "SKILL.md"), "hello body", "utf-8");

    const id1 = importSkill(src.path, root.path);
    expect(id1.startsWith("pi-skills-src-")).toBe(true);
    const id2 = importSkill(src.path, root.path);
    expect(id2.startsWith("pi-skills-src-")).toBe(true);
    expect(id2).not.toBe(id1);
    const list = scanSkills(root.path, [id1]);
    expect(readSkillFile(list.find((entry) => entry.id === id2)!)).toBe("hello body");
    expect(list.find((s) => s.id === id1)?.enabled).toBe(true);
  });

  it("rejects dirs without SKILL.md", () => {
    using root = mkdtempDisposableSync(join(tmpdir(), "pi-skills-dst-"));
    using src = mkdtempDisposableSync(join(tmpdir(), "pi-skills-src2-"));
    expect(() => importSkill(src.path, root.path)).toThrow(/SKILL.md/);
  });

  it("imports a linked skill from a Codex skills directory as a local copy", () => {
    using temp = mkdtempDisposableSync(join(tmpdir(), "pi-linked-skill-"));
    const library = join(temp.path, ".agents", "skills");
    mkdirSync(library, { recursive: true });
    makeSkillDir(temp.path, "source", "portable instructions");
    const linked = join(library, "shared-skill");
    symlinkSync(
      join(temp.path, "source"),
      linked,
      process.platform === "win32" ? "junction" : "dir",
    );

    const destination = join(temp.path, "imported");
    expect(importSkill(linked, destination)).toBe("shared-skill");
    const list = scanSkills(destination, ["shared-skill"]);
    expect(list).toMatchObject([{ id: "shared-skill", enabled: true }]);
    expect(readSkillFile(list[0])).toBe("portable instructions");
  });

  it("discovers both project sources and distinguishes identical directory names", () => {
    using fixture = mkdtempDisposableSync(join(tmpdir(), "pilot-skill-sources-"));
    const root = realpathSync(fixture.path);
    const installed = join(root, "installed");
    const project = join(root, "project");
    makeSkillDir(installed, "review", "Legacy body");
    makeSkillDir(
      join(project, ".agents", "skills"),
      "review",
      "\uFEFF---\r\nname: 'Agent Review'\r\ndescription: >-\r\n  Summarize\r\n  findings\r\n---\r\nAGENT_BODY",
    );
    makeSkillDir(join(project, ".claude", "skills"), "review", "CLAUDE_BODY");
    expect(scanSkills(installed, [], project)).toMatchObject([
      { id: "review", source: "installed", enabled: false, description: "" },
      {
        id: ".agents/skills/review",
        source: ".agents/skills",
        enabled: true,
        name: "Agent Review",
        description: "Summarize findings",
      },
      { id: ".claude/skills/review", source: ".claude/skills", enabled: true, description: "" },
    ]);
    expect(scanSkills(installed, ["review"], root)).toMatchObject([
      { id: "review", enabled: true },
    ]);
  });

  it("reads bundled files and rejects paths, hardlinks and junctions outside the selected skill", () => {
    using fixture = mkdtempDisposableSync(join(tmpdir(), "pilot-skill-files-"));
    const root = realpathSync(fixture.path);
    const installed = join(root, "skills");
    makeSkillDir(installed, "review", "Review instructions");
    makeSkillDir(installed, "other", "Outside the selected skill");
    const directory = join(installed, "review");
    const outside = join(installed, "other");
    mkdirSync(join(directory, "references"));
    writeFileSync(join(directory, "references", "check.txt"), "checklist");
    symlinkSync(outside, join(directory, "linked"), "junction");
    linkSync(join(outside, "SKILL.md"), join(directory, "hardlink.md"));
    const skill = scanSkills(installed, ["review"]).find(({ id }) => id === "review")!;
    expect(readSkillFile(skill, "./references/check.txt")).toBe("checklist");
    for (const path of [
      "../other/SKILL.md",
      "..\\other\\SKILL.md",
      join(outside, "SKILL.md"),
      "linked/SKILL.md",
      "hardlink.md",
      "references",
      "C:SKILL.md",
    ]) {
      expect(() => readSkillFile(skill, path)).toThrow("无法读取技能文件");
    }
    deleteSkillDirectory(skill);
    expect(existsSync(directory)).toBe(false);
    expect(existsSync(join(outside, "SKILL.md"))).toBe(true);
  });

  it("skips a project library linked outside the project", () => {
    using fixture = mkdtempDisposableSync(join(tmpdir(), "pilot-linked-project-skills-"));
    const root = realpathSync(fixture.path);
    const outside = join(root, "outside");
    makeSkillDir(outside, "separate", "Private skill");
    const project = join(root, "project");
    mkdirSync(join(project, ".agents"), { recursive: true });
    symlinkSync(outside, join(project, ".agents", "skills"), "junction");
    expect(scanSkills(join(root, "installed"), [], project)).toEqual([]);
  });
});
