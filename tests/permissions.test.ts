import { describe, expect, it } from "vitest";
import { PermissionManager } from "../src/main/agent-host/permissions";
import { homedir } from "node:os";
import type { CommandShell, PermissionRequest, ToolRule } from "@shared/contract";

/** 结算宏任务 */
const flush = (): Promise<void> => new Promise((resolveP) => setTimeout(resolveP, 0));

function makeManager(globalRules: ToolRule[] = []) {
  const events: PermissionRequest[] = [];
  const addedGlobal: ToolRule[] = [];
  // 模拟真实持久化回路：addGlobalRule 落盘 → getGlobalRules 立即可见
  const allRules = [...globalRules];
  const manager = new PermissionManager(
    (event) => events.push(event),
    () => allRules,
    (rule) => {
      addedGlobal.push(rule);
      allRules.push(rule);
    },
  );
  return { manager, events, addedGlobal, allRules };
}

function commandRule(shell: CommandShell, ...args: string[]): ToolRule {
  return { toolName: "bash", commandPrefix: { shell, args } };
}

describe("PermissionManager", () => {
  it("auto-allows read-only tools without asking", async () => {
    const { manager, events } = makeManager();
    const result = await manager.gate("read_file", { path: "C:\\tmp\\a.txt" });
    expect(result).toBeUndefined();
    expect(events).toHaveLength(0);
  });

  it("asks and blocks on deny", async () => {
    const { manager, events } = makeManager();
    const promise = manager.gate("write_file", { path: "C:\\tmp\\a.txt", content: "x" });
    await flush();
    expect(events).toHaveLength(1);
    const request = events[0];
    expect(request.type === "permission_request" && request.toolName).toBe("write_file");
    manager.respond((request as { requestId: string }).requestId, "deny");
    const result = await promise;
    expect(result).toEqual({ block: true, reason: "用户拒绝了本次工具调用" });
  });

  it("honors global path-prefix rules for file tools", async () => {
    const { manager, events } = makeManager([{ toolName: "write_file", pathPrefix: "C:\\tmp" }]);
    const allowed = await manager.gate("write_file", { path: "C:\\tmp\\sub\\a.txt" });
    expect(allowed).toBeUndefined();
    const outside = manager.gate("write_file", { path: "D:\\other\\a.txt" });
    await flush();
    expect(events).toHaveLength(1); // 未命中规则 → 弹窗
    manager.respond((events[0] as { requestId: string }).requestId, "deny");
    expect(await outside).toMatchObject({ block: true });
  });

  it("records session rules on 'session' decision", async () => {
    const { manager, events, addedGlobal } = makeManager();
    const first = manager.gate("edit_file", { path: "C:\\tmp\\a.txt" });
    await flush();
    manager.respond((events[0] as { requestId: string }).requestId, "session");
    expect(await first).toBeUndefined();
    expect(addedGlobal).toHaveLength(0);
    // 第二次同前缀调用不再询问
    const second = await manager.gate("edit_file", { path: "C:\\tmp\\a.txt" });
    expect(second).toBeUndefined();
    expect(events).toHaveLength(1);
  });

  it("flags dangerous bash commands in the permission request", async () => {
    const { manager, events } = makeManager();
    const promise = manager.gate("bash", { command: "rm -rf C:\\tmp\\x" });
    await flush();
    const request = events[0];
    expect(request.type === "permission_request" && request.danger).toBe(true);
    expect(request.rule).toBeUndefined();
    manager.respond((request as { requestId: string }).requestId, "deny");
    expect(await promise).toMatchObject({ block: true });
  });

  it("full-access mode bypasses the gate entirely", async () => {
    const events: PermissionRequest[] = [];
    const manager = new PermissionManager(
      (event) => events.push(event),
      () => [],
      () => undefined,
      () => "full-access",
    );
    const result = await manager.gate("bash", { command: "whoami" });
    expect(result).toBeUndefined();
    expect(events).toHaveLength(0);
  });

  it("read-only mode rejects write tools without asking", async () => {
    const events: PermissionRequest[] = [];
    const manager = new PermissionManager(
      (event) => events.push(event),
      () => [],
      () => undefined,
      () => "read-only",
    );
    const result = await manager.gate("write_file", { path: "C:\\tmp\\a.txt" });
    expect(result).toMatchObject({ block: true });
    expect(events).toHaveLength(0);
  });

  it("uses a server's confirmation policy even in global full-access mode", async () => {
    const events: PermissionRequest[] = [];
    const manager = new PermissionManager(
      (event) => events.push(event),
      () => [],
      () => undefined,
      () => "full-access",
    );
    const pending = manager.gate(
      "mcp__example__echo",
      { text: "hello" },
      {
        label: "Example / Echo",
        requireConfirmation: true,
      },
    );
    await flush();
    expect(events[0]).toMatchObject({ type: "permission_request", label: "Example / Echo" });
    manager.respond((events[0] as { requestId: string }).requestId, "deny");
    expect(await pending).toMatchObject({ block: true });
  });

  it("exposes parallel pending requests in order and clears only the answered requests", async () => {
    const { manager, events } = makeManager();
    const first = manager.gate("write_file", { path: "first.txt" });
    const second = manager.gate("write_file", { path: "second.txt" });
    await flush();
    expect(manager.listPending()).toEqual(events);
    expect(manager.respond(events[0].requestId, "once")).toBe(true);
    expect(manager.respond(events[0].requestId, "deny")).toBe(false);
    expect(manager.listPending()).toEqual([events[1]]);
    await expect(first).resolves.toBeUndefined();
    manager.abortAll();
    expect(manager.listPending()).toEqual([]);
    await expect(second).resolves.toMatchObject({ block: true });
  });
});

