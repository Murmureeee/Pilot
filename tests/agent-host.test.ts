// @env node
import {
  mkdirSync,
  mkdtempDisposableSync,
  readFileSync,
  realpathSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { getCurrentSystemPrompt, getCurrentTools } from "@earendil-works/pi-ai";
import { obj } from "@earendil-works/pi-schema";
import { expect, it, vi } from "vitest";
import { AgentHost } from "../src/main/agent-host/host";
import { McpManager } from "../src/main/agent-host/mcp";
import * as models from "../src/main/agent-host/models";
import { SessionStore } from "../src/main/agent-host/session-store";
import type { Settings } from "../src/main/settings/types";
import { MENTION_CONTEXT_HEADING } from "../src/shared/constants";
import type { UiAgentEvent } from "../src/shared/contract";

vi.mock("electron", () => ({ safeStorage: {} }));

it("keeps queued file references in the working directory of the active run", async () => {
  using profile = mkdtempDisposableSync(join(tmpdir(), "pi-agent-references-"));
  const original = join(profile.path, "original");
  const next = join(profile.path, "next");
  mkdirSync(original);
  mkdirSync(next);
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
    expect(host.acceptsReferenceDirectory(original)).toBe(true);
    settings.workingDirectory = next;
    expect(host.acceptsReferenceDirectory(original)).toBe(false);
    expect(host.acceptsReferenceDirectory(next)).toBe(false);
  } finally {
    preparation.resolve([]);
    await running;
  }
  expect(host.acceptsReferenceDirectory(next)).toBe(true);
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
  const invokeSkill = (): Promise<void> =>
    host.prompt(host.preparePrompt({ ...prompt, mentions: [...prompt.mentions] }));

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
    await host.prompt(
      host.preparePrompt({
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
      }),
    );
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
  const file = join(root, "pi-desktop-demo.txt");
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
  expect(change.path).toBe("pi-desktop-demo.txt");
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
  host.undoFileChange(sessionId, change.id);
  expect(readFileSync(file, "utf8")).toBe(original);
  expect(
    (await host.loadSession(sessionId)).messages
      .flatMap((message) => message.parts)
      .find((part) => part.type === "tool"),
  ).toMatchObject({ fileChange: { reverted: true } });
});
