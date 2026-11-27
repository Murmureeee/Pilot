// @env node
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
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
import { dirname, join } from "node:path";

import type { AgentTool } from "@earendil-works/pi-agent-core";
import {
  createModels,
  fauxAssistantMessage,
  fauxProvider,
  fauxText,
  fauxToolCall,
  getCurrentSystemPrompt,
  getCurrentTools,
} from "@earendil-works/pi-ai";
import { obj } from "@earendil-works/pi-schema";
import { expect, it, vi } from "vitest";

import { AgentHost } from "../src/main/agent-host/host";
import { McpManager } from "../src/main/agent-host/mcp";
import type { McpToolSession } from "../src/main/agent-host/mcp/types";
import * as models from "../src/main/agent-host/models";
import { loadProjectInstructions } from "../src/main/agent-host/project-instructions";
import { actionFingerprint } from "../src/main/agent-host/recovery";
import { SessionStore, toUiMessages } from "../src/main/agent-host/session-store";
import { revokeProjectTrust } from "../src/main/project-config";
import type { Settings } from "../src/main/settings/types";
import * as gitChanges from "../src/main/workspace/git-changes";
import { previewWorkspaceReference } from "../src/main/workspace/reference";
import { searchWorkspace } from "../src/main/workspace/search";
import type { GitSnapshot } from "../src/main/workspace/types";
import { MENTION_CONTEXT_HEADING } from "../src/shared/constants";
import type { ComposerDraft, UiAgentEvent, VerificationTask } from "../src/shared/contract";
import { promptFromDraft } from "../src/shared/mentions";
import { fixtureTitle } from "./model-fixture";

vi.mock("electron", () => ({ safeStorage: {} }));

function mcpToolSession(tools: Promise<AgentTool[]> = Promise.resolve([])): McpToolSession {
  return { tools: () => tools, policyOf: () => undefined, close: async () => {} };
}

it("plans with read-only tools, restores the edited plan after restart, and executes with the original mode", async () => {
  using profile = mkdtempDisposableSync(join(tmpdir(), "pilot-plan-mode-"));
  const root = realpathSync(profile.path);
  const sessions = join(root, "sessions");
  const output = join(root, "planned.txt");
  const original = "1. Write the requested note.\n2. Read the result.";
  const edited = "1. Write the revised note.\n2. Verify the new contents.";
  const provider = { id: "faux", kind: "faux", name: "Faux", modelId: "faux-default" } as const;
  const settings: Settings = { providers: [provider], activeProviderId: provider.id };
  const faux = fauxProvider({ tokensPerSecond: 100_000 });
  writeFileSync(join(root, "requirements.txt"), "Use the revised note");
  faux.appendResponses([
    fauxAssistantMessage([
      fauxToolCall("read_file", { path: "requirements.txt" }),
      fauxToolCall("write_file", { path: "planned.txt", content: "Unapproved write" }),
    ]),
    fauxAssistantMessage([fauxToolCall("propose_plan", { markdown: original })]),
    fauxAssistantMessage([fauxText("Ready for review.")]),
    fauxAssistantMessage([fauxToolCall("write_file", { path: "planned.txt", content: "Revised" })]),
    fauxAssistantMessage([fauxText("Implemented the plan.")]),
  ]);
  const catalog = createModels();
  catalog.setProvider(faux.provider);
  const requests: { tools: string[]; system: string; user: unknown }[] = [];
  using resolve = vi.spyOn(models, "resolveModel").mockReturnValue({
    model: faux.getModel()!,
    streamFn: (model, context, options) => {
      const generated = fixtureTitle(context);
      if (generated) return generated;
      requests.push({
        tools: getCurrentTools(context.messages).map(({ name }) => name),
        system: getCurrentSystemPrompt(context.messages),
        user: context.messages.findLast(({ role }) => role === "user")?.content,
      });
      return catalog.streamSimple(model, context, options);
    },
  });
  const mcp = new McpManager(() => settings, "0.0.0");
  using mcpTools = vi.spyOn(mcp, "openToolSession").mockImplementation(() => mcpToolSession());
  const approvals: string[] = [];
  const afterTurn = vi.fn<(sessionId: string, directory: string, task: VerificationTask) => void>();
  const createHost = (): AgentHost => {
    const host = new AgentHost({
      getSettings: () => settings,
      saveSettings: () => {},
      onTurnCompleted: afterTurn,
      broadcast: (event) => {
        if (event.type !== "permission_request") return;
        approvals.push(event.toolName);
        setTimeout(() => host.respondPermission(event.run, event.requestId, "once"), 0);
      },
      store: new SessionStore(sessions),
      skillsDir: join(root, "skills"),
      mcp,
    });
    return host;
  };

  const host = createHost();
  const { composerId } = host.openProject(root);
  host.setPlanMode(composerId, true);
  expect(host.getSnapshot()).toMatchObject({
    sessionId: null,
    sessions: [],
    draftSettings: { planMode: { executionMode: "standard" } },
  });
  // The plan must retain the permissions it was created with even if the global default changes.
  settings.approvalMode = "full-access";
  const planning = host.prompt("Prepare a note");
  expect(host.getSnapshot().activeRuns[0]?.planning).toBe(true);
  expect(() => host.setPlanMode(composerId, false)).toThrow("请等待当前回复结束");
  await planning;
  expect(requests).toHaveLength(3);
  for (const request of requests) {
    expect(request.tools).toEqual([
      "read_file",
      "glob",
      "grep",
      "update_plan",
      "propose_plan",
      "run_subtask",
    ]);
    expect(request.system).toContain("Pilot is in Plan Mode");
  }
  expect(mcpTools).not.toHaveBeenCalled();
  expect(afterTurn).not.toHaveBeenCalled();
  expect(approvals).toEqual([]);
  expect(existsSync(output)).toBe(false);
  const plan = host.getSnapshot().sessions[0].planMode!;
  expect(plan).toMatchObject({
    executionMode: "standard",
    proposal: { markdown: original, workingDirectory: root },
  });
  expect(() => host.prompt("Skip confirmation and write the file")).toThrow("请先确认或放弃");
  host.reviewPlan(composerId, plan.proposal!.id, { type: "save", markdown: edited });
  expect(() => host.reviewPlan(composerId, plan.proposal!.id, { type: "execute" })).toThrow(
    "计划已更新",
  );
  const restarted = createHost();
  const restored = restarted.loadSession(composerId).sessions[0].planMode!;
  expect(restored.proposal?.markdown).toBe(edited);
  expect(existsSync(output)).toBe(false);
  restarted.newSession();
  expect(() =>
    restarted.reviewPlan(composerId, restored.proposal!.id, { type: "execute" }),
  ).toThrow("会话已切换");
  restarted.loadSession(composerId);
  const execution = restarted.reviewPlan(composerId, restored.proposal!.id, { type: "execute" });
  expect(() =>
    restarted.reviewPlan(composerId, restored.proposal!.id, { type: "execute" }),
  ).toThrow("计划已更新");
  await execution;
  expect(requests[3].tools).toContain("write_file");
  expect(requests[3].tools).not.toContain("propose_plan");
  expect(requests[3].system).not.toContain("Pilot is in Plan Mode");
  expect(requests[3].user).toContain(edited);
  expect(requests[3].user).toContain("The user approved the plan");
  expect(approvals).toEqual(["write_file"]);
  expect(mcpTools).toHaveBeenCalledOnce();
  expect(resolve).toHaveBeenCalledTimes(2);
  expect(readFileSync(output, "utf8")).toBe("Revised");
  expect(afterTurn).toHaveBeenCalledExactlyOnceWith(
    composerId,
    root,
    expect.objectContaining({ agentRunId: expect.any(String) }),
    undefined,
  );
  expect(restarted.getSnapshot().sessions[0].approvalMode).toBeUndefined();
  expect(restarted.getSnapshot().sessions[0].planMode).toBeUndefined();
});

