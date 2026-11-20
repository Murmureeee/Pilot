import { describe, expect, it } from "vitest";
import type { IpcChannel } from "../src/main/ipc/types";
import { parseIpcArgs } from "../src/main/ipc/validation";
import { IPC, type ProviderInput, type SettingsInput } from "../src/shared/contract";

const sessionId = "48687a06-2cb0-43a1-a627-9752f1621f1b";
const draft: ProviderInput = {
  id: "local",
  kind: "openai-compatible",
  name: "Local provider",
  baseUrl: "http://127.0.0.1:11434/v1",
  modelId: "",
};
const settings: SettingsInput = {
  providers: [{ ...draft, modelId: "example" }],
  activeProviderId: "local",
  workingDirectory: null,
  commandShell: "bash",
  toolRules: [{ toolName: "write_file", pathPrefix: "example" }],
  persona: "",
  skillsEnabled: ["example-skill"],
};

const valid: Record<IpcChannel, unknown[]> = {
  [IPC.ping]: [{ payload: "hello" }],
  [IPC.runAgentSmoke]: [],
  [IPC.appInfo]: [],
  [IPC.menuAction]: ["undo"],
  [IPC.appOpenPath]: ["logs"],
  [IPC.appSetTitlebarTheme]: ["system"],
  [IPC.appGetUpdateStatus]: [],
  [IPC.appCheckForUpdates]: [],
  [IPC.appInstallUpdate]: [],
  [IPC.agentPrompt]: ["  preserve prompt whitespace  "],
  [IPC.agentSearchWorkspace]: ["src/报告"],
  [IPC.agentAbort]: [],
  [IPC.agentClearQueue]: [],
  [IPC.agentGetSnapshot]: [],
  [IPC.sessionNew]: [],
  [IPC.sessionLoad]: [sessionId],
  [IPC.sessionRename]: [sessionId, "标题"],
  [IPC.sessionDelete]: [sessionId],
  [IPC.sessionPin]: [sessionId, true],
  [IPC.sessionArchive]: [sessionId, false],
  [IPC.sessionUnread]: [sessionId, true],
  [IPC.sessionFork]: [sessionId],
  [IPC.sessionCopy]: [sessionId],
  [IPC.sessionPersona]: [sessionId, null],
  [IPC.settingsModelCatalog]: [draft],
  [IPC.settingsTestProvider]: ["local"],
  [IPC.settingsPickWorkingDirectory]: ["zh"],
  [IPC.settingsPickImportDirectory]: ["en"],
  [IPC.settingsPreviewExternalImport]: ["mcp", null],
  [IPC.settingsImportExternal]: ["mcp", null, ["f192288a6029c4eafd0bd219"]],
  [IPC.settingsImportedPlugins]: [],
  [IPC.settingsToggleImportedPlugin]: ["f192288a6029c4eafd0bd219", true],
  [IPC.skillsList]: [],
  [IPC.skillsImport]: ["en"],
  [IPC.skillsToggle]: ["example-skill", true],
  [IPC.settingsGet]: [],
  [IPC.settingsSave]: [settings],
  [IPC.settingsSetLogLevel]: ["debug"],
  [IPC.settingsSelectModel]: ["local", "example"],
  [IPC.settingsSetThinkingLevel]: ["high"],
  [IPC.settingsMcpList]: [],
  [IPC.settingsMcpSave]: [
    {
      id: sessionId,
      name: "Example MCP",
      enabled: false,
      policy: "confirm",
      transport: { type: "http", url: "http://127.0.0.1:9876/mcp" },
    },
  ],
  [IPC.settingsMcpReconnect]: [sessionId],
  [IPC.settingsMcpRemove]: [sessionId],
  [IPC.toolPermissionRespond]: [sessionId, "once"],
};

describe("IPC argument validation", () => {
  it("preserves valid inputs and enforces argument counts on every invoke channel", () => {
    for (const channel of Object.values(IPC)) {
      const args = valid[channel];
      expect(parseIpcArgs(channel, args)).toEqual(args);
      expect(() => parseIpcArgs(channel, [...args, null])).toThrow(/Invalid IPC arguments/);
    }
    for (const channel of Object.values(IPC).filter((name) => valid[name].length > 0)) {
      expect(() => parseIpcArgs(channel, valid[channel].slice(0, -1))).toThrow(
        /Invalid IPC arguments/,
      );
    }
  });

  it("accepts Responses providers for catalog, connection tests, and settings", () => {
    const responses = { ...draft, kind: "openai-responses", modelId: "test-model" };
    expect(parseIpcArgs(IPC.settingsModelCatalog, [responses])).toEqual([responses]);
    expect(parseIpcArgs(IPC.settingsTestProvider, [responses])).toEqual([responses]);
    const input = { ...settings, providers: [responses] };
    expect(parseIpcArgs(IPC.settingsSave, [input])).toEqual([input]);
  });

  it("accepts the directory the composer used for a referenced prompt", () => {
    const args = ["review the selected file", "E:/projects/Pilot"];
    expect(parseIpcArgs(IPC.agentPrompt, args)).toEqual(args);
  });

  it.each([
    [IPC.toolPermissionRespond, [sessionId, "later"]],
    [IPC.sessionLoad, ["not-a-session-id"]],
    [IPC.sessionPin, [sessionId, "true"]],
    [IPC.appOpenPath, ["other-directory"]],
    [IPC.appSetTitlebarTheme, ["other-theme"]],
    [IPC.agentPrompt, [" \t\n"]],
    [IPC.agentSearchWorkspace, ["x".repeat(513)]],
    [IPC.skillsImport, ["other-language"]],
    [IPC.settingsPreviewExternalImport, ["unsupported", null]],
    [IPC.settingsImportExternal, ["codex", null]],
    [IPC.settingsImportExternal, ["mcp", {}, ["f192288a6029c4eafd0bd219"]]],
    [IPC.settingsImportExternal, ["skill", null, []]],
    [IPC.settingsImportExternal, ["mcp", null, ["../invalid"]]],
    [IPC.settingsToggleImportedPlugin, ["../../other-plugin", false]],
    [IPC.settingsSave, [{ ...settings, approvalMode: "other-mode" }]],
    [IPC.settingsSetLogLevel, ["verbose"]],
    [IPC.settingsSelectModel, ["local", ""]],
    [IPC.settingsSetThinkingLevel, ["ultra"]],
    [IPC.settingsSave, [{ ...settings, thinkingLevels: [] }]],
    [IPC.settingsSave, [{ ...settings, toolRules: [{ toolName: "write_file", pathPrefix: 7 }] }]],
    [IPC.settingsSave, [{ ...settings, providers: [null] }]],
    [IPC.settingsSave, [{ ...settings, providers: [{ ...draft, hasKey: true }] }]],
  ] satisfies [IpcChannel, unknown[]][])("rejects invalid arguments to %s", (channel, args) => {
    expect(() => parseIpcArgs(channel, args)).toThrow(/Invalid IPC arguments/);
  });

  it("reports the invalid settings field without echoing an API key", () => {
    expect(() =>
      parseIpcArgs(IPC.settingsSave, [
        {
          ...settings,
          providers: [{ ...draft, apiKey: "test-secret-value", modelId: false }],
        },
      ]),
    ).toThrow(/^Invalid IPC arguments for settings:save at 0\.providers\.0\.modelId$/);
  });
});
