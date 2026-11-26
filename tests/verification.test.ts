// @env node
import { mkdirSync, mkdtempDisposableSync, realpathSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { expect, it, vi } from "vitest";

import { AgentHost } from "../src/main/agent-host/host";
import { McpManager } from "../src/main/agent-host/mcp";
import { SessionStore } from "../src/main/agent-host/session-store";
import type { Settings } from "../src/main/settings/types";
import { VerificationManager } from "../src/main/verification";
import { verificationRepairPrompt } from "../src/main/verification/commands";
import { getCommandShell } from "../src/main/workspace/shell";
import type { RunRef, UiAgentEvent, VerificationResult } from "../src/shared/contract";

vi.mock("electron", () => ({ safeStorage: {} }));

function processExists(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === "ESRCH") return false;
    throw cause;
  }
}

it("queues a completed turn's verification in its original chat and checks the saved command again", async () => {
  using fixture = mkdtempDisposableSync(join(tmpdir(), "pilot-after-turn-"));
  const root = realpathSync(fixture.path);
  const a = join(root, "Project A");
  const b = join(root, "Project B");
  mkdirSync(a);
  mkdirSync(b);
  writeFileSync(join(a, "fail.cjs"), "console.error('fixture problem'); process.exitCode = 7;");
  const directory = join(root, "sessions");
  const manager = new VerificationManager(join(directory, "verification"), () => {});
  const shell = getCommandShell();
  const settings: Settings = {
    providers: [{ id: "demo", kind: "faux", name: "Demo", modelId: "faux-default" }],
    activeProviderId: "demo",
  };
  const host = new AgentHost({
    getSettings: () => settings,
    saveSettings: () => {},
    broadcast: () => {},
    store: new SessionStore(directory),
    skillsDir: join(root, "skills"),
    mcp: new McpManager(() => settings, "0.0.0"),
    onTurnCompleted: (sessionId, workingDirectory, task) => {
      manager.afterTurn(
        { sessionId, workingDirectory, task, kind: "test", shell, command: "node fail.cjs" },
        () => true,
      );
    },
  });
  const { composerId } = host.openProject(a);
  const request = {
    sessionId: composerId,
    workingDirectory: a,
    kind: "test",
    shell,
    command: 'node -e "setInterval(() => {}, 1000)"',
  } as const;
  try {
    const manual = manager.start(request);
    let enabled = true;
    manager.afterTurn({ ...request, command: "node fail.cjs" }, () => enabled);
    const task = host.prompt("Complete the task in Project A", composerId);
    const owner = host.verificationScope(composerId).task;
    const other = host.openProject(b);
    await task;
    enabled = false;
    expect(manager.state(composerId, a).runs).toHaveLength(1);
    await manager.stop(manual);
    await vi.waitFor(
      () => {
        const runs = manager.state(composerId, a).runs;
        expect(runs).toHaveLength(2);
        expect(runs[0]).toMatchObject({
          task: owner,
          trigger: "after-turn",
          workingDirectory: a,
          status: "failed",
        });
      },
      { timeout: 10_000 },
    );
    expect(manager.state(other.composerId, b).runs).toEqual([]);
    const failed = manager.result(manager.state(composerId, a).runs[0]);
    expect(verificationRepairPrompt(failed, "en")).toContain(
      "Exit code 7\n\nOutput\nfixture problem",
    );
    const long = { ...failed, output: "discard-before-tail" + "x".repeat(12_000) + "problem" };
    expect(verificationRepairPrompt(long, "en")).toMatch(/Output tail\n[^\n]*problem$/);
    expect(verificationRepairPrompt(long, "en")).not.toContain("discard-before-tail");
  } finally {
    await manager.stopAll();
  }
}, 20_000);