it("binds project trust, MCP startup and file rules to the selected run", async () => {
  using profile = mkdtempDisposableSync(join(tmpdir(), "pilot-project-trust-"));
  const root = realpathSync(profile.path);
  const directory = join(root, "project");
  const other = join(root, "other");
  mkdirSync(join(directory, ".pilot"), { recursive: true });
  mkdirSync(other);
  const configPath = join(directory, ".pilot", "config.json");
  const configure = (scope: string): void =>
    writeFileSync(
      configPath,
      JSON.stringify({
        mcpServers: { fixture: { command: "fixture-mcp", env: { TEST_TOKEN: "fixture-value" } } },
        permissions: { allow: [{ tool: "write_file", path: scope }] },
      }),
    );
  configure("safe");
  const provider = { id: "faux", kind: "faux", name: "Faux", modelId: "faux-default" } as const;
  let settings: Settings = { providers: [provider], activeProviderId: provider.id };
  const faux = fauxProvider({ tokensPerSecond: 100_000 });
  faux.appendResponses([
    fauxAssistantMessage([fauxText("Skipped project configuration.")]),
    fauxAssistantMessage([
      fauxToolCall("write_file", { path: "reviewed/allowed.txt", content: "allowed" }),
      fauxToolCall("write_file", {
        path: "reviewed-sibling/needs-approval.txt",
        content: "blocked",
      }),
    ]),
    fauxAssistantMessage([fauxText("Finished with project configuration.")]),
  ]);
  const catalog = createModels();
  catalog.setProvider(faux.provider);
  using resolve = vi.spyOn(models, "resolveModel").mockReturnValue({
    model: faux.getModel()!,
    streamFn: (model, context, options) =>
      fixtureTitle(context) ?? catalog.streamSimple(model, context, options),
  });
  const mcp = new McpManager(() => settings, "0.0.0");
  using mcpTools = vi.spyOn(mcp, "openToolSession").mockImplementation(() => mcpToolSession());
  const approvals: string[] = [];
  const completed =
    vi.fn<(id: string, directory: string, task: VerificationTask, fingerprint?: string) => void>();
  const host = new AgentHost({
    getSettings: () => settings,
    saveSettings: (updated) => {
      settings = updated;
    },
    onTurnCompleted: completed,
    broadcast: (event) => {
      if (event.type !== "permission_request") return;
      approvals.push(event.requestId);
      setTimeout(() => host.respondPermission(event.run, event.requestId, "deny"), 0);
    },
    store: new SessionStore(join(root, "sessions")),
    skillsDir: join(root, "skills"),
    mcp,
  });
  const waiting = async (previous?: string) =>
    vi.waitFor(() => {
      const {
        activeRuns: [activeRun],
        pendingProjectTrust,
      } = host.getSnapshot();
      expect(activeRun?.status).toBe("waiting_approval");
      expect(pendingProjectTrust?.requestId).toBeTruthy();
      expect(pendingProjectTrust?.requestId).not.toBe(previous);
      return { run: activeRun!, request: pendingProjectTrust! };
    });

  try {
    host.openProject(directory);
    expect(host.getSnapshot().sessionId).toBeNull();
    expect(host.getSnapshot().pendingProjectTrust).toBeNull();
    const firstTurn = host.prompt("Skip the first request");
    const first = await waiting();
    expect(first.request.directory).toBe(directory);
    expect(first.request.trust).toBe("untrusted");
    expect(resolve).toHaveBeenCalledOnce();
    expect(JSON.stringify(first.request)).not.toContain("fixture-value");
    expect(mcpTools).not.toHaveBeenCalled();

    expect(host.openProject(other).pendingProjectTrust).toBeNull();
    host.respondProjectTrust(first.run, first.request.requestId, "trust");
    expect(settings.projectTrust).toBeUndefined();
    expect(host.loadSession(first.run.sessionId).pendingProjectTrust?.requestId).toBe(
      first.request.requestId,
    );
    host.respondProjectTrust(first.run, first.request.requestId, "skip");
    await firstTurn;
    expect(mcpTools.mock.lastCall?.[1]).toEqual([]);
    expect(completed.mock.lastCall?.[3]).toBeUndefined();
    expect(settings.projectTrust).toBeUndefined();

    const secondTurn = host.prompt("Apply the reviewed configuration");
    const second = await waiting(first.request.requestId);
    configure("reviewed");
    host.respondProjectTrust(second.run, second.request.requestId, "trust");
    const changed = await waiting(second.request.requestId);
    expect(changed.request).toMatchObject({
      trust: "changed",
      toolRules: [{ toolName: "write_file", pathPrefix: "reviewed" }],
    });
    host.respondProjectTrust(second.run, second.request.requestId, "trust");
    expect(settings.projectTrust).toBeUndefined();
    expect(mcpTools).toHaveBeenCalledOnce();
    host.respondProjectTrust(changed.run, changed.request.requestId, "trust");
    await secondTurn;
    expect(mcpTools.mock.lastCall?.[1]).toEqual([
      expect.objectContaining({ name: "fixture", project: expect.objectContaining({ directory }) }),
    ]);
    expect(readFileSync(join(directory, "reviewed", "allowed.txt"), "utf8")).toBe("allowed");
    expect(existsSync(join(directory, "reviewed-sibling", "needs-approval.txt"))).toBe(false);
    expect(approvals).toHaveLength(1);
    expect(completed.mock.lastCall?.[3]).toBe(settings.projectTrust?.[directory]?.fingerprint);

    settings = revokeProjectTrust(settings, directory);
    const thirdTurn = host.prompt("Stop while waiting for trust");
    const third = await waiting(changed.request.requestId);
    host.abort(third.run);
    await thirdTurn;
    host.respondProjectTrust(third.run, third.request.requestId, "trust");
    expect(host.getSnapshot().pendingProjectTrust).toBeNull();
    expect(mcpTools).toHaveBeenCalledTimes(2);
    expect(settings.projectTrust?.[directory]).toBeUndefined();
  } finally {
    await host.stopForExit();
  }
});

it("keeps a failed planning turn read-only on retry and discards the proposal without executing it", async () => {
  using profile = mkdtempDisposableSync(join(tmpdir(), "pilot-plan-retry-"));
  const root = realpathSync(profile.path);
  const store = new SessionStore(join(root, "sessions"));
  const provider = { id: "faux", kind: "faux", name: "Faux", modelId: "faux-default" } as const;
  const settings: Settings = { providers: [provider], activeProviderId: provider.id };
  const faux = fauxProvider({ tokensPerSecond: 100_000 });
  faux.appendResponses([
    fauxAssistantMessage([], { stopReason: "error", errorMessage: "401 Unauthorized" }),
    fauxAssistantMessage([
      fauxToolCall("write_file", { path: "unsafe.txt", content: "Should never execute" }),
      fauxToolCall("propose_plan", { markdown: "1. Review the workspace." }),
    ]),
    fauxAssistantMessage([fauxText("Plan ready.")]),
  ]);
  const catalog = createModels();
  catalog.setProvider(faux.provider);
  using resolve = vi.spyOn(models, "resolveModel").mockReturnValue({
    model: faux.getModel()!,
    streamFn: (model, context, options) =>
      fixtureTitle(context) ?? catalog.streamSimple(model, context, options),
  });
  const host = new AgentHost({
    getSettings: () => settings,
    saveSettings: () => {},
    broadcast: () => {},
    store,
    skillsDir: join(root, "skills"),
    mcp: new McpManager(() => settings, "0.0.0"),
  });
  const { composerId } = host.openProject(root);
  host.setPlanMode(composerId, true);
  await host.prompt("Review the workspace before editing");
  const failed = host.getSnapshot().failedRun!;
  expect(failed).toBeTruthy();
  expect(store.getMeta(composerId)?.planMode?.proposal).toBeUndefined();
  host.setPlanMode(composerId, false);
  host.updateSessionSettings(composerId, { approvalMode: "full-access" });
  await host.resume(failed);
  expect(existsSync(join(root, "unsafe.txt"))).toBe(false);
  const pending = store.getMeta(composerId)?.planMode;
  expect(pending).toMatchObject({
    executionMode: "full-access",
    proposal: { id: expect.any(String) },
  });
  host.reviewPlan(composerId, pending!.proposal!.id, { type: "discard" });
  expect(store.getMeta(composerId)?.planMode).toBeUndefined();
  expect(store.getMeta(composerId)?.approvalMode).toBe("full-access");
  expect(existsSync(join(root, "unsafe.txt"))).toBe(false);
  expect(resolve).toHaveBeenCalledTimes(2);
});

it("previews a batch of file approvals, preserves decisions, and rejects a stale preview", async () => {
  using profile = mkdtempDisposableSync(join(tmpdir(), "pilot-approval-details-"));
  const root = realpathSync(profile.path);
  const sessions = join(root, "sessions");
  const existing = join(root, "existing.txt");
  writeFileSync(existing, "original\r\n");
  const provider = { id: "faux", kind: "faux", name: "Faux", modelId: "faux-default" } as const;
  const settings: Settings = { providers: [provider], activeProviderId: provider.id };
  const faux = fauxProvider({ tokensPerSecond: 100_000 });
  faux.appendResponses([
    fauxAssistantMessage([
      fauxToolCall("write_file", { path: "created.txt", content: "new content\n" }),
      fauxToolCall("edit_file", { path: "existing.txt", oldText: "original", newText: "changed" }),
      fauxToolCall("write_file", { path: "denied.txt", content: "denied\n" }),
    ]),
    fauxAssistantMessage([fauxText("Finished the approval fixture.")]),
  ]);
  const catalog = createModels();
  catalog.setProvider(faux.provider);
  const resolve = vi.spyOn(models, "resolveModel").mockReturnValue({
    model: faux.getModel()!,
    streamFn: (model, context, options) =>
      fixtureTitle(context) ?? catalog.streamSimple(model, context, options),
  });
  const requests: Extract<UiAgentEvent, { type: "permission_request" }>[] = [];
  const createHost = (): AgentHost =>
    new AgentHost({
      getSettings: () => settings,
      saveSettings: () => {},
      broadcast: (event) => {
        if (event.type !== "permission_request") return;
        requests.push(event);
        setTimeout(() => {
          if (event.file?.operation === "edit") writeFileSync(existing, "external change\r\n");
          const decision = event.position?.index === 3 ? "deny" : "once";
          host.respondPermission(event.run, event.requestId, decision);
        }, 0);
      },
      store: new SessionStore(sessions),
      skillsDir: join(root, "skills"),
      mcp: new McpManager(() => settings, "0.0.0"),
    });
  const host = createHost();
  try {
    host.openProject(root);
    await host.prompt("Inspect three file changes");
    expect(requests.map(({ position }) => position)).toEqual([
      { index: 1, total: 3 },
      { index: 2, total: 3 },
      { index: 3, total: 3 },
    ]);
    expect(requests[0].file).toMatchObject({
      path: join(root, "created.txt"),
      operation: "create",
      diff: { hunks: [[{ kind: "added", text: "new content" }]] },
    });
    expect(requests[1].file).toMatchObject({
      path: existing,
      operation: "edit",
      diff: {
        hunks: [
          [
            { kind: "removed", text: "original" },
            { kind: "added", text: "changed" },
          ],
        ],
      },
    });
    expect(readFileSync(join(root, "created.txt"), "utf8")).toBe("new content\n");
    expect(readFileSync(existing, "utf8")).toBe("external change\r\n");
    expect(existsSync(join(root, "denied.txt"))).toBe(false);
    const sessionId = host.getSnapshot().sessionId!;
    const restored = createHost().loadSession(sessionId);
    const tools = restored.messages
      .flatMap(({ parts }) => parts)
      .filter((part) => part.type === "tool");
    expect(tools).toMatchObject([
      { callId: requests[0].callId, state: "success", approval: { decision: "once" } },
      {
        callId: requests[1].callId,
        state: "error",
        error: expect.stringContaining("文件在生成预览后发生变化"),
        approval: { decision: "once" },
      },
      { callId: requests[2].callId, state: "error", approval: { decision: "deny" } },
    ]);
  } finally {
    resolve.mockRestore();
  }
});

it("publishes the result for a background failure and clears it after a successful retry", async () => {
  using profile = mkdtempDisposableSync(join(tmpdir(), "pilot-sidebar-results-"));
  const root = realpathSync(profile.path);
  const sessionPath = join(root, "sessions");
  const provider = { id: "faux", kind: "faux", name: "Faux", modelId: "faux-default" } as const;
  const settings: Settings = { providers: [provider], activeProviderId: provider.id };
  const faux = fauxProvider({ tokensPerSecond: 100_000 });
  faux.appendResponses([
    fauxAssistantMessage([], { stopReason: "error", errorMessage: "401 Unauthorized" }),
    fauxAssistantMessage([fauxText("Retried successfully.")]),
  ]);
  const catalog = createModels();
  catalog.setProvider(faux.provider);
  using resolve = vi.spyOn(models, "resolveModel").mockReturnValue({
    model: faux.getModel()!,
    streamFn: (model, context, options) =>
      fixtureTitle(context) ?? catalog.streamSimple(model, context, options),
  });
  const broadcast = vi.fn<(event: UiAgentEvent) => void>();
  const createHost = (): AgentHost =>
    new AgentHost({
      getSettings: () => settings,
      saveSettings: () => {},
      broadcast,
      store: new SessionStore(sessionPath),
      skillsDir: join(root, "skills"),
      mcp: new McpManager(() => settings, "0.0.0"),
    });

  const host = createHost();
  host.openProject(root);
  const running = host.prompt("Run that fails");
  const ref = host.getSnapshot().activeRuns[0]!;
  host.newSession();
  await running;

  const background = host.getSnapshot();
  expect(background.sessionId).toBeNull();
  expect(background.failedRun).toBeNull();
  expect(background.sessions).toMatchObject([{ id: ref.sessionId, lastRunResult: "failed" }]);
  expect(
    broadcast.mock.calls.some(
      ([event]) =>
        event.type === "sessions" &&
        event.sessions.some(
          (session) => session.id === ref.sessionId && session.lastRunResult === "failed",
        ),
    ),
  ).toBe(true);

  const restarted = createHost();
  expect(restarted.getSnapshot().sessions).toMatchObject([
    { id: ref.sessionId, lastRunResult: "failed" },
  ]);
  expect(restarted.loadSession(ref.sessionId).failedRun).toMatchObject({ runId: ref.runId });
  restarted.removeRecentProject(root);
  expect(restarted.getSnapshot()).toMatchObject({ sessionId: ref.sessionId, recentProjects: [] });
  expect(restarted.projectFolder(root)).toBe(root);
  expect(() => restarted.projectFolder(dirname(root))).toThrow("找不到该项目");
  await restarted.resume(ref);
  expect(restarted.getSnapshot()).toMatchObject({
    failedRun: null,
    sessions: [{ id: ref.sessionId, lastRunResult: "success" }],
  });
  expect(createHost().getSnapshot().sessions).toMatchObject([{ lastRunResult: "success" }]);
  expect(resolve).toHaveBeenCalled();
});

