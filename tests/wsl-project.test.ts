// @env node
import { spawn } from "node:child_process";
import { once } from "node:events";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { expect, it } from "vitest";

import { commandPrefixMatches } from "../src/main/agent-host/command-scope";
import { launchInteractiveShell } from "../src/main/terminal/process";
import { launchVerification } from "../src/main/verification/commands";
import { isWithinDirectory, normalizeWorkingDirectory } from "../src/main/workspace/paths";
import { stopProcessTree } from "../src/main/workspace/process";
import { getCommandShell, launchCommand } from "../src/main/workspace/shell";
import { firstWslDistribution, wslLaunchSpec } from "../src/main/workspace/wsl";
import { wslProjectPath } from "../src/shared/wsl-project";

it("maps both WSL share aliases to a distribution and case-sensitive Linux path", () => {
  expect(wslProjectPath("\\\\wsl.localhost\\Ubuntu\\home\\我的项目")).toEqual({
    distribution: "Ubuntu",
    path: "/home/我的项目",
  });
  expect(wslProjectPath("\\\\?\\UNC\\wsl$\\Ubuntu\\home")).toEqual({
    distribution: "Ubuntu",
    path: "/home",
  });
  expect(wslProjectPath("\\\\wsl$\\Ubuntu\\home\\..\\etc")).toBeUndefined();
  expect(wslProjectPath("\\\\wsl.localhost\\--system\\home")).toBeUndefined();
  expect(
    isWithinDirectory(
      "\\\\wsl$\\Ubuntu\\home\\Project",
      "\\\\wsl.localhost\\ubuntu\\home\\Project\\file",
    ),
  ).toBe(true);
  expect(
    isWithinDirectory(
      "\\\\wsl$\\Ubuntu\\home\\Project",
      "\\\\wsl.localhost\\ubuntu\\home\\project\\file",
    ),
  ).toBe(false);
  expect(isWithinDirectory("\\\\wsl$\\Ubuntu\\home", "\\\\wsl.localhost\\Debian\\home\\file")).toBe(
    false,
  );
});

it("scopes Bash command approvals to their WSL distribution", () => {
  const local = { shell: "bash", args: ["git", "status"] } as const;
  const args = [...local.args];
  const wsl = { shell: local.shell, args, wslDistribution: "Ubuntu" };
  expect(commandPrefixMatches({ ...local, args }, "bash", args, "Ubuntu")).toBe(false);
  expect(commandPrefixMatches(wsl, "bash", args)).toBe(false);
  expect(commandPrefixMatches(wsl, "bash", args, "Debian")).toBe(false);
  expect(commandPrefixMatches(wsl, "bash", [...args, "--short"], "ubuntu")).toBe(true);
});

const fixture = process.env.PILOT_TEST_WSL_DIRECTORY;
const live = process.platform === "win32" && Boolean(fixture);

it.runIf(live)(
  "executes a real WSL project's commands and verification in the matching distribution",
  async () => {
    const directory = normalizeWorkingDirectory(fixture!);
    const { path, distribution } = wslProjectPath(directory)!;
    expect(getCommandShell("powershell", directory)).toBe("bash");
    expect(await firstWslDistribution()).toBe(distribution);
    expect(readFileSync(join(directory, "readme.txt"), "utf8")).toBe("wsl fixture\n");
    const launched = launchCommand(
      "bash",
      directory,
      'printf \'%s | %s | %s\\n\' "$PWD" "$PILOT_HOOK_EVENT" "$PILOT_HOOK_TOOL"; printf \'command stderr\\n\' >&2; exit 7',
      {
        PILOT_HOOK_EVENT: "afterTool",
        PILOT_HOOK_TOOL: "write_file",
      },
    );
    let output = "";
    let error = "";
    launched.stdout.on("data", (chunk) => {
      output += chunk.toString();
    });
    launched.stderr.on("data", (chunk) => {
      error += chunk.toString();
    });
    const [code] = (await once(launched, "close")) as [number];
    expect(code).toBe(7);
    expect(output).toBe(path + " | afterTool | write_file\n");
    expect(error).toContain("command stderr\n");
    expect(error).not.toContain("\0");
    expect(error).not.toContain("PILOT_HOOK_EVENT");
    const verification = launchVerification({
      sessionId: "wsl",
      workingDirectory: directory,
      shell: "bash",
      kind: "test",
      command: "test -f readme.txt",
    });
    await expect(once(verification, "close")).resolves.toEqual([0, null]);
  },
  20_000,
);

it.runIf(live)(
  "stopping a WSL command also ends its Linux child processes",
  async () => {
    const directory = normalizeWorkingDirectory(fixture!);
    const marker = join(directory, "child.pid");
    const launched = launchCommand(
      "bash",
      directory,
      "sleep 120 & child=$!; echo $child > child.pid; echo ready; wait $child",
    );
    const closed = once(launched, "close");
    try {
      await once(launched.stdout, "data");
      expect(existsSync(marker)).toBe(true);
      const pid = readFileSync(marker, "utf8").trim();
      await stopProcessTree(launched);
      await closed;
      const spec = wslLaunchSpec(directory, [
        "-c",
        "test ! -r /proc/$1/stat || [[ $(cut -d' ' -f3 /proc/$1/stat) == Z ]]",
        "pilot",
        pid,
      ])!;
      const probe = spawn(spec.executable, spec.args, { cwd: spec.cwd, windowsHide: true });
      await expect(once(probe, "close")).resolves.toEqual([0, null]);
    } finally {
      await stopProcessTree(launched);
    }
  },
  20_000,
);

it.runIf(live)(
  "opens the WSL interactive terminal in the exact project path",
  async () => {
    const directory = normalizeWorkingDirectory(fixture!);
    const { path } = wslProjectPath(directory)!;
    const result = Promise.withResolvers<void>();
    let output = "";
    const terminal = launchInteractiveShell(
      "bash",
      directory,
      { columns: 90, rows: 24 },
      (chunk) => {
        output += chunk;
        if (output.includes("pilot-test:" + path)) result.resolve();
      },
    );
    try {
      terminal.write?.("printf 'pilot-test:%s\\n' \"$PWD\"\r");
      await result.promise;
      expect(output).toContain("pilot-test:" + path);
      terminal.write?.("exit\r");
      await expect(terminal.done).resolves.toEqual({ exitCode: 0 });
    } finally {
      await terminal.stop();
    }
  },
  20_000,
);
