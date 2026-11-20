// @env node
import { mkdirSync, mkdtempDisposableSync } from "node:fs";
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
import type { Settings, UiAgentEvent } from "../src/shared/contract";

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