it("restores project drafts and their settings before creating a chat on the first send", async () => {
  using profile = mkdtempDisposableSync(join(tmpdir(), "pilot-session-settings-"));
  const root = realpathSync(profile.path);
  const sessions = join(root, "sessions");
  const next = join(root, "next");
  mkdirSync(next);
  const providers = [
    { id: "default", kind: "faux", name: "Default", modelId: "general" },
    { id: "alpha", kind: "faux", name: "Alpha", modelId: "model-a" },
    { id: "beta", kind: "faux", name: "Beta", modelId: "model-b" },
  ] as const;
  const settings: Settings = {
    providers: [...providers],
    activeProviderId: "default",
    approvalMode: "standard",
  };
  const permissionRequests: string[] = [];
  const createHost = (): AgentHost => {
    const host = new AgentHost({
      getSettings: () => settings,
      saveSettings: vi.fn<(value: Settings) => void>(),
      broadcast: (event) => {
        if (event.type === "permission_request") {
          permissionRequests.push(event.requestId);
          setTimeout(() => host.respondPermission(event.run, event.requestId, "deny"), 0);
        }
      },
      store: new SessionStore(sessions),
      skillsDir: join(root, "skills"),
      mcp: new McpManager(() => settings, "0.0.0"),
    });
    return host;
  };
  const host = createHost();
  const draftA: ComposerDraft = [
    "ALPHA\n",
    { type: "file", id: "readme.md", label: "readme.md", meta: { workingDirectory: root } },
  ];
  const draftB: ComposerDraft = [" BETA\n "];
  const modelA = { providerId: "alpha", modelId: "model-a" };
  const modelB = { providerId: "beta", modelId: "model-b" };
  const a = host.getSnapshot().composerId;
  host.saveSessionDraft(a, draftA);
  host.updateSessionSettings(a, { model: modelA, approvalMode: "read-only" });
  expect(await host.bindProject(a, root)).toMatchObject({
    composerId: a,
    composerDraft: draftA,
    draftWorkingDirectory: root,
    sessionId: null,
    sessions: [],
  });

  const b = host.openProject(next).composerId;
  expect(b).not.toBe(a);
  expect(() => host.saveSessionDraft(a, ["stale"])).toThrow("会话已切换");
  host.updateSessionSettings(b, { model: modelB, approvalMode: "full-access" });
  host.saveSessionDraft(b, draftB);
  expect(host.verificationScope(b, next)).toMatchObject({ sessionId: b, workingDirectory: next });
  expect(() => host.prompt("Stale project", b, root)).toThrow("工作目录已变更");
  expect(host.getSnapshot().sessions).toEqual([]);

  for (const current of [host, createHost()]) {
    const alpha = current.openProject(root);
    expect(alpha).toMatchObject({
      composerId: a,
      composerDraft: draftA,
      draftWorkingDirectory: root,
      draftSettings: { model: modelA, approvalMode: "read-only" },
      sessions: [],
    });
    const beta = current.openProject(next);
    expect(beta).toMatchObject({
      composerId: b,
      composerDraft: draftB,
      draftWorkingDirectory: next,
      draftSettings: { model: modelB, approvalMode: "full-access" },
      sessions: [],
    });
    expect(beta.settings).toMatchObject({ activeProviderId: "default", approvalMode: "standard" });
  }

  const restarted = createHost();
  const resolve = vi.spyOn(models, "resolveModel");
  try {
    restarted.openProject(root);
    await restarted.prompt("A 演示", a);
    const file = join(root, "pilot-demo.txt");
    expect(existsSync(file)).toBe(false);
    expect(restarted.getSnapshot()).toMatchObject({
      sessionId: a,
      composerDraft: [],
      sessions: [{ id: a, approvalMode: "read-only", model: modelA }],
    });

    restarted.openProject(next);
    expect(restarted.getSnapshot().composerDraft).toEqual(draftB);
    await restarted.prompt("B 演示", b);
    expect(existsSync(join(next, "pilot-demo.txt"))).toBe(true);
    expect(restarted.getSnapshot().sessionId).toBe(b);
    expect(permissionRequests).toEqual([]);
    expect(resolve.mock.calls.map(([provider]) => [provider.id, provider.modelId])).toEqual([
      ["alpha", "model-a"],
      ["beta", "model-b"],
    ]);
  } finally {
    resolve.mockRestore();
  }
});

it("uses the global defaults for older chats and after clearing session settings", async () => {
  using profile = mkdtempDisposableSync(join(tmpdir(), "pilot-session-defaults-"));
  const sessions = join(profile.path, "sessions");
  const store = new SessionStore(sessions);
  const old = store.create();
  const primary = { id: "primary", kind: "faux", name: "Primary", modelId: "basic" } as const;
  const alternate = { id: "alternate", kind: "faux", name: "Alternate", modelId: "alt" } as const;
  const settings: Settings = {
    providers: [primary, alternate],
    activeProviderId: "primary",
    approvalMode: "read-only",
    workingDirectory: realpathSync(profile.path),
  };
  const host = new AgentHost({
    getSettings: () => settings,
    saveSettings: vi.fn<(value: Settings) => void>(),
    broadcast: vi.fn<(event: UiAgentEvent) => void>(),
    store,
    skillsDir: join(profile.path, "skills"),
    mcp: new McpManager(() => settings, "0.0.0"),
  });
  const resolve = vi.spyOn(models, "resolveModel");
  try {
    expect((await host.loadSession(old.id)).composerDraft).toEqual([]);
    await host.prompt("Use the original default: 演示");
    const file = join(profile.path, "pilot-demo.txt");
    expect(existsSync(file)).toBe(false);
    host.updateSessionSettings(old.id, {
      model: { providerId: "primary", modelId: "basic" },
      approvalMode: "read-only",
    });
    settings.activeProviderId = "alternate";
    settings.providers = [alternate];
    settings.approvalMode = "full-access";
    await host.prompt("Use the default model when the previous provider was removed: 演示");
    expect(existsSync(file)).toBe(false);
    host.updateSessionSettings(old.id, { model: null, approvalMode: null });
    await host.prompt("Use both defaults: 演示");
    expect(existsSync(file)).toBe(true);
    expect(resolve.mock.calls.map(([provider]) => provider.modelId)).toEqual(["basic", "alt"]);
    const saved = new SessionStore(sessions).getMeta(old.id);
    expect(saved?.model).toBeUndefined();
    expect(saved?.approvalMode).toBeUndefined();
  } finally {
    resolve.mockRestore();
  }
});

it("keeps queued file references in the working directory of the active run", async () => {
  using profile = mkdtempDisposableSync(join(tmpdir(), "pi-agent-references-"));
  mkdirSync(join(profile.path, "original"));
  mkdirSync(join(profile.path, "next"));
  const original = realpathSync(join(profile.path, "original"));
  const next = realpathSync(join(profile.path, "next"));
  const provider = { id: "faux", kind: "faux", name: "Faux", modelId: "faux-default" } as const;
  const settings: Settings = {
    providers: [provider],
    activeProviderId: provider.id,
    workingDirectory: original,
  };
  const mcp = new McpManager(() => settings, "0.0.0");
  const preparation = Promise.withResolvers<AgentTool[]>();
  vi.spyOn(mcp, "openToolSession").mockReturnValueOnce(mcpToolSession(preparation.promise));
  const host = new AgentHost({
    getSettings: () => settings,
    saveSettings: vi.fn<(value: Settings) => void>(),
    broadcast: vi.fn<(event: UiAgentEvent) => void>(),
    store: new SessionStore(join(profile.path, "sessions")),
    skillsDir: join(profile.path, "skills"),
    mcp,
  });

  const running = host.prompt("First reply");
  try {
    expect(() => host.checkWorkingDirectory(original)).not.toThrow();
    settings.workingDirectory = next;
    expect(() => host.checkWorkingDirectory(original)).not.toThrow();
    expect(() => host.checkWorkingDirectory(next)).toThrow("工作目录已变更");
  } finally {
    preparation.resolve([]);
    await running;
  }
  expect(host.getWorkingDirectory()).toBe(original);
  expect((await host.newSession()).draftWorkingDirectory).toBe(original);
});