describe.each(["powershell", "bash"] as const)("%s command approval", (shell) => {
  const gate = (manager: PermissionManager, command: string) =>
    manager.gate("bash", { command }, undefined, { commandShell: shell });

  it("offers the concrete prefix and persists only that scope", async () => {
    const { manager, events, addedGlobal, allRules } = makeManager([{ toolName: "bash" }]);
    const initial = gate(manager, "  git\t'status' --short ");
    await flush();
    const rule = commandRule(shell, "git", "status", "--short");
    expect(events[0]).toMatchObject({
      command: "  git\t'status' --short ",
      workingDirectory: homedir(),
      rule,
    });
    expect(manager.respond(events[0].requestId, "global")).toBe(true);
    await expect(initial).resolves.toBeUndefined();
    expect(addedGlobal).toEqual([rule]);
    await expect(gate(manager, "git status --short --branch")).resolves.toBeUndefined();

    allRules.splice(allRules.indexOf(rule), 1);
    const revoked = gate(manager, "git status --short --branch");
    await flush();
    expect(events).toHaveLength(2);
    manager.respond(events[1].requestId, "deny");
    await expect(revoked).resolves.toMatchObject({ block: true });
  });

  it("binds session rules to the shell", async () => {
    const { manager, events, addedGlobal } = makeManager();
    const first = gate(manager, "pnpm test");
    await flush();
    manager.respond(events[0].requestId, "session");
    await expect(first).resolves.toBeUndefined();
    expect(addedGlobal).toHaveLength(0);
    await expect(gate(manager, "pnpm test --run")).resolves.toBeUndefined();

    const other = manager.gate("bash", { command: "pnpm test" }, undefined, {
      commandShell: shell === "bash" ? "powershell" : "bash",
    });
    await flush();
    expect(events).toHaveLength(2);
    manager.respond(events[1].requestId, "deny");
    await expect(other).resolves.toMatchObject({ block: true });
  });

  it.each([
    "git status --short",
    'git "status" --short',
    "git status 'literal | ; > $(text)'",
    "git status | pnpm test",
    "git status; pnpm test",
    "git status\npnpm test",
    'git status "$(pnpm test)"',
    "git status $(pnpm test; git status)",
  ])("matches the approved argument prefixes in %s", async (command) => {
    const { manager, events } = makeManager([
      commandRule(shell, "git", "status"),
      commandRule(shell, "pnpm", "test"),
    ]);
    const pending = gate(manager, command);
    await flush();
    for (const event of events) manager.respond(event.requestId, "deny");
    expect(events).toEqual([]);
    await expect(pending).resolves.toBeUndefined();
  });

  it.each([
    ["git statuses", true],
    ["pnpm testing", true],
    ["git 'status --short'", true],
    ["git-status", true],
    ["git -C . status", true],
    ["git status | git branch", false],
    ["git status; git branch", false],
    ["git status\ngit branch", false],
    ["git status > preview.txt", false],
    ["git status 2>&1", false],
    ['git status "$(git branch)"', false],
    ["git $(pnpm test) status", false],
    ["git status $variable", false],
    ['git status "unterminated', false],
    ["git status |", false],
    ["git status $(pnpm test", false],
  ])("prompts outside the saved scope for %s", async (command, canSaveRule) => {
    const { manager, events, addedGlobal } = makeManager([
      { toolName: "bash" },
      { toolName: "bash", pathPrefix: "." },
      commandRule(shell, "git", "status"),
      commandRule(shell, "pnpm", "test"),
    ]);
    const pending = gate(manager, command);
    await flush();
    expect(events).toHaveLength(1);
    expect(Boolean(events[0].rule)).toBe(canSaveRule);
    manager.respond(events[0].requestId, "deny");
    await expect(pending).resolves.toMatchObject({ block: true });
    expect(addedGlobal).toEqual([]);
  });
});

