import {
  mkdirSync,
  mkdtempDisposableSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createTools } from "../src/main/agent-host/tools";
import { createBashTool } from "../src/main/agent-host/tools/bash";
import {
  createEditFileTool,
  createReadFileTool,
  createWriteFileTool,
} from "../src/main/agent-host/tools/file-tools";
import { createToolPathResolver } from "../src/main/workspace/paths";
import { findGitBash, getCommandShell } from "../src/main/workspace/shell";
import { createGlobTool, createGrepTool } from "../src/main/agent-host/tools/search-tools";

const resolvePath = createToolPathResolver();
const bashTool = createBashTool({ commandShell: getCommandShell() });
const readFileTool = createReadFileTool(resolvePath);
const writeFileTool = createWriteFileTool(resolvePath);
const editFileTool = createEditFileTool(resolvePath);
const globTool = createGlobTool(resolvePath);
const grepTool = createGrepTool(resolvePath);

function textOf(result: { content: Array<{ type: string; text?: string }> }): string {
  return result.content.map((b) => b.text ?? "").join("");
}

describe("file tools", () => {
  it("write → read → edit round-trips", async () => {
    using workspace = mkdtempDisposableSync(join(tmpdir(), "pi-tools-"));
    const file = join(workspace.path, "a.txt");

    const written = await writeFileTool.execute("t1", { path: file, content: "hello world" });
    expect(textOf(written)).toContain("已写入");

    const read = await readFileTool.execute("t2", { path: file });
    expect(textOf(read)).toBe("hello world");

    const edited = await editFileTool.execute("t3", {
      path: file,
      oldText: "hello",
      newText: "hi",
    });
    expect(textOf(edited)).toContain("替换 1 处");
    expect(readFileSync(file, "utf-8")).toBe("hi world");
  });

  it("edit_file rejects ambiguous oldText without replaceAll", async () => {
    using workspace = mkdtempDisposableSync(join(tmpdir(), "pi-tools-"));
    const file = join(workspace.path, "b.txt");
    writeFileSync(file, "x x x", "utf-8");
    await expect(
      editFileTool.execute("t4", { path: file, oldText: "x", newText: "y" }),
    ).rejects.toThrow(/匹配了 3 处/);

    await editFileTool.execute("t5", { path: file, oldText: "x", newText: "y", replaceAll: true });
    expect(readFileSync(file, "utf-8")).toBe("y y y");
  });

  it("read_file reports missing files via thrown error", async () => {
    await expect(
      readFileTool.execute("t6", { path: join(tmpdir(), "pi-tools-not-exists.txt") }),
    ).rejects.toThrow(/不存在|找不到|not exist|ENOENT/);
  });
});

describe("search tools", () => {
  it("glob matches by filename", async () => {
    using workspace = mkdtempDisposableSync(join(tmpdir(), "pi-tools-"));
    writeFileSync(join(workspace.path, "report.md"), "a", "utf-8");
    writeFileSync(join(workspace.path, "note.txt"), "b", "utf-8");
    const result = await globTool.execute("t7", { pattern: "*.md", path: workspace.path });
    expect(textOf(result)).toContain("report.md");
  });

  it("grep finds content lines", async () => {
    using workspace = mkdtempDisposableSync(join(tmpdir(), "pi-tools-"));
    const file = join(workspace.path, "code.ts");
    writeFileSync(file, "const alpha = 1;\nconst beta = 2;\n", "utf-8");
    const result = await grepTool.execute("t8", { pattern: "alpha", path: workspace.path });
    expect(textOf(result)).toContain("code.ts:1");
  });

  it("grep throws when nothing matches", async () => {
    using workspace = mkdtempDisposableSync(join(tmpdir(), "pi-tools-"));
    writeFileSync(join(workspace.path, "empty.md"), "nothing here", "utf-8");
    await expect(
      grepTool.execute("t9", { pattern: "zzz-not-there", path: workspace.path }),
    ).rejects.toThrow(/未找到匹配/);
  });
});

