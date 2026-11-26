// @env node
import {
  existsSync,
  mkdirSync,
  mkdtempDisposableSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, it } from "vitest";

import { MemoryChanges } from "../src/main/agent-host/memory";
import { loadProjectInstructions } from "../src/main/agent-host/project-instructions";
import type { Settings } from "../src/main/settings/types";

function fixture(): {
  memory: MemoryChanges;
  getSettings: () => Settings;
  saveSettings: (next: Settings) => void;
} {
  let settings: Settings = { providers: [], activeProviderId: "none" };
  const getSettings = (): Settings => settings;
  const saveSettings = (next: Settings): void => {
    settings = next;
  };
  return { memory: new MemoryChanges({ getSettings, saveSettings }), getSettings, saveSettings };
}

it("previews a new project instruction, creates it after confirmation, and undoes the creation", () => {
  using scratch = mkdtempDisposableSync(join(tmpdir(), "pilot-memory-create-"));
  const root = realpathSync.native(scratch.path);
  const filename = join(root, "AGENTS.md");
  const { memory } = fixture();
  const preview = memory.preview("chat", root, "project", "Use pnpm.");
  expect(preview.path).toBe(filename);
  expect(preview.diff.hunks.flat()).toMatchObject([{ kind: "added", text: "Use pnpm." }]);
  expect(existsSync(filename)).toBe(false);
  expect(() => memory.save("other", preview.token, root)).toThrow("请重新预览差异");
  expect(() => memory.save("chat", preview.token, undefined)).toThrow("请重新预览差异");
  memory.save("chat", preview.token, root);
  expect(loadProjectInstructions(root)).toMatchObject({ body: "Use pnpm." });
  expect(() => memory.save("chat", preview.token, root)).toThrow("请重新预览差异");
  expect(() => memory.preview("chat", root, "project", "Use pnpm.")).toThrow("记忆已存在");
  memory.undo("chat", preview.token, root);
  expect(existsSync(filename)).toBe(false);
});

it("appends to CLAUDE.md while preserving its BOM and CRLF, and detects competing file edits", () => {
  using scratch = mkdtempDisposableSync(join(tmpdir(), "pilot-memory-files-"));
  const root = realpathSync.native(scratch.path);
  const agents = join(root, "AGENTS.md");
  const claude = join(root, "CLAUDE.md");
  const before = "\uFEFF# Conventions\r\n\r\nUse the test fixture.\r\n";
  writeFileSync(claude, before);
  const { memory } = fixture();
  const preview = memory.preview("chat", root, "project", "Review each change.");
  expect(preview.path).toBe(claude);
  memory.save("chat", preview.token, root);
  expect(readFileSync(claude, "utf8")).toBe(before + "\r\nReview each change.\r\n");
  memory.undo("chat", preview.token, root);
  expect(readFileSync(claude, "utf8")).toBe(before);

  const outdated = memory.preview("chat", root, "project", "Review each change.");
  writeFileSync(agents, "New instructions\n");
  expect(() => memory.save("chat", outdated.token, root)).toThrow("请重新预览差异");
  expect(readFileSync(claude, "utf8")).toBe(before);
  const refreshed = memory.preview("chat", root, "project", "Review each change.");
  expect(refreshed.path).toBe(agents);
  memory.save("chat", refreshed.token, root);
  writeFileSync(agents, "Another editor saved this file.\n");
  expect(() => memory.undo("chat", refreshed.token, root)).toThrow("已有后续改动");
  expect(readFileSync(agents, "utf8")).toBe("Another editor saved this file.\n");
});

it("binds global memory to the previewed persona and leaves unrelated settings intact", () => {
  const { memory, getSettings, saveSettings } = fixture();
  expect(() => memory.preview("draft", undefined, "project", "Use concise replies.")).toThrow(
    "请先打开项目",
  );
  saveSettings({ ...getSettings(), persona: "Prefer code examples." });
  const preview = memory.preview("draft", undefined, "global", "Use concise replies.");
  expect(preview.path).toBeNull();
  expect(getSettings().persona).toBe("Prefer code examples.");
  saveSettings({ ...getSettings(), notificationsEnabled: false });
  memory.save("draft", preview.token, undefined);
  expect(getSettings().persona).toBe("Prefer code examples.\n\nUse concise replies.\n");
  memory.undo("draft", preview.token, undefined);
  expect(getSettings()).toMatchObject({
    persona: "Prefer code examples.",
    notificationsEnabled: false,
  });

  const outdated = memory.preview("draft", undefined, "global", "Use concise replies.");
  saveSettings({ ...getSettings(), persona: "New personalization" });
  expect(() => memory.save("draft", outdated.token, undefined)).toThrow("请重新预览差异");
  const refreshed = memory.preview("draft", undefined, "global", "Use concise replies.");
  memory.save("draft", refreshed.token, undefined);
  saveSettings({ ...getSettings(), persona: "Later personalization" });
  expect(() => memory.undo("draft", refreshed.token, undefined)).toThrow("已有后续改动");
  expect(getSettings().persona).toBe("Later personalization");
});

it("refuses to write through an unreviewable instruction file or a directory link", () => {
  using scratch = mkdtempDisposableSync(join(tmpdir(), "pilot-memory-link-"));
  const root = realpathSync.native(scratch.path);
  const project = join(root, "project");
  const outside = join(root, "other");
  mkdirSync(project);
  mkdirSync(outside);
  writeFileSync(join(project, "CLAUDE.md"), "Existing Claude instructions");
  symlinkSync(outside, join(project, "AGENTS.md"), "junction");
  const { memory } = fixture();
  expect(() => memory.preview("chat", project, "project", "Review.")).toThrow("无法预览项目指令");
  expect(readFileSync(join(project, "CLAUDE.md"), "utf8")).toBe("Existing Claude instructions");
});
