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