it("uses each project's files and tools after switching and reopening sessions", async () => {
  using profile = mkdtempDisposableSync(join(tmpdir(), "pilot-project-sessions-"));
  const root = realpathSync(profile.path);
  const alpha = join(root, "Project Alpha");
  const beta = join(root, "项目 Beta");
  mkdirSync(alpha);
  mkdirSync(beta);
  writeFileSync(join(alpha, "alpha.md"), "Alpha reference");
  writeFileSync(join(beta, "beta.md"), "Beta reference");
  writeFileSync(join(alpha, "pilot-demo.txt"), "Alpha original");
  writeFileSync(join(beta, "pilot-demo.txt"), "Beta original");

  const provider = { id: "faux", kind: "faux", name: "Faux", modelId: "faux-default" } as const;
  const settings: Settings = {
    providers: [provider],
    activeProviderId: provider.id,
    workingDirectory: root,
    approvalMode: "full-access",
  };
  const createHost = (): AgentHost =>
    new AgentHost({
      getSettings: () => settings,
      saveSettings: vi.fn<(value: Settings) => void>(),
      broadcast: vi.fn<(event: UiAgentEvent) => void>(),
      store: new SessionStore(join(root, "sessions")),
      skillsDir: join(root, "skills"),
      mcp: new McpManager(() => settings, "0.0.0"),
    });
  const host = createHost();
  const opened = await host.openProject(alpha);
  expect(opened).toMatchObject({ sessionId: null, draftWorkingDirectory: alpha });
  await host.prompt("Alpha 演示");
  const alphaId = host.getSnapshot().sessionId!;
  expect(readFileSync(join(alpha, "pilot-demo.txt"), "utf8")).toContain("faux");
  expect(readFileSync(join(beta, "pilot-demo.txt"), "utf8")).toBe("Beta original");

  await host.openProject(beta);
  await host.prompt("Beta 演示");
  const betaId = host.getSnapshot().sessionId!;
  expect(readFileSync(join(beta, "pilot-demo.txt"), "utf8")).toContain("faux");
  await host.loadSession(alphaId);
  expect(await searchWorkspace(host.getWorkingDirectory(), ".md")).toEqual([
    { path: "alpha.md", kind: "file" },
  ]);
  expect(() => host.checkWorkingDirectory(beta)).toThrow("工作目录已变更");
  expect(() =>
    previewWorkspaceReference(host.getWorkingDirectory(), {
      path: "beta.md",
      workingDirectory: beta,
    }),
  ).toThrow("工作目录已变更");

  const restarted = createHost();
  for (const [id, directory, path, text] of [
    [alphaId, alpha, "alpha.md", "Alpha reference"],
    [betaId, beta, "beta.md", "Beta reference"],
  ]) {
    const snapshot = await restarted.loadSession(id);
    expect(snapshot.sessions.find((session) => session.id === id)?.workingDirectory).toBe(
      directory,
    );
    expect(previewWorkspaceReference(restarted.getWorkingDirectory(), { path })).toMatchObject({
      text,
    });
  }
}, 10000);

it("reopens a recent project after restart and links an old chat without changing its transcript", async () => {
  using profile = mkdtempDisposableSync(join(tmpdir(), "pilot-legacy-session-"));
  const root = realpathSync(profile.path);
  const sessions = join(root, "sessions");
  const directory = join(root, "recent project");
  mkdirSync(directory);
  const store = new SessionStore(sessions);
  const { id } = store.create();
  const transcript = join(sessions, id + ".jsonl");
  store.save(id, [{ role: "user", content: "Earlier conversation", timestamp: 1 }]);
  const original = readFileSync(transcript, "utf8");
  const settings: Settings = { providers: [], activeProviderId: "", workingDirectory: root };
  const createHost = (): AgentHost =>
    new AgentHost({
      getSettings: () => settings,
      saveSettings: vi.fn<(value: Settings) => void>(),
      broadcast: vi.fn<(event: UiAgentEvent) => void>(),
      store: new SessionStore(sessions),
      skillsDir: join(root, "skills"),
      mcp: new McpManager(() => settings, "0.0.0"),
    });
  await createHost().openProject(directory);
  const host = createHost();
  expect(host.getSnapshot()).toMatchObject({
    draftWorkingDirectory: null,
    recentProjects: [directory],
    sessions: [{ id }],
  });
  expect(() => host.useRecentProject(root)).toThrow("找不到该最近项目");
  expect((await host.useRecentProject(directory)).draftWorkingDirectory).toBe(directory);
  const before = await host.loadSession(id);
  expect(before.sessions.find((session) => session.id === id)?.workingDirectory).toBeUndefined();
  expect(host.getWorkingDirectory()).toBe(root);
  expect(host.copySession(id)).toContain("Earlier conversation");
  const after = await host.useRecentProject(directory, id);
  expect(after.messages).toEqual(before.messages);
  expect(after.sessionId).toBe(id);
  expect(new SessionStore(sessions).getMeta(id)?.workingDirectory).toBe(directory);
  expect(readFileSync(transcript, "utf8")).toBe(original);
  await expect(host.bindProject(id, sessions)).rejects.toThrow("该会话已关联项目");
  host.forkSession(id);
  expect(host.getSnapshot().sessions.find((session) => session.id !== id)?.workingDirectory).toBe(
    directory,
  );
});

it("keeps the original run and draft separate when switching to an overlapping folder", async () => {
  using profile = mkdtempDisposableSync(join(tmpdir(), "pilot-project-switch-"));
  const original = realpathSync(profile.path);
  const next = join(original, "next");
  mkdirSync(next);
  const provider = { id: "faux", kind: "faux", name: "Faux", modelId: "faux-default" } as const;
  const settings: Settings = { providers: [provider], activeProviderId: provider.id };
  const requested = Promise.withResolvers<Extract<UiAgentEvent, { type: "permission_request" }>>();
  const store = new SessionStore(join(original, "sessions"));
  const broadcast = vi.fn<(event: UiAgentEvent) => void>((event) => {
    if (event.type === "permission_request") requested.resolve(event);
  });
  const mcp = new McpManager(() => settings, "0.0.0");
  const tools = vi.spyOn(mcp, "openToolSession");
  const host = new AgentHost({
    getSettings: () => settings,
    saveSettings: vi.fn<(value: Settings) => void>(),
    broadcast,
    store,
    skillsDir: join(original, "skills"),
    mcp,
  });
  const a = host.openProject(original).composerId;
  host.saveSessionDraft(a, ["Original 演示"]);
  const b = host.openProject(next).composerId;
  host.updateSessionSettings(b, { approvalMode: "full-access" });
  host.saveSessionDraft(b, ["B draft"]);
  host.openProject(original);

  const running = host.prompt("Original 演示", a);
  const ref = host.getSnapshot().activeRuns[0]!;
  const invalid = { sessionId: a, runId: b };
  try {
    await vi.waitFor(() => expect(tools).toHaveBeenCalledWith(original, []));
    expect(host.openProject(next)).toMatchObject({
      status: "idle",
      sessionId: null,
      composerId: b,
      composerDraft: ["B draft"],
      messages: [],
      pendingPermissions: [],
      activeRuns: [ref],
    });
    expect(host.getWorkingDirectory()).toBe(next);
    settings.approvalMode = "read-only";
    const request = await requested.promise;
    expect(host.prompt("Blocked send", b)).toMatchObject({
      kind: "workspace",
      run: { sessionId: a, runId: ref.runId },
    });
    expect(store.loadDraft(b)).toEqual(["B draft"]);
    expect(host.getSnapshot().pendingPermissions).toEqual([]);
    host.respondPermission(ref, request.requestId, "once");
    host.abort(ref);

    const restored = host.loadSession(a);
    expect(restored.status).toBe("waiting_approval");
    expect(restored.pendingPermissions).toMatchObject([{ requestId: request.requestId }]);
    expect(restored.messages[0].parts).toEqual([{ type: "text", text: "Original 演示" }]);
    host.respondPermission(invalid, request.requestId, "deny");
    host.abort(invalid);
    expect(host.getSnapshot().pendingPermissions).toHaveLength(1);
    host.respondPermission(ref, request.requestId, "once");
    expect(host.getSnapshot()).toMatchObject({ status: "streaming", pendingPermissions: [] });

    host.openProject(next);
    await running;
    expect(host.getSnapshot()).toMatchObject({
      sessionId: null,
      composerId: b,
      activeRuns: [],
      messages: [],
      composerDraft: ["B draft"],
    });
    expect(existsSync(join(original, "pilot-demo.txt"))).toBe(true);
    expect(existsSync(join(next, "pilot-demo.txt"))).toBe(false);
    expect(store.load(b)).toEqual([]);
    expect(store.load(a)).toContainEqual(
      expect.objectContaining({ role: "toolResult", isError: false }),
    );
    const scoped = broadcast.mock.calls.map(([event]) => event).filter((event) => "run" in event);
    expect(scoped.length).toBeGreaterThan(0);
    for (const { run } of scoped) expect(run).toMatchObject({ sessionId: a, runId: ref.runId });
  } finally {
    host.loadSession(a);
    host.abort(ref);
    await running;
  }
});

it("runs distinct workspaces together and preserves both checkpoints when exiting", async () => {
  using profile = mkdtempDisposableSync(join(tmpdir(), "pilot-parallel-"));
  const root = realpathSync(profile.path);
  const projectA = join(root, "A");
  const dirA = join(projectA, "first");
  const aliasA = join(projectA, "second");
  const dirB = join(root, "B");
  const dirC = join(root, "C");
  for (const directory of [dirA, aliasA, dirB, dirC]) mkdirSync(directory, { recursive: true });
  execFileSync("git", ["init", "-q", "--template="], { cwd: projectA });
  const provider = { id: "faux", kind: "faux", name: "Faux", modelId: "faux-default" } as const;
  const settings: Settings = { providers: [provider], activeProviderId: provider.id };
  const sessions = join(root, "sessions");
  const store = new SessionStore(sessions);
  const host = new AgentHost({
    getSettings: () => settings,
    saveSettings: (value) => Object.assign(settings, value),
    broadcast: () => {},
    store,
    skillsDir: join(root, "skills"),
    mcp: new McpManager(() => settings, "0.0.0"),
  });
  const idA = host.openProject(dirA).composerId;
  const first = host.prompt("A 演示", idA);
  const [a] = host.getSnapshot().activeRuns;
  const sameWorkspace = host.openProject(aliasA);
  const idB = host.openProject(dirB).composerId;
  const second = host.prompt("B 演示", idB);
  const [, b] = host.getSnapshot().activeRuns;
  const idC = host.openProject(dirC).composerId;
  let third: ReturnType<AgentHost["prompt"]> | undefined;
  try {
    expect(first).toBeInstanceOf(Promise);
    expect(second).toBeInstanceOf(Promise);
    expect(sameWorkspace.workspaceRunIds).toEqual([a.runId]);
    expect([a, b].map(({ sessionId, workingDirectory }) => [sessionId, workingDirectory])).toEqual([
      [idA, dirA],
      [idB, dirB],
    ]);
    host.saveSessionDraft(idC, ["C 演示"]);
    expect(host.prompt("C 演示", idC)).toEqual({ kind: "capacity" });
    expect(host.getSnapshot()).toMatchObject({
      sessionId: null,
      composerDraft: ["C 演示"],
      workspaceRunIds: [],
    });
    expect(store.getMeta(idC)).toBeNull();
    await vi.waitFor(() =>
      expect(host.getSnapshot().activeRuns.map(({ status }) => status)).toEqual([
        "waiting_approval",
        "waiting_approval",
      ]),
    );
    const [requestB] = host.loadSession(idB).pendingPermissions;
    const [requestA] = host.loadSession(idA).pendingPermissions;
    host.respondPermission(a, requestB.requestId, "once");
    host.abort(b);
    expect(host.getSnapshot().pendingPermissions).toEqual([requestA]);
    host.respondPermission(a, requestA.requestId, "session");
    host.loadSession(idB);
    await first;
    expect(host.getSnapshot()).toMatchObject({
      activeRuns: [{ sessionId: idB, status: "waiting_approval" }],
      pendingPermissions: [requestB],
    });
    expect(existsSync(join(dirA, "pilot-demo.txt"))).toBe(true);
    expect(existsSync(join(dirB, "pilot-demo.txt"))).toBe(false);
    expect(host.openProject(dirC).composerId).toBe(idC);
    third = host.prompt("C 演示", idC);
    expect(third).toBeInstanceOf(Promise);
    await vi.waitFor(() => expect(host.getSnapshot().pendingPermissions).toHaveLength(1));
    host.saveSessionDraft(idC, ["C next draft"]);
    await host.stopForExit();
    expect(host.hasActiveRun()).toBe(false);
    expect(host.getSnapshot().activeRuns).toEqual([]);
    const reopened = new SessionStore(sessions);
    expect(reopened.checkpoint(idA)).toBeUndefined();
    expect(reopened.checkpoint(idB)).toMatchObject({ runId: b.runId, workingDirectory: dirB });
    expect(reopened.checkpoint(idC)).toMatchObject({ workingDirectory: dirC });
    expect(reopened.loadDraft(idC)).toEqual(["C next draft"]);
    expect(existsSync(join(dirC, "pilot-demo.txt"))).toBe(false);
  } finally {
    await host.stopForExit();
    await Promise.all([first, second, third]);
  }
});

