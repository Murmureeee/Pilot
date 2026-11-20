import { describe, expect, it } from "vitest";
import type { IpcChannel } from "../src/main/ipc/types";
import { parseIpcArgs } from "../src/main/ipc/validation";
import { IPC, type ProviderInput, type SettingsInput } from "../src/shared/contract";

const sessionId = "48687a06-2cb0-43a1-a627-9752f1621f1b";
const run = { sessionId, runId: "7a6c4360-bb48-4cbd-ae92-b515fdd9ce8b" };
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
  [IPC.agentPreviewWorkspaceReference]: [
    { path: "src/报告.md", workingDirectory: "E:/projects/Pilot" },
  ],
  [IPC.agentAbort]: [run],
  [IPC.agentResume]: [run],
  [IPC.agentClearQueue]: [run],
  [IPC.agentGetSnapshot]: [],
  [IPC.sessionNew]: [],
  [IPC.sessionSaveDraft]: [
    sessionId,
    [
      "Review ",
      { type: "file", id: "note.md", label: "note.md", meta: { workingDirectory: "E:/project" } },
    ],
  ],
  [IPC.sessionUpdateSettings]: [
    sessionId,
    { model: { providerId: "local", modelId: "example" }, approvalMode: null },
  ],
  [IPC.sessionSelectProject]: ["zh"],
  [IPC.sessionUseRecentProject]: ["E:/projects/Pilot"],
  [IPC.sessionGitHead]: ["E:/projects/Pilot"],
  [IPC.sessionLoad]: [sessionId],
  [IPC.sessionRename]: [sessionId, "标题"],
  [IPC.sessionDelete]: [sessionId],
  [IPC.sessionPin]: [sessionId, true],
  [IPC.sessionArchive]: [sessionId, false],
  [IPC.sessionUnread]: [sessionId, true],
  [IPC.sessionFork]: [sessionId],
  [IPC.sessionCopy]: [sessionId],
  [IPC.sessionPersona]: [sessionId, null],
  [IPC.sessionFileDiff]: [sessionId, sessionId],
  [IPC.sessionUndoFileChange]: [sessionId, sessionId],
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
  [IPC.toolPermissionRespond]: [run, sessionId, "once"],
};

describe("IPC argument validation", () => {
  it("preserves valid inputs and enforces argument counts on every invoke channel", () => {
    for (const channel of Object.values(IPC)) {
      const args = valid[channel];
      expect(parseIpcArgs(channel, args)).toEqual(args);
      expect(() => parseIpcArgs(channel, [...args, null, null])).toThrow(/Invalid IPC arguments/);
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

  it("accepts the directory the composer used for a prompt or file search", () => {
    const args = ["review the selected file", "E:/projects/Pilot"];
    expect(parseIpcArgs(IPC.agentPrompt, args)).toEqual(args);
    expect(parseIpcArgs(IPC.agentPrompt, [args[0], null])).toEqual([args[0], null]);
    expect(parseIpcArgs(IPC.agentSearchWorkspace, args)).toEqual(args);
  });

  it("accepts a session ID when choosing a project for an existing chat", () => {
    expect(parseIpcArgs(IPC.sessionSelectProject, ["en", sessionId])).toEqual(["en", sessionId]);
    const recent = ["E:/projects/Pilot", sessionId];
    expect(parseIpcArgs(IPC.sessionUseRecentProject, recent)).toEqual(recent);
  });

  it("receives typed mentions and rejects invalid source metadata", () => {
    const input = {
      text: "Read @[file:src/index.ts] with @[skill:review]",
      mentions: [
        {
          type: "file",
          id: "src/index.ts",
          label: "index.ts",
          offset: 5,
          meta: { workingDirectory: "E:/projects/Pilot" },
        },
        { type: "skill", id: "review", label: "Review", meta: { description: "Review changes" } },
      ],
    };
    expect(parseIpcArgs(IPC.agentPrompt, [input])).toEqual([input]);
    for (const mention of [
      { ...input.mentions[0], type: "browserTab" },
      { ...input.mentions[0], meta: {} },
      { ...input.mentions[0], id: "src\0index.ts" },
      { ...input.mentions[0], offset: -1 },
    ]) {
      expect(() => parseIpcArgs(IPC.agentPrompt, [{ ...input, mentions: [mention] }])).toThrow(
        /Invalid IPC arguments/,
      );
    }
  });

  it.each([
    [IPC.toolPermissionRespond, [run, sessionId, "later"]],
    [IPC.agentAbort, [{ sessionId }]],
    [IPC.agentResume, [{ sessionId, runId: "other" }]],
    [IPC.agentClearQueue, [{ ...run, runId: "stale" }]],
    [IPC.sessionLoad, ["not-a-session-id"]],
    [IPC.sessionSelectProject, ["zh", "C:/projects/Pilot"]],
    [IPC.sessionUseRecentProject, ["E:/projects/Pilot", "another-folder"]],
    [IPC.sessionGitHead, [" "]],
    [IPC.sessionSaveDraft, [sessionId, [{ type: "file", id: "note" }]]],
    [IPC.sessionUpdateSettings, [sessionId, { model: { providerId: "local", modelId: "" } }]],
    [IPC.sessionUpdateSettings, [sessionId, { approvalMode: "unknown" }]],
    [IPC.sessionUndoFileChange, [sessionId, "C:/some/path"]],
    [IPC.sessionPin, [sessionId, "true"]],
    [IPC.appOpenPath, ["other-directory"]],
    [IPC.appSetTitlebarTheme, ["other-theme"]],
    [IPC.agentPrompt, [" \t\n"]],
    [IPC.agentSearchWorkspace, ["x".repeat(513)]],
    [IPC.agentPreviewWorkspaceReference, [{ path: "src\0index.ts" }]],
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
