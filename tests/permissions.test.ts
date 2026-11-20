import { describe, expect, it } from "vitest";
import { PermissionManager } from "../src/main/agent-host/permissions";
import type { PermissionRequest } from "@shared/contract";

/** 结算宏任务 */
const flush = (): Promise<void> => new Promise((resolveP) => setTimeout(resolveP, 0));

function makeManager(globalRules: { toolName: string; pathPrefix?: string }[] = []) {
  const events: PermissionRequest[] = [];
  const addedGlobal: { toolName: string; pathPrefix?: string }[] = [];
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
  return { manager, events, addedGlobal };
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

  it("persists to global rules on 'global' decision", async () => {
    const { manager, events, addedGlobal } = makeManager();
    const promise = manager.gate("bash", { command: "whoami" });
    await flush();
    manager.respond((events[0] as { requestId: string }).requestId, "global");
    expect(await promise).toBeUndefined();
    expect(addedGlobal).toEqual([{ toolName: "bash" }]);
    // 全局规则生效后再问 bash 不再弹窗
    const again = await manager.gate("bash", { command: "Get-Date" });
    expect(again).toBeUndefined();
    expect(events).toHaveLength(1);
  });

  it("flags dangerous bash commands in the permission request", async () => {
    const { manager, events } = makeManager();
    const promise = manager.gate("bash", { command: "rm -rf C:\\tmp\\x" });
    await flush();
    const request = events[0];
    expect(request.type === "permission_request" && request.danger).toBe(true);
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