it("holds the run lock while stopping and ignores stop and queue actions from an earlier run", async () => {
  using profile = mkdtempDisposableSync(join(tmpdir(), "pilot-run-stop-"));
  const provider = { id: "faux", kind: "faux", name: "Faux", modelId: "faux-default" } as const;
  const settings: Settings = { providers: [provider], activeProviderId: provider.id };
  const mcp = new McpManager(() => settings, "0.0.0");
  const firstPreparation = Promise.withResolvers<AgentTool[]>();
  const secondPreparation = Promise.withResolvers<AgentTool[]>();
  vi.spyOn(mcp, "openToolSession")
    .mockReturnValueOnce(mcpToolSession(firstPreparation.promise))
    .mockReturnValueOnce(mcpToolSession(secondPreparation.promise));
  const store = new SessionStore(join(profile.path, "sessions"));
  const b = store.create().id;
  store.saveDraft(b, ["Second chat"]);
  const host = new AgentHost({
    getSettings: () => settings,
    saveSettings: vi.fn<(value: Settings) => void>(),
    broadcast: vi.fn<(event: UiAgentEvent) => void>(),
    store,
    skillsDir: join(profile.path, "skills"),
    mcp,
  });

  const a = host.newSession().composerId;
  host.saveSessionDraft(a, ["First"]);
  const first = host.prompt("First", a);
  const previous = host.getSnapshot().activeRuns[0]!;
  try {
    const interrupted = new SessionStore(join(profile.path, "sessions"));
    expect(interrupted.checkpoint(a)).toMatchObject({
      runId: previous.runId,
      workingDirectory: previous.workingDirectory,
    });
    expect(interrupted.load(a)).toContainEqual(
      expect.objectContaining({ role: "user", content: "First" }),
    );
    expect(interrupted.loadDraft(a)).toEqual([]);
    host.abort(previous);
    host.loadSession(b);
    expect(host.prompt("Second chat", b)).toEqual({
      kind: "workspace",
      run: { sessionId: a, runId: previous.runId },
    });
    expect(host.getSnapshot().composerDraft).toEqual(["Second chat"]);
  } finally {
    firstPreparation.resolve([]);
    await first;
  }

  host.loadSession(a);
  expect(host.getSnapshot().interruptedRun).toBeNull();
  const second = host.prompt("A new run", a);
  const active = host.getSnapshot().activeRuns[0]!;
  try {
    expect(active.runId).not.toBe(previous.runId);
    await host.prompt("Queued in A", a);
    expect(new SessionStore(join(profile.path, "sessions")).load(a).at(-1)).toMatchObject({
      content: "Queued in A",
    });
    host.loadSession(b);
    host.clearQueue(active);
    host.loadSession(a);
    host.clearQueue(previous);
    host.abort(previous);
    expect(host.getSnapshot()).toMatchObject({ status: "streaming", steerCount: 1 });
    host.clearQueue(active);
    expect(host.getSnapshot().steerCount).toBe(0);
    expect(new SessionStore(join(profile.path, "sessions")).load(a).at(-1)).toMatchObject({
      content: "A new run",
    });
  } finally {
    host.abort(active);
    secondPreparation.resolve([]);
    await second;
  }
});

it("preserves a resumable checkpoint and draft when quitting during approval", async () => {
  using profile = mkdtempDisposableSync(join(tmpdir(), "pilot-quit-agent-"));
  const directory = realpathSync(profile.path);
  const sessions = join(directory, "sessions");
  const provider = { id: "faux", kind: "faux", name: "Faux", modelId: "faux-default" } as const;
  const settings: Settings = { providers: [provider], activeProviderId: provider.id };
  const host = new AgentHost({
    getSettings: () => settings,
    saveSettings: vi.fn<(value: Settings) => void>(),
    broadcast: vi.fn<(event: UiAgentEvent) => void>(),
    store: new SessionStore(sessions),
    skillsDir: join(directory, "skills"),
    mcp: new McpManager(() => settings, "0.0.0"),
  });
  const id = host.openProject(directory).composerId;
  const prompt = "退出期间的演示";
  const running = host.prompt(prompt, id);
  const ref = host.getSnapshot().activeRuns[0]!;
  try {
    await vi.waitFor(() => expect(host.getSnapshot().pendingPermissions).toHaveLength(1));
    host.saveSessionDraft(id, ["下次继续时的草稿"]);
    await host.stopForExit();
    expect(host.getSnapshot()).toMatchObject({
      activeRuns: [],
      pendingPermissions: [],
      interruptedRun: { runId: ref.runId, sessionId: id, workingDirectory: directory },
      composerDraft: ["下次继续时的草稿"],
    });
    const reopened = new SessionStore(sessions);
    expect(reopened.checkpoint(id)).toMatchObject({
      runId: ref.runId,
      workingDirectory: directory,
    });
    expect(reopened.load(id).filter((message) => message.role === "user")).toEqual([
      expect.objectContaining({ content: prompt }),
    ]);
    expect(reopened.loadDraft(id)).toEqual(["下次继续时的草稿"]);
    expect(existsSync(join(directory, "pilot-demo.txt"))).toBe(false);
  } finally {
    host.abort(ref);
    await running;
  }
});

it("waits for run cleanup when exit starts from the run_started notification", async () => {
  using profile = mkdtempDisposableSync(join(tmpdir(), "pilot-exit-on-start-"));
  const provider = { id: "faux", kind: "faux", name: "Faux", modelId: "faux-default" } as const;
  const settings: Settings = { providers: [provider], activeProviderId: provider.id };
  const baseline = Promise.withResolvers<GitSnapshot>();
  using capture = vi.spyOn(gitChanges, "captureGitSnapshot").mockReturnValueOnce(baseline.promise);
  const store = new SessionStore(join(profile.path, "sessions"));
  let exit: Promise<void> | undefined;
  let exited = false;
  const host = new AgentHost({
    getSettings: () => settings,
    saveSettings: vi.fn<(value: Settings) => void>(),
    broadcast: (event) => {
      if (event.type === "run_started") {
        exit = host.stopForExit().then(() => {
          exited = true;
        });
      }
    },
    store,
    skillsDir: join(profile.path, "skills"),
    mcp: new McpManager(() => settings, "0.0.0"),
  });
  const running = host.prompt("Save this task for later");
  try {
    expect(capture).toHaveBeenCalledOnce();
    expect(exit).toBeInstanceOf(Promise);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(exited).toBe(false);
    expect(host.getSnapshot().status).toBe("stopping");

    baseline.resolve(null);
    await exit;
    expect(host.getSnapshot()).toMatchObject({
      activeRuns: [],
      interruptedRun: { sessionId: host.getSnapshot().sessionId },
    });
  } finally {
    baseline.resolve(null);
    await running;
  }
});

it("resumes with a new run ID and blocks replay of an action recorded in the checkpoint", async () => {
  using profile = mkdtempDisposableSync(join(tmpdir(), "pilot-resume-action-"));
  const directory = realpathSync(profile.path);
  const store = new SessionStore(join(directory, "sessions"));
  const session = store.create(directory);
  const runId = randomUUID();
  const task = { taskId: runId, agentRunId: runId, title: "Original task" };
  const args = { path: "result.txt", content: "original tool output" };
  const action = actionFingerprint("write_file", args, directory)!;
  const path = join(directory, args.path);
  writeFileSync(path, "user changes after interruption");
  store.save(session.id, [{ role: "user", content: task.title, timestamp: 1 }], {
    type: "pilot_run_checkpoint",
    runId,
    workingDirectory: directory,
    startIndex: 0,
    pending: [],
    actions: [action],
    gitBaseline: null,
    task,
  });
  const faux = fauxProvider({ tokensPerSecond: 100_000 });
  faux.appendResponses([
    fauxAssistantMessage([fauxToolCall("write_file", args)], { stopReason: "toolUse" }),
    fauxAssistantMessage([fauxText("Checked the saved action.")]),
  ]);
  const catalog = createModels();
  catalog.setProvider(faux.provider);
  using resolveModel = vi.spyOn(models, "resolveModel").mockReturnValue({
    model: faux.getModel()!,
    streamFn: (model, context, options) =>
      fixtureTitle(context) ?? catalog.streamSimple(model, context, options),
  });
  const provider = { id: "faux", kind: "faux", name: "Faux", modelId: "faux-default" } as const;
  const settings: Settings = {
    providers: [provider],
    activeProviderId: provider.id,
    approvalMode: "full-access",
  };
  const events: UiAgentEvent[] = [];
  const host = new AgentHost({
    getSettings: () => settings,
    saveSettings: vi.fn<(value: Settings) => void>(),
    broadcast: (event) => {
      events.push(event);
    },
    store,
    skillsDir: join(directory, "skills"),
    mcp: new McpManager(() => settings, "0.0.0"),
  });
  const ref = { sessionId: session.id, runId };
  expect(host.loadSession(session.id).interruptedRun).toMatchObject(ref);
  await host.resume(ref);

  expect(resolveModel).toHaveBeenCalledOnce();
  expect(readFileSync(path, "utf8")).toBe("user changes after interruption");
  const started = events.find((event) => event.type === "run_started");
  expect(started?.run).toMatchObject({ sessionId: session.id, workingDirectory: directory });
  expect(started?.run.runId).not.toBe(runId);
  expect(
    events.some((event) => event.type === "tool_start" || event.type === "permission_request"),
  ).toBe(false);
  expect(events.find((event) => event.type === "tool_end")).toMatchObject({
    state: "error",
    output: expect.stringContaining("already started before the interruption"),
  });
  expect(store.getMeta(session.id)?.lastTask).toMatchObject({
    ...task,
    agentRunId: started?.run.runId,
  });
  expect(store.checkpoint(session.id)).toBeUndefined();
  expect(host.getSnapshot().activeRuns).toEqual([]);
});