describe("bash tool", () => {
  it("runs a command in the platform default shell and returns output", async () => {
    const result = await bashTool.execute("t10", { command: "echo pilot-ok" });
    expect(textOf(result)).toContain("pilot-ok");
  }, 30_000);

  it("rejects failing commands with output", async () => {
    await expect(bashTool.execute("t11", { command: "echo boom; exit 1" })).rejects.toThrow(
      /命令失败/,
    );
  }, 30_000);

  const isWindows = process.platform === "win32";
  it.runIf(!isWindows || Boolean(findGitBash()))(
    "runs Bash from the configured folder",
    async () => {
      using workspace = mkdtempDisposableSync(join(tmpdir(), "pi-shell-"));
      const workingDirectory = realpathSync(workspace.path);
      const tool = createBashTool({ workingDirectory, commandShell: "bash" });
      const result = await tool.execute("bash-cwd", { command: isWindows ? "pwd -W" : "pwd" });
      expect(textOf(result).trim().replaceAll("/", "\\")).toBe(
        workingDirectory.replaceAll("/", "\\"),
      );
    },
    30_000,
  );

  it.runIf(isWindows)(
    "runs PowerShell from the configured folder",
    async () => {
      using workspace = mkdtempDisposableSync(join(tmpdir(), "pi-powershell-"));
      const workingDirectory = realpathSync(workspace.path);
      const tool = createBashTool({ workingDirectory, commandShell: "powershell" });
      const result = await tool.execute("powershell-cwd", { command: "(Get-Location).Path" });
      expect(realpathSync.native(textOf(result).trim())).toBe(
        realpathSync.native(workingDirectory),
      );
    },
    30_000,
  );
});

describe("configured working directory", () => {
  it("resolves relative file and search paths and normalizes the approval target", async () => {
    using workspace = mkdtempDisposableSync(join(tmpdir(), "pi-workspace-"));
    const workingDirectory = realpathSync(workspace.path);
    const tools = createTools({ workingDirectory, commandShell: getCommandShell() });
    const writer = tools.find((tool) => tool.name === "write_file")!;
    const args = { path: "new/file.txt", content: "workspace marker" };
    expect(writer.prepareArguments?.(args)).toEqual({
      ...args,
      path: join(workingDirectory, "new", "file.txt"),
    });
    await writer.execute("write", args);
    const reader = tools.find((tool) => tool.name === "read_file")!;
    expect(textOf(await reader.execute("read", { path: args.path }))).toBe(args.content);
    const glob = tools.find((tool) => tool.name === "glob")!;
    expect(textOf(await glob.execute("glob", { pattern: "*.txt" }))).toBe(join("new", "file.txt"));
  });

  it("rejects paths outside the folder and skips linked directories during search", async () => {
    using temp = mkdtempDisposableSync(join(tmpdir(), "pi-tool-scope-"));
    const root = realpathSync(temp.path);
    const workspace = join(root, "project");
    const sibling = join(root, "project-other");
    mkdirSync(workspace);
    mkdirSync(sibling);
    writeFileSync(join(workspace, "a.txt"), "in scope", "utf8");
    writeFileSync(join(sibling, "b.txt"), "outside", "utf8");
    symlinkSync(
      sibling,
      join(workspace, "linked"),
      process.platform === "win32" ? "junction" : "dir",
    );
    const resolveScopedPath = createToolPathResolver(workspace);
    const read = createReadFileTool(resolveScopedPath);
    await expect(read.execute("sibling", { path: "../project-other/b.txt" })).rejects.toThrow(
      /超出工作目录/,
    );
    await expect(read.execute("linked", { path: "linked/b.txt" })).rejects.toThrow(/超出工作目录/);
    await expect(
      createWriteFileTool(resolveScopedPath).execute("new", {
        path: join(sibling, "new.txt"),
        content: "x",
      }),
    ).rejects.toThrow(/超出工作目录/);
    expect(
      textOf(await createGlobTool(resolveScopedPath, true).execute("glob", { pattern: "*.txt" })),
    ).toBe("a.txt");
  });
});
