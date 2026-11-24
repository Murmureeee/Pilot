// @env node
import { existsSync, mkdtempDisposableSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { createBashTool } from "../src/main/agent-host/tools/bash";
import { findGitBash, getCommandShell } from "../src/main/workspace/shell";

const isWindows = process.platform === "win32";
const shells = isWindows && findGitBash() ? (["powershell", "bash"] as const) : [getCommandShell()];

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    // A killed orphan can remain a zombie until the system reaps it.
    return process.platform !== "linux" || !/\) Z /.test(readFileSync(`/proc/${pid}/stat`, "utf8"));
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ESRCH" || code === "ENOENT") return false;
    throw error;
  }
}

it("retains the same bounded head and tail for successful and failed output", async () => {
  using fixture = mkdtempDisposableSync(join(tmpdir(), "pilot-command-output-"));
  const tool = createBashTool({ workingDirectory: fixture.path, commandShell: getCommandShell() });
  const original = `START\n${"D".repeat(150_000)}\nEND`;
  writeFileSync(
    join(fixture.path, "output.cjs"),
    [
      'process.stdout.write("START\\n" + "D".repeat(Number(process.argv[2])) + "\\nEND");',
      "process.exitCode = Number(process.argv[3]);",
    ].join("\n"),
  );

  const success = await tool.execute("success", { command: "node output.cjs 150000 0" });
  const output = success.content[0];
  expect(output.type).toBe("text");
  if (output.type !== "text") throw new Error("Expected text output");
  expect(output.text.length).toBeLessThanOrEqual(100_000);
  const match = /^(START\r?\nD+)\n…（省略 (\d+) 字符）…\n(D+\r?\nEND\s*)$/.exec(output.text);
  expect(match).not.toBeNull();
  const [, head, omitted, tail] = match!;
  // PowerShell's native pipeline can normalize line endings.
  expect(Number(omitted)).toBe(
    original.length - (head + tail).trimEnd().replaceAll("\r\n", "\n").length,
  );

  const failureCommand = isWindows
    ? "node output.cjs 150000 7; exit $LASTEXITCODE"
    : "node output.cjs 150000 7";
  await expect(tool.execute("failure", { command: failureCommand })).rejects.toThrow(
    `命令失败（exit 7）\n输出:\n${output.text}`,
  );

  const exact = await tool.execute("exact", { command: "node output.cjs 99990 0" });
  expect(exact.content[0]).toEqual({ type: "text", text: `START\n${"D".repeat(99_990)}\nEND` });
}, 30_000);

describe.each(shells)("%s command process tree", (commandShell) => {
  it.each([
    ["stop", 10, /^命令被用户中止$/],
    ["timeout", 3, /^命令超时（已运行 (?:[3-9]|\d{2,})\.\d{2} 秒，上限 3 秒）$/],
  ] as const)(
    "ends the command and its descendant on %s",
    async (action, timeoutSec, reason) => {
      using fixture = mkdtempDisposableSync(join(tmpdir(), "pilot-command-tree-"));
      const tool = createBashTool({ workingDirectory: fixture.path, commandShell });
      const pidPath = (role: string): string => join(fixture.path, `${role}.pid`);
      writeFileSync(
        join(fixture.path, "tree.cjs"),
        [
          'const { spawn } = require("node:child_process");',
          'const { writeFileSync } = require("node:fs");',
          'const role = process.argv[2] ?? "parent";',
          "writeFileSync(`${role}.pid`, String(process.pid));",
          'if (role === "parent") spawn(process.execPath, [__filename, "child"], { stdio: "inherit", windowsHide: true });',
          'console.log(role + "-started");',
          "const keepAlive = setInterval(() => {}, 1000);",
          "setTimeout(() => clearInterval(keepAlive), 15_000);",
        ].join("\n"),
      );
      const abort = new AbortController();
      let output = "";
      const running = tool.execute(
        "tree",
        { command: "node tree.cjs", timeoutSec },
        abort.signal,
        (update) => {
          const entry = update.content[0];
          if (entry.type === "text") output = entry.text;
        },
      );
      const result = running.catch((error: unknown) => error);
      try {
        await vi.waitFor(() => expect(output).toContain("child-started"), { timeout: 5_000 });
        const pids = ["parent", "child"].map((role) => Number(readFileSync(pidPath(role), "utf8")));
        expect(pids.every(isRunning)).toBe(true);
        if (action === "stop") abort.abort();
        const failure = await result;
        expect(failure).toBeInstanceOf(Error);
        const { message } = failure as Error;
        expect(message).toContain("child-started");
        expect(message.split("\n", 1)[0]).toMatch(reason);
        await vi.waitFor(() => expect(pids.some(isRunning)).toBe(false), { timeout: 2_000 });
      } finally {
        abort.abort();
        await result;
        const pids = ["child", "parent"]
          .map(pidPath)
          .filter((path) => existsSync(path))
          .map((path) => Number(readFileSync(path, "utf8")));
        for (const pid of pids) {
          if (isRunning(pid)) process.kill(pid, "SIGKILL");
        }
        await vi.waitFor(() => expect(pids.some(isRunning)).toBe(false), { timeout: 2_000 });
      }
    },
    20_000,
  );
});