it("declares the current MCP tools on the first request and refreshes a resumed prompt", async () => {
  using profile = mkdtempDisposableSync(join(tmpdir(), "pi-agent-host-"));
  const provider = { id: "faux", kind: "faux", name: "Faux", modelId: "faux-default" } as const;
  const settings: Settings = { providers: [provider], activeProviderId: provider.id };
  const mcp = new McpManager(() => settings, "0.0.0");
  const externalTool: AgentTool = {
    name: "mcp_fixture_echo",
    description: "A test MCP tool",
    label: "Fixture echo",
    parameters: obj({}),
    execute: async () => ({ content: [], details: undefined }),
  };
  vi.spyOn(mcp, "openToolSession")
    .mockReturnValueOnce(mcpToolSession(Promise.resolve([externalTool])))
    .mockReturnValueOnce(mcpToolSession());
  const host = new AgentHost({
    getSettings: () => settings,
    saveSettings: vi.fn<(value: Settings) => void>(),
    broadcast: vi.fn<(event: UiAgentEvent) => void>(),
    store: new SessionStore(join(profile.path, "sessions")),
    skillsDir: join(profile.path, "skills"),
    mcp,
  });
  const original = models.resolveModel(provider, undefined);
  const requests: { tools: string[]; prompt: string }[] = [];
  const resolveModel = vi.spyOn(models, "resolveModel").mockReturnValue({
    model: original.model,
    streamFn: (model, context, options) => {
      const generated = fixtureTitle(context);
      if (generated) return generated;
      requests.push({
        tools: getCurrentTools(context.messages).map((tool) => tool.name),
        prompt: getCurrentSystemPrompt(context.messages),
      });
      return original.streamFn(model, context, options);
    },
  });

  try {
    await host.prompt("First reply");
    settings.persona = "An updated instruction for the same chat";
    await host.prompt("Second reply");
    expect(requests).toHaveLength(2);
    expect(requests[0].tools).toContain(externalTool.name);
    expect(requests[1].tools).toContain("update_plan");
    expect(requests[1].tools).not.toContain(externalTool.name);
    expect(requests[1].prompt).toContain(settings.persona);
  } finally {
    resolveModel.mockRestore();
  }
});

it("rebuilds the cached model after capability edits for the same saved model", async () => {
  using profile = mkdtempDisposableSync(join(tmpdir(), "pilot-capability-host-"));
  const settings: Settings = {
    activeProviderId: "demo",
    providers: [
      {
        id: "demo",
        kind: "faux",
        name: "Demo",
        modelId: "faux-default",
        models: [{ id: "faux-default", name: "Demo" }],
      },
    ],
  };
  const provider = settings.providers[0];
  const host = new AgentHost({
    getSettings: () => settings,
    saveSettings: vi.fn<(settings: Settings) => void>(),
    broadcast: vi.fn<(event: UiAgentEvent) => void>(),
    store: new SessionStore(join(profile.path, "sessions")),
    skillsDir: join(profile.path, "skills"),
    mcp: new McpManager(() => settings, "0.0.0"),
  });
  await host.prompt("First request");
  const selection = host.getSnapshot();
  expect(selection.contextWindow).toBe(128_000);
  provider.models = [
    {
      id: "faux-default",
      name: "Demo",
      overrides: { contextWindow: 8192, maxTokens: 1024, supportsImages: false },
    },
  ];
  expect(host.getSnapshot().contextWindow).toBe(8192);
  const run = host.prompt("Second request");
  expect(host.getSnapshot().activeRuns[0]?.modelCapabilities).toMatchObject({
    contextWindow: 8192,
    maxTokens: 1024,
    supportsImages: false,
  });
  await run;
  expect(host.getSnapshot().messages.filter((message) => message.role === "user")).toHaveLength(2);
});

it("loads the selected project's instructions ahead of personalization and skills", async () => {
  using profile = mkdtempDisposableSync(join(tmpdir(), "pilot-project-instructions-"));
  const root = realpathSync(profile.path);
  const alpha = join(root, "alpha");
  const beta = join(root, "beta");
  const skillsDir = join(root, "skills");
  mkdirSync(alpha);
  mkdirSync(beta);
  mkdirSync(join(skillsDir, "review"), { recursive: true });
  const fileA = join(alpha, "AGENTS.md");
  const fileB = join(beta, "CLAUDE.md");
  writeFileSync(fileA, "ALPHA_PROJECT_GUIDANCE");
  writeFileSync(join(alpha, "CLAUDE.md"), "ALPHA_FALLBACK_GUIDANCE");
  writeFileSync(fileB, "BETA_PROJECT_GUIDANCE");
  writeFileSync(
    join(skillsDir, "review", "SKILL.md"),
    "---\nname: Review\ndescription: REVIEW_DESCRIPTION\n---\nSKILL_GUIDANCE",
  );
  const projectSkill = join(alpha, ".agents", "skills", "checklist");
  mkdirSync(projectSkill, { recursive: true });
  writeFileSync(join(projectSkill, "SKILL.md"), "---\nname: Checklist\n---\nALPHA_SKILL_BODY");
  const provider = { id: "faux", kind: "faux", name: "Faux", modelId: "faux-default" } as const;
  const settings: Settings = {
    providers: [provider],
    activeProviderId: provider.id,
    workingDirectory: alpha,
    persona: "GLOBAL_GUIDANCE",
    skillsEnabled: ["review"],
  };
  const store = new SessionStore(join(root, "sessions"));
  const a = store.create(alpha);
  const b = store.create(beta);
  const unlinked = store.create();
  store.setPersonaOverride(a.id, "ALPHA_CHAT_GUIDANCE");
  const host = new AgentHost({
    getSettings: () => settings,
    saveSettings: vi.fn<(value: Settings) => void>(),
    broadcast: vi.fn<(event: UiAgentEvent) => void>(),
    store,
    skillsDir,
    mcp: new McpManager(() => settings, "0.0.0"),
  });
  const model = models.resolveModel(provider, undefined);
  const prompts: string[] = [];
  const resolveModel = vi.spyOn(models, "resolveModel").mockReturnValue({
    model: model.model,
    streamFn: (m, context, options) => {
      const generated = fixtureTitle(context);
      if (generated) return generated;
      prompts.push(getCurrentSystemPrompt(context.messages));
      return model.streamFn(m, context, options);
    },
  });

  try {
    host.loadSession(a.id);
    const running = host.prompt("Hello from Alpha");
    expect(host.getInstructionSources(a.id)).toEqual({
      project: { status: "loaded", path: fileA },
      personalization: "session",
      enabledSkills: ["Review", "Checklist"],
      running: true,
    });
    await running;
    expect(prompts[0]).toMatch(
      /ALPHA_PROJECT_GUIDANCE[\s\S]*ALPHA_CHAT_GUIDANCE[\s\S]*REVIEW_DESCRIPTION/,
    );
    expect(prompts[0]).toContain(".agents/skills/checklist");
    expect(prompts[0]).not.toMatch(
      /ALPHA_FALLBACK_GUIDANCE|BETA_PROJECT_GUIDANCE|GLOBAL_GUIDANCE|SKILL_GUIDANCE|ALPHA_SKILL_BODY/,
    );
    expect(JSON.stringify(store.load(a.id))).not.toContain("ALPHA_PROJECT_GUIDANCE");

    host.loadSession(b.id);
    expect(() => host.getInstructionSources(a.id)).toThrow("会话已切换");
    expect(host.getInstructionSources(b.id)).toMatchObject({
      project: { status: "loaded", path: fileB },
      personalization: "global",
      running: false,
    });
    await host.prompt("Hello from Beta");
    expect(prompts[1]).toMatch(
      /BETA_PROJECT_GUIDANCE[\s\S]*GLOBAL_GUIDANCE[\s\S]*REVIEW_DESCRIPTION/,
    );
    expect(prompts[1]).not.toMatch(/ALPHA_PROJECT_GUIDANCE|Checklist/);

    writeFileSync(fileB, "UPDATED_BETA_GUIDANCE");
    await host.prompt("Read updated instructions");
    expect(prompts[2]).toContain("UPDATED_BETA_GUIDANCE");
    expect(prompts[2]).not.toContain("BETA_PROJECT_GUIDANCE");

    host.loadSession(unlinked.id);
    expect(host.getInstructionSources(unlinked.id).project).toEqual({ status: "unlinked" });
    await host.prompt("Legacy chat");
    expect(prompts[3]).not.toContain("ALPHA_PROJECT_GUIDANCE");
    expect(prompts[3]).toContain("GLOBAL_GUIDANCE");
  } finally {
    resolveModel.mockRestore();
  }
});

it("loads only the selected instruction file and reports an unusable first choice", () => {
  using profile = mkdtempDisposableSync(join(tmpdir(), "pilot-instruction-files-"));
  const root = realpathSync(profile.path);
  const agents = join(root, "AGENTS.md");
  const claude = join(root, "CLAUDE.md");
  expect(loadProjectInstructions(root)).toEqual({ source: { path: agents, status: "missing" } });
  writeFileSync(claude, "Fallback guidance");
  expect(loadProjectInstructions(root)).toEqual({
    source: { path: claude, status: "loaded" },
    body: "Fallback guidance",
  });
  writeFileSync(agents, " \n");
  expect(loadProjectInstructions(root)).toEqual({ source: { path: agents, status: "empty" } });
  writeFileSync(agents, Buffer.from([0xff]));
  expect(loadProjectInstructions(root)).toEqual({
    source: { path: agents, status: "unavailable" },
  });
});

