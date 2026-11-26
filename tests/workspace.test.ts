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

import { previewWorkspaceReference, workspaceFileForEditor } from "../src/main/workspace/reference";
import { searchWorkspace } from "../src/main/workspace/search";

describe("workspace reference search", () => {
  it("finds files and folders by name or workspace-relative path", async () => {
    using fixture = mkdtempDisposableSync(join(tmpdir(), "pilot-workspace-search-"));
    const root = realpathSync(fixture.path);
    mkdirSync(join(root, "src", "reports"), { recursive: true });
    writeFileSync(join(root, "src", "reports", "季度 报告.md"), "sample");
    expect(await searchWorkspace(root, "")).toEqual([{ path: "src", kind: "directory" }]);
    expect(await searchWorkspace(root, "季度")).toEqual([
      { path: "src/reports/季度 报告.md", kind: "file" },
    ]);
    expect(await searchWorkspace(root, "SRC\\REPORTS")).toEqual([
      { path: "src/reports", kind: "directory" },
      { path: "src/reports/季度 报告.md", kind: "file" },
    ]);
  });

  it("stays inside the configured root and skips junctions and dependency directories", async () => {
    using fixture = mkdtempDisposableSync(join(tmpdir(), "pilot-workspace-scope-"));
    const workspace = join(fixture.path, "workspace");
    const outside = join(fixture.path, "outside");
    mkdirSync(outside);
    mkdirSync(join(workspace, "node_modules"), { recursive: true });
    mkdirSync(join(workspace, ".git"));
    writeFileSync(join(outside, "outside-only.md"), "sample");
    writeFileSync(join(workspace, "node_modules", "dependency-only.md"), "sample");
    writeFileSync(join(workspace, ".git", "git-only.md"), "sample");
    symlinkSync(outside, join(workspace, "external"), "junction");
    expect(await searchWorkspace(realpathSync(workspace), "only.md")).toEqual([]);
    expect(await searchWorkspace(realpathSync(workspace), "../outside")).toEqual([]);
    expect(await searchWorkspace(undefined, "only.md")).toEqual([]);
  });
});

it("previews local references and refuses paths outside their configured workspace", () => {
  using fixture = mkdtempDisposableSync(join(tmpdir(), "pilot-workspace-preview-"));
  const base = realpathSync(fixture.path);
  const root = join(base, "workspace");
  const outside = join(base, "other");
  mkdirSync(join(root, "src"), { recursive: true });
  mkdirSync(outside);
  const file = join(root, "src", "说明 文档.txt");
  writeFileSync(file, "第一行\n第二行\n");
  writeFileSync(join(root, "src", "asset.dat"), Buffer.from([0, 255]));
  writeFileSync(join(outside, "sample.txt"), "outside");
  symlinkSync(outside, join(root, "external"), "junction");
  expect(previewWorkspaceReference(root, { path: file, workingDirectory: root })).toEqual({
    kind: "file",
    path: "src/说明 文档.txt",
    text: "第一行\n第二行\n",
  });
  expect(workspaceFileForEditor(root, { path: "src/说明 文档.txt", workingDirectory: root })).toBe(
    file,
  );
  expect(previewWorkspaceReference(root, { path: "src/" })).toMatchObject({
    kind: "directory",
    entries: expect.arrayContaining([
      { kind: "file", path: "src/说明 文档.txt" },
      { kind: "file", path: "src/asset.dat" },
    ]),
  });
  expect(previewWorkspaceReference(root, { path: "src/asset.dat" })).toMatchObject({
    kind: "file",
    text: null,
  });
  for (const path of ["../other/sample.txt", "external/sample.txt", join(outside, "sample.txt")]) {
    expect(() => previewWorkspaceReference(root, { path })).toThrow("无法预览");
    expect(() => workspaceFileForEditor(root, { path })).toThrow("文件不可用");
  }
  expect(() => workspaceFileForEditor(root, { path: "src/" })).toThrow("文件不可用");
  expect(() => workspaceFileForEditor(root, { path: file, workingDirectory: outside })).toThrow(
    "工作目录已变更",
  );
  expect(() => previewWorkspaceReference(root, { path: "src", workingDirectory: outside })).toThrow(
    "工作目录已变更",
  );
  expect(() => previewWorkspaceReference(undefined, { path: file })).toThrow("请先选择工作目录");
});
