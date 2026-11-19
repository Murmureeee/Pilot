import { mkdirSync, mkdtempDisposableSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  importSkill,
  loadSkillBody,
  parseSkillMarkdown,
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
    expect(loadSkillBody(root.path, id2)).toBe("hello body");
    expect(scanSkills(root.path, [id1]).find((s) => s.id === id1)?.enabled).toBe(true);
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
    expect(scanSkills(destination, ["shared-skill"])).toMatchObject([
      { id: "shared-skill", enabled: true },
    ]);
    expect(loadSkillBody(destination, "shared-skill")).toBe("portable instructions");
  });

  it("returns null body for unknown skill ids", () => {
    using root = mkdtempDisposableSync(join(tmpdir(), "pi-skills-none-"));
    expect(loadSkillBody(root.path, "nope")).toBeNull();
  });
});