it("scopes project instructions to references and tool targets before a file write is approved", async () => {
  using profile = mkdtempDisposableSync(join(tmpdir(), "pilot-instruction-scopes-"));
  const root = realpathSync(profile.path);
  const project = join(root, "project");
  const outside = join(root, "outside");
  for (const path of ["features/editor", "notes", "ops", "unrelated"])
    mkdirSync(join(project, path), { recursive: true });
  mkdirSync(outside);
  symlinkSync(outside, join(project, "outside-link"), "junction");
  for (const [path, body] of Object.entries({
    "AGENTS.md": "ROOT_GUIDANCE",
    "features/CLAUDE.md": "FEATURE_GUIDANCE",
    "features/editor/AGENTS.md": "EDITOR_GUIDANCE",
    "features/editor/CLAUDE.md": "SHADOWED_GUIDANCE",
    "features/editor/note.txt": "Editor notes",
    "notes/AGENTS.md": "NOTES_GUIDANCE",
    "notes/input.txt": "Input from the notes folder",
    "ops/AGENTS.md": "OPS_GUIDANCE",
    "unrelated/AGENTS.md": "UNRELATED_GUIDANCE",
  }))
    writeFileSync(join(project, path), body);
  writeFileSync(join(outside, "AGENTS.md"), "OUTSIDE_GUIDANCE");

  const provider = { id: "faux", kind: "faux", name: "Faux", modelId: "faux-default" } as const;
  const settings: Settings = {
    providers: [provider],
    activeProviderId: provider.id,
    persona: "PERSONAL_GUIDANCE",
  };
  const faux = fauxProvider({ tokensPerSecond: 100_000 });
  const target = "ops/output.txt";
  faux.appendResponses([
    fauxAssistantMessage([
      fauxToolCall("read_file", { path: "notes/input.txt" }),
      fauxToolCall("read_file", { path: "outside-link/AGENTS.md" }),
      fauxToolCall("write_file", { path: target, content: "First attempt" }),
    ]),
    fauxAssistantMessage([fauxToolCall("write_file", { path: target, content: "Reviewed" })]),
    fauxAssistantMessage([fauxText("Done.")]),
    fauxAssistantMessage([fauxText("A separate task.")]),
  ]);
  const catalog = createModels();
  catalog.setProvider(faux.provider);
  const requests: { system: string; results: string[] }[] = [];
  using resolve = vi.spyOn(models, "resolveModel").mockReturnValue({
    model: faux.getModel()!,
    streamFn: (model, context, options) => {
      const generated = fixtureTitle(context);
      if (generated) return generated;
      requests.push({
        system: getCurrentSystemPrompt(context.messages),
        results: context.messages.flatMap((message) =>
          message.role === "toolResult"
            ? message.content.flatMap((part) => (part.type === "text" ? [part.text] : []))
            : [],
        ),
      });
      return catalog.streamSimple(model, context, options);
    },
  });
  const approvedOnRequest: number[] = [];
  const openHost = (): AgentHost => {
    const host = new AgentHost({
      getSettings: () => settings,
      saveSettings: () => {},
      broadcast: (event) => {
        if (event.type !== "permission_request") return;
        approvedOnRequest.push(requests.length);
        setTimeout(() => host.respondPermission(event.run, event.requestId, "once"), 0);
      },
      store: new SessionStore(join(root, "sessions")),
      skillsDir: join(root, "skills"),
      mcp: new McpManager(() => settings, "0.0.0"),
    });
    return host;
  };
  const host = openHost();
  const { composerId } = host.openProject(project);
  const draft: ComposerDraft = [
    "Implement the change described in ",
    {
      type: "file",
      id: "features/editor/note.txt",
      label: "note.txt",
      meta: { workingDirectory: project },
    },
  ];
  host.saveSessionDraft(composerId, draft);
  const editorScopes = [
    {
      directory: "features/editor",
      source: { path: join(project, "features/editor/AGENTS.md"), status: "loaded" },
    },
    {
      directory: "features",
      source: { path: join(project, "features/CLAUDE.md"), status: "loaded" },
    },
  ];
  expect(host.getInstructionSources(composerId).scopedProject).toEqual(editorScopes);
  expect(host.getSnapshot().sessionId).toBeNull();
  const running = host.prompt(promptFromDraft(draft), composerId, project);
  expect(host.getInstructionSources(composerId)).toMatchObject({
    scopedProject: editorScopes,
    running: true,
  });
  await running;

  expect(requests).toHaveLength(3);
  expect(requests[0].system).toMatch(
    /EDITOR_GUIDANCE[\s\S]*FEATURE_GUIDANCE[\s\S]*ROOT_GUIDANCE[\s\S]*PERSONAL_GUIDANCE/,
  );
  expect(requests[0].system).not.toMatch(/NOTES_GUIDANCE|OPS_GUIDANCE/);
  expect(requests[1].system).toContain("NOTES_GUIDANCE");
  expect(requests[1].system).toContain("OPS_GUIDANCE");
  expect(requests[1].results.join("\n")).toContain("Input from the notes folder");
  expect(requests[1].results.join("\n")).toContain("请按这些指令检查并重试文件操作");
  expect(JSON.stringify(requests)).not.toMatch(
    /OUTSIDE_GUIDANCE|SHADOWED_GUIDANCE|UNRELATED_GUIDANCE/,
  );
  expect(approvedOnRequest).toEqual([2]);
  expect(readFileSync(join(project, target), "utf8")).toBe("Reviewed");

  const reopened = openHost();
  reopened.loadSession(composerId);
  expect(
    reopened.getInstructionSources(composerId).scopedProject?.map(({ directory }) => directory),
  ).toEqual(["features/editor", "features", "notes", "ops"]);
  await reopened.prompt("A separate task with no target path");
  expect(requests[3].system).toContain("ROOT_GUIDANCE");
  expect(requests[3].system).not.toMatch(
    /EDITOR_GUIDANCE|FEATURE_GUIDANCE|NOTES_GUIDANCE|OPS_GUIDANCE/,
  );
  expect(resolve).toHaveBeenCalledTimes(2);
});

it("reads an explicitly selected disabled skill only during the selected task", async () => {
  using profile = mkdtempDisposableSync(join(tmpdir(), "pilot-slash-skill-"));
  const skillsDir = join(profile.path, "skills");
  const reviewDir = join(skillsDir, "review");
  const instruction = "Review each heading in order.";
  mkdirSync(reviewDir, { recursive: true });
  writeFileSync(join(reviewDir, "SKILL.md"), `---\nname: Review\n---\n${instruction}`);

  const provider = { id: "faux", kind: "faux", name: "Faux", modelId: "faux-default" } as const;
  const settings: Settings = {
    providers: [provider],
    activeProviderId: provider.id,
    skillsEnabled: [],
  };
  const store = new SessionStore(join(profile.path, "sessions"));
  const saveSettings = vi.fn<(value: Settings) => void>();
  const host = new AgentHost({
    getSettings: () => settings,
    saveSettings,
    broadcast: vi.fn<(event: UiAgentEvent) => void>(),
    store,
    skillsDir,
    mcp: new McpManager(() => settings, "0.0.0"),
  });
  const faux = fauxProvider({ tokensPerSecond: 100_000 });
  const catalog = createModels();
  catalog.setProvider(faux.provider);
  const read = fauxAssistantMessage([fauxToolCall("read_skill", { skillId: "review" })], {
    stopReason: "toolUse",
  });
  faux.appendResponses([
    read,
    fauxAssistantMessage([fauxText("I read the skill.")]),
    read,
    fauxAssistantMessage([fauxText("The skill was unavailable.")]),
    fauxAssistantMessage([fauxText("The skill is enabled.")]),
  ]);
  const requests: { system: string; last: string }[] = [];
  const resolveModel = vi.spyOn(models, "resolveModel").mockReturnValue({
    model: faux.getModel()!,
    streamFn: (model, context, options) => {
      const generated = fixtureTitle(context);
      if (generated) return generated;
      requests.push({
        system: getCurrentSystemPrompt(context.messages),
        last: JSON.stringify(context.messages.at(-1)),
      });
      return catalog.streamSimple(model, context, options);
    },
  });
  const prompt = {
    text: "Check this with @[skill:review]",
    mentions: [{ type: "skill", id: "review", label: "Review", meta: { description: "" } }],
  } as const;
  const invokeSkill = async (): Promise<void> => {
    await host.prompt({ ...prompt, mentions: [...prompt.mentions] });
  };

  try {
    await invokeSkill();
    await host.prompt("An ordinary message");
    expect(requests).toHaveLength(4);
    expect(requests[0].last).toContain("Skills selected for this request");
    expect(requests[0].last).not.toContain(instruction);
    expect(requests[1].last).toContain(instruction);
    expect(requests[2].system).not.toContain("Available skills");
    expect(requests[3].last).toContain("所选技能已不可用");
    const saved = store.load(host.getSnapshot().sessionId!);
    expect(saved.find((entry) => entry.role === "toolResult")).toMatchObject({
      toolName: "read_skill",
    });
    expect(host.getSnapshot().settings.skillsEnabled).toEqual([]);
    expect(saveSettings).not.toHaveBeenCalled();

    settings.skillsEnabled = ["review"];
    await invokeSkill();
    expect(requests[4].system).toContain("Available skills");
    expect(requests[4].system).not.toContain(instruction);
    expect(requests[4].last).not.toContain("Skills selected for this request");
  } finally {
    resolveModel.mockRestore();
  }
});

it("sends mention context to the provider and restores the same user parts from disk", async () => {
  using fixture = mkdtempDisposableSync(join(tmpdir(), "pilot-referenced-message-"));
  const root = realpathSync(fixture.path);
  writeFileSync(join(root, "example file.txt"), "sample");
  const provider = { id: "faux", kind: "faux", name: "Faux", modelId: "faux-default" } as const;
  const settings: Settings = {
    providers: [provider],
    activeProviderId: provider.id,
    workingDirectory: root,
  };
  const store = new SessionStore(join(root, "sessions"));
  const broadcast = vi.fn<(event: UiAgentEvent) => void>();
  const host = new AgentHost({
    getSettings: () => settings,
    saveSettings: vi.fn<(value: Settings) => void>(),
    broadcast,
    store,
    skillsDir: join(root, "skills"),
    mcp: new McpManager(() => settings, "0.0.0"),
  });
  const original = models.resolveModel(provider, undefined);
  const requests: string[] = [];
  const resolveModel = vi.spyOn(models, "resolveModel").mockReturnValue({
    model: original.model,
    streamFn: (model, context, options) => {
      const generated = fixtureTitle(context);
      if (generated) return generated;
      requests.push(JSON.stringify(context.messages));
      return original.streamFn(model, context, options);
    },
  });
  const text = "Review @[file:example file.txt].";
  try {
    await host.prompt({
      text,
      mentions: [
        {
          type: "file",
          id: "example file.txt",
          label: "example file.txt",
          offset: "Review ".length,
          meta: { workingDirectory: root },
        },
      ],
    });
    const snapshot = host.getSnapshot();
    const id = snapshot.sessionId!;
    const parts = [
      { type: "text", text: "Review " },
      {
        type: "mention",
        kind: "file",
        id: "example file.txt",
        label: "example file.txt",
        workingDirectory: root,
      },
      { type: "text", text: "." },
    ];
    expect(
      broadcast.mock.calls.find(([event]) => event.type === "user_message")?.[0],
    ).toMatchObject({
      message: { role: "user", parts },
    });
    expect(requests[0]).toContain(MENTION_CONTEXT_HEADING);
    expect(requests[0]).not.toContain("pilotReference");
    expect(store.load(id).find(({ role }) => role === "user")).toMatchObject({ content: text });
    expect((await host.loadSession(id)).messages[0].parts).toEqual(parts);
    expect(host.copySession(id)).toContain("Review @example file.txt.");
    expect(host.copySession(id)).not.toContain(MENTION_CONTEXT_HEADING);
  } finally {
    resolveModel.mockRestore();
  }
});

