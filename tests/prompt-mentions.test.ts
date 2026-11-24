// @env node
import {
  mkdirSync,
  mkdtempDisposableSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import { legacyMentionParts, prepareMentionPrompt } from "../src/main/agent-host/mentions";
import { MENTION_CONTEXT_HEADING } from "../src/shared/constants";
import type { PromptMention } from "../src/shared/contract";
import { mentionToken } from "../src/shared/mentions";

describe("agent prompt mentions", () => {
  it("describes selected files and keeps installed skill instructions separate from text", () => {
    using fixture = mkdtempDisposableSync(join(tmpdir(), "pilot-prompt-mentions-"));
    const workspace = realpathSync(fixture.path);
    mkdirSync(join(workspace, "src"));
    writeFileSync(join(workspace, "src", "index.ts"), "sample");
    const skillsDir = join(workspace, "skills");
    const reviewDir = join(skillsDir, "review");
    mkdirSync(reviewDir, { recursive: true });
    writeFileSync(join(reviewDir, "SKILL.md"), "---\nname: Code review\n---\nReview the code.");
    const file: PromptMention = {
      type: "file",
      id: "src/index.ts",
      label: "index.ts",
      meta: { workingDirectory: workspace },
    };
    const skill: PromptMention = {
      type: "skill",
      id: "review",
      label: "Draft name",
      meta: { description: "Draft description" },
    };
    const text = `Review ${mentionToken(file)} using ${mentionToken(skill)}. Another reference: ${mentionToken(file)}`;
    const result = prepareMentionPrompt(
      { text, mentions: [file, skill, file, skill] },
      (dir) => dir === workspace,
      skillsDir,
    );
    expect(result.text).toBe(text);
    const context = result.reference?.context;
    expect(context?.match(/File "src\/index\.ts"/g)).toHaveLength(1);
    expect(context).toContain('Use skill "Code review"');
    expect(context).not.toContain("Review the code.");
    expect(context).not.toContain("Draft description");
    expect(context).not.toContain(workspace);
    const filePart = {
      type: "mention",
      kind: "file",
      id: file.id,
      label: file.label,
      workingDirectory: workspace,
    };
    expect(result.reference?.parts).toEqual([
      { type: "text", text: "Review " },
      filePart,
      { type: "text", text: " using " },
      { type: "mention", kind: "skill", id: skill.id, label: "Code review" },
      { type: "text", text: ". Another reference: " },
      filePart,
    ]);
    const ordinary = `Review this literal ${mentionToken(file)} then open `;
    expect(
      prepareMentionPrompt(
        { text: ordinary + mentionToken(file), mentions: [{ ...file, offset: ordinary.length }] },
        () => true,
        skillsDir,
      ).reference?.parts,
    ).toEqual([{ type: "text", text: ordinary }, filePart]);
    expect(result.skillInstructions).toEqual(["## 技能：Code review\n\nReview the code."]);
    expect(prepareMentionPrompt({ text, mentions: [] }, () => false, skillsDir)).toEqual({
      text,
      skillInstructions: [],
    });
  });

  it("restores chips from the generated legacy appendix and preserves ordinary prose", () => {
    const id = "src/report 100% [draft].md";
    const token = mentionToken({ type: "file", id });
    const folder = "@[directory:src]";
    const text = `查看 ${token} 和 ${folder}`;
    const suffix = `\n\n${MENTION_CONTEXT_HEADING}\n- ${token}: File ${JSON.stringify(id)}\n- ${folder}: Folder "src"`;
    expect(legacyMentionParts(text + suffix)).toEqual([
      { type: "text", text: "查看 " },
      { type: "mention", kind: "file", id, label: "report 100% [draft].md" },
      { type: "text", text: " 和 " },
      { type: "mention", kind: "directory", id: "src", label: "src" },
    ]);
    expect(legacyMentionParts(text)).toBeUndefined();
    expect(legacyMentionParts(text + suffix + "\nMore discussion")).toBeUndefined();
  });

  it("rejects replaced workspaces, escaped paths, unavailable skills, and missing inline tokens", () => {
    using fixture = mkdtempDisposableSync(join(tmpdir(), "pilot-prompt-mention-scope-"));
    const workspace = join(realpathSync(fixture.path), "workspace");
    const outside = join(realpathSync(fixture.path), "outside");
    const skillsDir = join(fixture.path, "skills");
    mkdirSync(workspace);
    mkdirSync(outside);
    writeFileSync(join(outside, "outside.txt"), "sample");
    symlinkSync(outside, join(workspace, "external"), "junction");
    const file: PromptMention = {
      type: "file",
      id: "missing.txt",
      label: "file",
      meta: { workingDirectory: workspace },
    };
    const check = (mention: PromptMention, accepts = true): void => {
      prepareMentionPrompt(
        { text: mentionToken(mention), mentions: [mention] },
        () => accepts,
        skillsDir,
      );
    };
    expect(() => check(file, false)).toThrow("工作目录已变更");
    for (const id of [
      file.id,
      "../outside/outside.txt",
      "external/outside.txt",
      join(outside, "outside.txt"),
    ]) {
      expect(() => check({ ...file, id })).toThrow("所选文件或文件夹已不可用");
    }
    expect(() =>
      check({ type: "skill", id: "missing", label: "Skill", meta: { description: "" } }),
    ).toThrow("所选技能已不可用");
    expect(() =>
      prepareMentionPrompt({ text: "Text only", mentions: [file] }, () => true, skillsDir),
    ).toThrow("消息中的引用已变更");
    expect(() =>
      prepareMentionPrompt(
        { text: mentionToken(file), mentions: [{ ...file, offset: 1 }] },
        () => true,
        skillsDir,
      ),
    ).toThrow("消息中的引用已变更");
  });
});