it.each([
  ["bash", "git status && git status", true],
  ["bash", "git status && git branch", false],
  ["bash", "git status || git status", true],
  ["bash", "git status |& git status", true],
  ["bash", "git status & git status", false],
  ["bash", "git status \x60git branch\x60", false],
  ["bash", "git status <(git branch)", false],
  ["bash", "git sta\\tus --short", true],
  ["bash", "git status\r\ngit status", false],
  ["powershell", "git status && git status", false],
  ["powershell", "git status\r\ngit status", true],
  ["powershell", "git status; & git branch", false],
  ["powershell", "git status (git branch)", false],
  ["powershell", "git status --% literal", false],
  ["powershell", "git “status”", false],
] as const)("handles %s syntax in %s", async (shell, command, allowed) => {
  const { manager, events } = makeManager([commandRule(shell, "git", "status")]);
  const pending = manager.gate("bash", { command }, undefined, { commandShell: shell });
  await flush();
  for (const event of events) manager.respond(event.requestId, "deny");
  expect(events).toHaveLength(allowed ? 0 : 1);
  await expect(pending).resolves.toEqual(
    allowed ? undefined : { block: true, reason: "用户拒绝了本次工具调用" },
  );
});

it("rejects a persistent decision for a command that requires individual approval", async () => {
  const { manager, events, addedGlobal } = makeManager();
  const pending = manager.gate("bash", { command: "git status | git branch" });
  await flush();
  expect(() => manager.respond(events[0].requestId, "global")).toThrow("此操作需要逐次审批。");
  expect(manager.hasPending()).toBe(true);
  manager.respond(events[0].requestId, "once");
  await expect(pending).resolves.toBeUndefined();
  expect(addedGlobal).toEqual([]);
});

it("keeps the request pending when a global approval cannot be saved", async () => {
  const manager = new PermissionManager(
    () => undefined,
    () => [],
    () => {
      throw new Error("settings file unavailable");
    },
  );
  const pending = manager.gate("bash", { command: "git status" });
  await flush();
  const request = manager.listPending()[0];
  expect(() => manager.respond(request.requestId, "global")).toThrow("settings file unavailable");
  expect(manager.listPending()).toEqual([request]);
  manager.respond(request.requestId, "once");
  await expect(pending).resolves.toBeUndefined();
});