it("streams and restores a timed trace and reverts a recorded workspace edit", async () => {
  using fixture = mkdtempDisposableSync(join(tmpdir(), "pilot-reply-trace-"));
  const root = realpathSync(fixture.path);
  const file = join(root, "pilot-demo.txt");
  const original = "Original workspace content\r\n";
  writeFileSync(file, original);
  const provider = { id: "faux", kind: "faux", name: "Faux", modelId: "faux-default" } as const;
  const settings: Settings = {
    providers: [provider],
    activeProviderId: provider.id,
    approvalMode: "full-access",
    workingDirectory: root,
  };
  const events: UiAgentEvent[] = [];
  const host = new AgentHost({
    getSettings: () => settings,
    saveSettings: vi.fn<(value: Settings) => void>(),
    broadcast: (event) => {
      events.push(event);
    },
    store: new SessionStore(join(root, "sessions")),
    skillsDir: join(root, "skills"),
    mcp: new McpManager(() => settings, "0.0.0"),
  });

  await host.prompt("演示");
  const types = events.map(({ type }) => type);
  expect(types.indexOf("thinking_end")).toBeGreaterThan(types.indexOf("thinking_delta"));
  expect(types.indexOf("tool_start")).toBeGreaterThan(types.indexOf("tool_call"));
  expect(types.indexOf("file_change")).toBeGreaterThan(types.indexOf("tool_end"));
  const snapshot = host.getSnapshot();
  const sessionId = snapshot.sessionId;
  const changeEvent = events.find((event) => event.type === "file_change");
  if (!sessionId || !changeEvent) throw new Error("Missing file change");
  const starts = events.filter((event) => event.type === "assistant_start");
  const ends = events.filter((event) => event.type === "assistant_end");
  expect(ends.length).toBeGreaterThan(1);
  expect(starts).toHaveLength(ends.length);
  for (const [index, end] of ends.entries()) {
    expect(end.id).toBe(starts[index].id);
    expect(end.timing).toMatchObject(starts[index].timing);
    expect(end.timing.runId).toBe(end.run.runId);
    expect(end.timing.endedAt).toBeGreaterThanOrEqual(end.timing.startedAt);
  }
  const saved = new SessionStore(join(root, "sessions")).load(sessionId);
  const savedTiming = toUiMessages(saved, "s")
    .filter((message) => message.role === "assistant")
    .map((message) => message.timing);
  expect(savedTiming).toEqual(ends.map((end) => end.timing));
  const { change } = changeEvent;
  expect(change.path).toBe("pilot-demo.txt");
  expect(host.getFileDiff(sessionId, change.id).hunks[0]).toEqual(
    expect.arrayContaining([{ kind: "removed", before: 1, text: original.trim() }]),
  );
  expect(JSON.stringify(snapshot.messages)).not.toContain(original.trim());
  const restored = await host.loadSession(sessionId);
  const parts = restored.messages.flatMap((message) => message.parts);
  expect(parts.find((part) => part.type === "thinking")).toMatchObject({
    durationMs: expect.any(Number),
  });
  expect(parts.find((part) => part.type === "tool")).toMatchObject({
    state: "success",
    fileChange: change,
  });
  settings.workingDirectory = join(root, "sessions");
  host.undoFileChange(sessionId, change.id);
  expect(readFileSync(file, "utf8")).toBe(original);
  expect(
    (await host.loadSession(sessionId)).messages
      .flatMap((message) => message.parts)
      .find((part) => part.type === "tool"),
  ).toMatchObject({ fileChange: { reverted: true } });
});

it("reviews built-in tools and shell changes against the run's original Git index and worktree", async () => {
  using fixture = mkdtempDisposableSync(join(tmpdir(), "pilot-agent-git-"));
  const root = realpathSync(fixture.path);
  const project = join(root, "project");
  mkdirSync(project);
  const git = (...args: string[]): string =>
    execFileSync("git", ["--no-optional-locks", ...args], {
      cwd: project,
      encoding: "utf8",
      windowsHide: true,
    }).trimEnd();
  const write = (path: string, text: string): void => writeFileSync(join(project, path), text);
  const read = (path: string): string => readFileSync(join(project, path), "utf8");
  git("init", "-q");
  git("config", "core.autocrlf", "false");
  write("dual.txt", "base\n");
  write("delete.txt", "delete this file\n");
  write("move.txt", "move this file\n");
  write("untouched.txt", "base text\n");
  write("shell.txt", "base text\n");
  git("add", ".");
  git(
    "-c",
    "user.name=Pilot",
    "-c",
    "user.email=pilot@example.invalid",
    "-c",
    "commit.gpgsign=false",
    "commit",
    "-qm",
    "Git test fixture",
  );
  write("dual.txt", "user staged\n");
  git("add", "dual.txt");
  const indexPath = join(project, ".git", "index");
  const originalIndex = readFileSync(indexPath);
  write("dual.txt", "user staged\nuser unstaged\n");
  write("untouched.txt", "user unstaged only\n");
  write("user note.txt", "user untracked\n");

  const command =
    process.platform === "win32"
      ? "$ErrorActionPreference = 'Stop'\nMove-Item -LiteralPath move.txt -Destination 'moved file.txt'\nRemove-Item -LiteralPath delete.txt\nSet-Content -LiteralPath shell.txt -Value 'command edit'"
      : "mv move.txt 'moved file.txt' && rm delete.txt && printf 'command edit\\n' > shell.txt";
  const faux = fauxProvider({ tokensPerSecond: 100_000 });
  faux.appendResponses([
    fauxAssistantMessage(
      [
        fauxToolCall("edit_file", {
          path: "dual.txt",
          oldText: "user unstaged\n",
          newText: "user unstaged\ntask edit\n",
        }),
        fauxToolCall("write_file", { path: "tool.txt", content: "task addition\n" }),
        fauxToolCall("bash", { command }),
      ],
      { stopReason: "toolUse" },
    ),
    fauxAssistantMessage([fauxText("Reviewed the project.")]),
  ]);
  const catalog = createModels();
  catalog.setProvider(faux.provider);
  const provider = { id: "faux", kind: "faux", name: "Faux", modelId: "faux-default" } as const;
  const settings: Settings = {
    providers: [provider],
    activeProviderId: provider.id,
    approvalMode: "full-access",
  };
  const sessions = join(root, "sessions");
  const events: UiAgentEvent[] = [];
  const firstTool = Promise.withResolvers<void>();
  const modelFinishing = Promise.withResolvers<void>();
  // Keep the run open after its tools so the live and persisted views can be checked separately.
  const resolveModel = vi.spyOn(models, "resolveModel").mockReturnValue({
    model: faux.getModel()!,
    streamFn: async (model, context, options) => {
      const generated = fixtureTitle(context);
      if (generated) return generated;
      if (context.messages.at(-1)?.role === "toolResult") await modelFinishing.promise;
      return catalog.streamSimple(model, context, options);
    },
  });
  const createHost = (): AgentHost =>
    new AgentHost({
      getSettings: () => settings,
      saveSettings: vi.fn<(value: Settings) => void>(),
      broadcast: (event) => {
        events.push(event);
        if (event.type === "tool_end") firstTool.resolve();
      },
      store: new SessionStore(sessions),
      skillsDir: join(root, "skills"),
      mcp: new McpManager(() => settings, "0.0.0"),
    });
  const host = createHost();
  const { composerId } = host.openProject(project);

  try {
    const baseline = await host.getGitChanges(composerId);
    expect(baseline).toMatchObject({
      phase: "workspace",
      changes: [
        { path: "dual.txt", area: "staged", kind: "modified", origin: "existing" },
        { path: "dual.txt", area: "unstaged", kind: "modified", origin: "existing" },
        { path: "untouched.txt", area: "unstaged", kind: "modified", origin: "existing" },
        { path: "user note.txt", area: "untracked", kind: "added", origin: "existing" },
      ],
    });
    const running = host.prompt("Edit this project", composerId);
    try {
      await Promise.race([firstTool.promise, running]);
      expect(new SessionStore(sessions).checkpoint(composerId)?.gitBaseline).toMatchObject({
        root: realpathSync.native(project),
        entries: expect.arrayContaining([
          expect.objectContaining({
            path: "user note.txt",
            area: "untracked",
            fingerprint: expect.any(String),
          }),
          expect.objectContaining({
            path: "dual.txt",
            area: "staged",
            fingerprint: expect.any(String),
          }),
        ]),
      });
      expect(await host.getGitChanges(composerId)).toMatchObject({ phase: "running" });
    } finally {
      modelFinishing.resolve();
      await running;
    }
    const finished = await host.getGitChanges(composerId);
    expect(finished).toMatchObject({
      phase: "finished",
      changes: [
        { path: "delete.txt", area: "unstaged", kind: "deleted", origin: "task" },
        { path: "dual.txt", area: "staged", kind: "modified", origin: "existing" },
        { path: "dual.txt", area: "unstaged", kind: "modified", origin: "mixed" },
        {
          path: "moved file.txt",
          previousPath: "move.txt",
          area: "unstaged",
          kind: "renamed",
          origin: "task",
        },
        { path: "shell.txt", area: "unstaged", kind: "modified", origin: "task" },
        { path: "tool.txt", area: "untracked", kind: "added", origin: "task" },
        { path: "untouched.txt", area: "unstaged", kind: "modified", origin: "existing" },
        { path: "user note.txt", area: "untracked", kind: "added", origin: "existing" },
      ],
    });
    expect(events.filter((event) => event.type === "tool_end").map(({ state }) => state)).toEqual([
      "success",
      "success",
      "success",
    ]);
    expect(readFileSync(indexPath)).toEqual(originalIndex);
    expect(git("show", ":dual.txt")).toBe("user staged");
    expect(read("dual.txt")).toBe("user staged\nuser unstaged\ntask edit\n");
    expect(read("untouched.txt")).toBe("user unstaged only\n");
    expect(read("user note.txt")).toBe("user untracked\n");
    expect(read("moved file.txt")).toBe("move this file\n");
    expect(existsSync(join(project, "delete.txt"))).toBe(false);

    write("after task.txt", "subsequent user edit\n");
    const restarted = createHost();
    restarted.loadSession(composerId);
    expect(await restarted.getGitChanges(composerId)).toEqual(finished);
    const another = restarted.newSession();
    await expect(restarted.getGitChanges(composerId)).rejects.toThrow("会话已切换");
    expect(await restarted.getGitChanges(another.composerId)).toMatchObject({ phase: "workspace" });
  } finally {
    resolveModel.mockRestore();
  }
}, 20_000);