it("streams and saves successful, failed and stopped runs under the original chat and task", async () => {
  using fixture = mkdtempDisposableSync(join(tmpdir(), "pilot-verification-"));
  const root = realpathSync(fixture.path);
  const a = join(root, "Project A");
  const b = join(root, "Project B");
  mkdirSync(a);
  mkdirSync(b);
  writeFileSync(
    join(a, "package.json"),
    JSON.stringify({
      private: true,
      scripts: {
        test: "node check.cjs test",
        "check:types": "node check.cjs types",
        build: "node check.cjs build",
      },
    }),
  );
  writeFileSync(join(a, "pnpm-lock.yaml"), "lockfileVersion: '9.0'\n");
  writeFileSync(
    join(a, "check.cjs"),
    [
      "console.log('CWD=' + process.cwd());",
      "const mode = process.argv[2];",
      "console.log(mode + '-started');",
      "if (mode === 'test') setTimeout(() => console.log('test-passed'), 450);",
      "if (mode === 'types') { console.error('type-error'); process.exitCode = 7; }",
      "if (mode === 'build') {",
      "  const child = require('node:child_process').spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'inherit' });",
      "  console.log('CHILD=' + child.pid);",
      "  setInterval(() => {}, 1000);",
      "}",
    ].join("\n"),
  );
  const directory = join(root, "sessions");
  const history = join(directory, "verification");
  const settings: Settings = {
    providers: [{ id: "demo", kind: "faux", name: "Demo", modelId: "faux-default" }],
    activeProviderId: "demo",
  };
  const events: UiAgentEvent[] = [];
  const createHost = (): AgentHost =>
    new AgentHost({
      getSettings: () => settings,
      saveSettings: vi.fn<(settings: Settings) => void>(),
      broadcast: (event) => events.push(event),
      store: new SessionStore(directory),
      skillsDir: join(root, "skills"),
      mcp: new McpManager(() => settings, "0.0.0"),
    });
  const host = createHost();
  const checks: VerificationResult[] = [];
  const manager = new VerificationManager(history, (run) => checks.push(run));
  const shell = getCommandShell();
  const first = host.openProject(a);
  const { composerId } = first;
  const terminal = async (
    ref: RunRef,
    status: VerificationResult["status"],
  ): Promise<VerificationResult> => {
    await vi.waitFor(() => expect(manager.result(ref).status).toBe(status), { timeout: 10_000 });
    return manager.result(ref);
  };

  try {
    const agent = host.prompt("Review the project first", composerId);
    const owner = host.verificationScope(composerId, a);
    const taskRun = events.find((event) => event.type === "run_started")?.run;
    expect(owner).toMatchObject({
      sessionId: composerId,
      workingDirectory: a,
      task: {
        taskId: taskRun?.runId,
        agentRunId: taskRun?.runId,
        title: "Review the project first",
      },
    });
    expect(manager.state(owner.sessionId, a).commands).toEqual({
      test: "pnpm run test",
      typecheck: "pnpm run check:types",
      build: "pnpm run build",
    });
    const start = (kind: VerificationResult["kind"], command: string): VerificationResult =>
      manager.start({
        sessionId: composerId,
        workingDirectory: a,
        shell,
        kind,
        command,
        task: owner.task,
      });
    const success = start("test", "node check.cjs test");
    await vi.waitFor(
      () => {
        expect(
          checks.some(
            (item) =>
              item.runId === success.runId &&
              item.status === "running" &&
              item.output.includes("test-started"),
          ),
        ).toBe(true);
      },
      { timeout: 10_000 },
    );
    await agent;
    const passed = await terminal(success, "success");
    expect(passed).toMatchObject({ exitCode: 0, task: owner.task, workingDirectory: a });
    expect(passed.output).toContain("test-passed");
    expect(passed.durationMs).toBeGreaterThan(0);
    expect(host.verificationScope(composerId).task).toEqual(owner.task);

    const failure = start("typecheck", "node check.cjs types");
    const failed = await terminal(failure, "failed");
    expect(failed).toMatchObject({ exitCode: 7, task: owner.task });
    expect(failed.output).toContain("type-error");

    const build = start("build", "node check.cjs build");
    await vi.waitFor(() => expect(manager.result(build).output).toMatch(/CHILD=\d+/), {
      timeout: 10_000,
    });
    const pid = Number(/CHILD=(\d+)/.exec(manager.result(build).output)?.[1]);
    expect(pid).toBeGreaterThan(0);
    const another = host.openProject(b);
    const other = host.verificationScope(another.composerId, b);
    expect(manager.state(other.sessionId, b).runs).toEqual([]);
    expect(() => host.verificationScope(composerId)).toThrow("会话已切换");
    expect(() => host.verificationScope(another.composerId, a)).toThrow("工作目录已变更");
    host.loadSession(composerId);
    const stopped = await manager.stop(build);
    expect(stopped).toMatchObject({ status: "stopped", task: owner.task });
    expect(stopped.output).toContain("build-started");
    await vi.waitFor(() => expect(process.platform === "win32" && processExists(pid)).toBe(false), {
      timeout: 5000,
    });

    const exiting = start("build", "node check.cjs build");
    await vi.waitFor(() => expect(manager.result(exiting).output).toMatch(/CHILD=\d+/), {
      timeout: 10_000,
    });
    const exitChild = Number(/CHILD=(\d+)/.exec(manager.result(exiting).output)?.[1]);
    expect(manager.hasActiveRuns()).toBe(true);
    await manager.stopAll();
    expect(manager.hasActiveRuns()).toBe(false);
    expect(manager.result(exiting)).toMatchObject({ status: "interrupted", task: owner.task });
    await vi.waitFor(
      () => expect(process.platform === "win32" && processExists(exitChild)).toBe(false),
      {
        timeout: 5000,
      },
    );

    const restartedHost = createHost();
    const restartedManager = new VerificationManager(
      history,
      vi.fn<(run: VerificationResult) => void>(),
    );
    try {
      restartedHost.loadSession(composerId);
      expect(restartedHost.verificationScope(composerId).task).toEqual(owner.task);
      expect(restartedManager.state(composerId, a).runs.map(({ status }) => status)).toEqual([
        "interrupted",
        "stopped",
        "failed",
        "success",
      ]);
      expect(restartedManager.result(build)).toEqual(stopped);
      const retry = restartedManager.rerun(success);
      expect(retry).toMatchObject({
        rerunOf: success.runId,
        task: owner.task,
        workingDirectory: a,
        command: success.command,
        shell,
      });
      expect(retry.runId).not.toBe(success.runId);
      await vi.waitFor(() => expect(restartedManager.result(retry).status).toBe("success"), {
        timeout: 10_000,
      });
      expect(restartedManager.result(retry).output).toContain("CWD=" + realpathSync.native(a));
    } finally {
      await restartedManager.stopAll();
    }
  } finally {
    await manager.stopAll();
  }
}, 30_000);
