// @env node
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  mkdtempDisposableSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

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
import * as models from "../src/main/agent-host/models";
import { actionFingerprint } from "../src/main/agent-host/recovery";
import { SessionStore } from "../src/main/agent-host/session-store";
import type { Settings } from "../src/main/settings/types";
import * as gitChanges from "../src/main/workspace/git-changes";
import { previewWorkspaceReference } from "../src/main/workspace/reference";
import { searchWorkspace } from "../src/main/workspace/search";
import type { GitSnapshot } from "../src/main/workspace/types";
import { MENTION_CONTEXT_HEADING } from "../src/shared/constants";
import type { ComposerDraft, UiAgentEvent } from "../src/shared/contract";

vi.mock("electron", () => ({ safeStorage: {} }));

it("restores separate session settings and structured drafts in the same project", async () => {
  using profile = mkdtempDisposableSync(join(tmpdir(), "pilot-session-settings-"));
  const root = realpathSync(profile.path);
  const sessions = join(root, "sessions");
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
  const a = (await host.openProject(root)).composerId;
  host.saveSessionDraft(a, draftA);
  host.updateSessionSettings(a, { model: modelA, approvalMode: "read-only" });

  const b = (await host.newSession()).composerId;
  expect(b).not.toBe(a);
  expect(() => host.saveSessionDraft(a, ["stale"])).toThrow("会话已切换");
  host.updateSessionSettings(b, { model: modelB, approvalMode: "full-access" });
  host.saveSessionDraft(b, draftB);

  for (const current of [host, createHost()]) {
    const alpha = await current.loadSession(a);
    expect(alpha.composerDraft).toEqual(draftA);
    expect(alpha.sessions.find(({ id }) => id === a)).toMatchObject({
      workingDirectory: root,
      model: modelA,
      approvalMode: "read-only",
    });
    const beta = await current.loadSession(b);
    expect(beta.composerDraft).toEqual(draftB);
    expect(beta.sessions.find(({ id }) => id === b)).toMatchObject({
      workingDirectory: root,
      model: modelB,
      approvalMode: "full-access",
    });
    expect(beta.settings).toMatchObject({ activeProviderId: "default", approvalMode: "standard" });
  }

  const restarted = createHost();
  const resolve = vi.spyOn(models, "resolveModel");
  try {
    await restarted.loadSession(a);
    await restarted.prompt("A 演示", a);
    const file = join(root, "pilot-demo.txt");
    expect(existsSync(file)).toBe(false);
    expect(restarted.getSnapshot().composerDraft).toEqual([]);

    await restarted.loadSession(b);
    expect(restarted.getSnapshot().composerDraft).toEqual(draftB);
    await restarted.prompt("B 演示", b);
    expect(existsSync(file)).toBe(true);
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
  vi.spyOn(mcp, "tools").mockReturnValueOnce(preparation.promise);
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

it("keeps the original run, approval, and transcript while another project is selected", async () => {
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
  const tools = vi.spyOn(mcp, "tools");
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
  host.renameSession(a, "A");
  const b = host.openProject(next).composerId;
  host.updateSessionSettings(b, { approvalMode: "full-access" });
  host.saveSessionDraft(b, ["B draft"]);
  host.loadSession(a);

  const running = host.prompt("Original 演示", a);
  const ref = host.getSnapshot().activeRun!;
  const invalid = { sessionId: a, runId: b };
  try {
    await vi.waitFor(() => expect(tools).toHaveBeenCalledWith(original, expect.any(AbortSignal)));
    expect(host.loadSession(b)).toMatchObject({
      status: "idle",
      sessionId: b,
      composerDraft: ["B draft"],
      messages: [],
      pendingPermissions: [],
      activeRun: ref,
    });
    expect(host.getWorkingDirectory()).toBe(next);
    settings.approvalMode = "read-only";
    const request = await requested.promise;
    expect(host.prompt("Blocked send", b)).toMatchObject({
      sessionId: a,
      status: "waiting_approval",
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

    host.loadSession(b);
    await running;
    expect(host.getSnapshot()).toMatchObject({
      sessionId: b,
      activeRun: null,
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

it("holds the run lock while stopping and ignores stop and queue actions from an earlier run", async () => {
  using profile = mkdtempDisposableSync(join(tmpdir(), "pilot-run-stop-"));
  const provider = { id: "faux", kind: "faux", name: "Faux", modelId: "faux-default" } as const;
  const settings: Settings = { providers: [provider], activeProviderId: provider.id };
  const mcp = new McpManager(() => settings, "0.0.0");
  const firstPreparation = Promise.withResolvers<AgentTool[]>();
  const secondPreparation = Promise.withResolvers<AgentTool[]>();
  vi.spyOn(mcp, "tools")
    .mockReturnValueOnce(firstPreparation.promise)
    .mockReturnValueOnce(secondPreparation.promise);
  const host = new AgentHost({
    getSettings: () => settings,
    saveSettings: vi.fn<(value: Settings) => void>(),
    broadcast: vi.fn<(event: UiAgentEvent) => void>(),
    store: new SessionStore(join(profile.path, "sessions")),
    skillsDir: join(profile.path, "skills"),
    mcp,
  });

  const a = host.newSession().composerId;
  host.saveSessionDraft(a, ["First"]);
  const b = host.newSession().composerId;
  host.saveSessionDraft(b, ["Second chat"]);
  host.loadSession(a);
  const first = host.prompt("First", a);
  const previous = host.getSnapshot().activeRun!;
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
    expect(host.prompt("Second chat", b)).toMatchObject({ sessionId: a, status: "stopping" });
    expect(host.getSnapshot().composerDraft).toEqual(["Second chat"]);
  } finally {
    firstPreparation.resolve([]);
    await first;
  }

  host.loadSession(a);
  expect(host.getSnapshot().interruptedRun).toBeNull();
  const second = host.prompt("A new run", a);
  const active = host.getSnapshot().activeRun!;
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
  const ref = host.getSnapshot().activeRun!;
  try {
    await vi.waitFor(() => expect(host.getSnapshot().pendingPermissions).toHaveLength(1));
    host.saveSessionDraft(id, ["下次继续时的草稿"]);
    await host.stopForExit();
    expect(host.getSnapshot()).toMatchObject({
      activeRun: null,
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
      activeRun: null,
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
    streamFn: catalog.streamSimple.bind(catalog),
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
  expect(host.getSnapshot().activeRun).toBeNull();
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
  vi.spyOn(mcp, "tools").mockResolvedValueOnce([externalTool]).mockResolvedValueOnce([]);
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
  const fileB = join(beta, "AGENTS.md");
  writeFileSync(fileA, "ALPHA_PROJECT_GUIDANCE");
  writeFileSync(fileB, "BETA_PROJECT_GUIDANCE");
  writeFileSync(join(skillsDir, "review", "SKILL.md"), "---\nname: Review\n---\nSKILL_GUIDANCE");
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
      enabledSkills: ["Review"],
      running: true,
    });
    await running;
    expect(prompts[0]).toMatch(
      /ALPHA_PROJECT_GUIDANCE[\s\S]*ALPHA_CHAT_GUIDANCE[\s\S]*SKILL_GUIDANCE/,
    );
    expect(prompts[0]).not.toMatch(/BETA_PROJECT_GUIDANCE|GLOBAL_GUIDANCE/);
    expect(JSON.stringify(store.load(a.id))).not.toContain("ALPHA_PROJECT_GUIDANCE");

    host.loadSession(b.id);
    expect(() => host.getInstructionSources(a.id)).toThrow("会话已切换");
    expect(host.getInstructionSources(b.id)).toMatchObject({
      project: { status: "loaded", path: fileB },
      personalization: "global",
      running: false,
    });
    await host.prompt("Hello from Beta");
    expect(prompts[1]).toMatch(/BETA_PROJECT_GUIDANCE[\s\S]*GLOBAL_GUIDANCE[\s\S]*SKILL_GUIDANCE/);
    expect(prompts[1]).not.toContain("ALPHA_PROJECT_GUIDANCE");

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

it("applies an installed skill explicitly for one run and keeps its instructions out of history", async () => {
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
  const original = models.resolveModel(provider, undefined);
  const requests: string[] = [];
  const resolveModel = vi.spyOn(models, "resolveModel").mockReturnValue({
    model: original.model,
    streamFn: (model, context, options) => {
      requests.push(JSON.stringify(context.messages));
      return original.streamFn(model, context, options);
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
    expect(requests).toHaveLength(2);
    expect(requests[0]).toContain(instruction);
    expect(requests[1]).not.toContain(instruction);
    expect(JSON.stringify(store.load(host.getSnapshot().sessionId ?? ""))).not.toContain(
      instruction,
    );
    expect(host.getSnapshot().settings.skillsEnabled).toEqual([]);
    expect(saveSettings).not.toHaveBeenCalled();

    settings.skillsEnabled = ["review"];
    await invokeSkill();
    expect(requests[2].split(instruction)).toHaveLength(2);
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
});
