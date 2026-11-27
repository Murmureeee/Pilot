import { describe, expect, it } from "vitest";

import type { IpcChannel } from "../src/main/ipc/types";
import { parseIpcArgs } from "../src/main/ipc/validation";
import { IPC, type ProviderInput, type SettingsInput } from "../src/shared/contract";

const sessionId = "48687a06-2cb0-43a1-a627-9752f1621f1b";
const run = { sessionId, runId: "7a6c4360-bb48-4cbd-ae92-b515fdd9ce8b" };
const image = { type: "image", name: "fixture.png", mimeType: "image/png", data: "iVBORw0KGgo=" };
const gitSelection = { path: "file.ts", revision: "a".repeat(64), hunks: [1] };
const pluginId = "f192288a6029c4eafd0bd219";
const pluginSource = { kind: "git", location: "https://example.test/plugin.git" };
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
  auxiliaryModel: { providerId: "local", modelId: "example" },
  workingDirectory: null,
  commandShell: "bash",
  persona: "",
  skillsEnabled: ["example-skill"],
};

const valid: Record<IpcChannel, unknown[]> = {
  [IPC.scheduledTasksList]: [],
  [IPC.scheduledTasksSave]: [
    {
      title: "Daily check",
      prompt: "Summarize README",
      directory: "C:/project",
      frequency: "daily",
      start: "2026-11-28T07:30",
      timeZone: "Asia/Shanghai",
      paused: false,
    },
    null,
  ],
  [IPC.scheduledTasksDelete]: [sessionId],
  [IPC.scheduledTasksRun]: [sessionId, null],
  [IPC.ping]: [{ payload: "hello" }],
  [IPC.runAgentSmoke]: [],
  [IPC.appInfo]: [],
  [IPC.menuAction]: ["undo"],
  [IPC.appOpenPath]: ["logs"],
  [IPC.appDiagnosticEvents]: [],
  [IPC.appExportDiagnostics]: ["en"],
  [IPC.appExportBackup]: [],
  [IPC.appPreviewBackup]: [],
  [IPC.appCancelBackup]: [sessionId],
  [IPC.appRestoreBackup]: [sessionId],
  [IPC.appBackupResult]: [],
  [IPC.appSetTitlebarTheme]: ["system"],
  [IPC.appSetLocale]: ["en"],
  [IPC.appSetConversationVisible]: [true],
  [IPC.appGetUpdateStatus]: [],
  [IPC.appCheckForUpdates]: [],
  [IPC.appDownloadUpdate]: [],
  [IPC.appInstallUpdate]: [],
  [IPC.appShowUpdatePackage]: [],
  [IPC.agentPrompt]: ["  preserve prompt whitespace  "],
  [IPC.agentSearchWorkspace]: ["src/报告"],
  [IPC.agentResolveDroppedPaths]: [sessionId, "E:/project", ["E:/project/report.txt"]],
  [IPC.agentPreviewWorkspaceReference]: [
    { path: "src/报告.md", workingDirectory: "E:/projects/Pilot" },
  ],
  [IPC.agentAbort]: [run],
  [IPC.agentResume]: [run],
  [IPC.agentCompact]: [sessionId],
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
  [IPC.sessionSaveDraftImages]: [sessionId, [image]],
  [IPC.sessionUpdateSettings]: [
    sessionId,
    { model: { providerId: "local", modelId: "example" }, approvalMode: null },
  ],
  [IPC.sessionSetPlanMode]: [sessionId, true],
  [IPC.sessionReviewPlan]: [sessionId, run.runId, { type: "save", markdown: "1. Inspect a file." }],
  [IPC.sessionSelectProject]: ["zh"],
  [IPC.sessionOpenDroppedProject]: ["E:/projects/space folder"],
  [IPC.sessionUseRecentProject]: ["E:/projects/Pilot"],
  [IPC.sessionOpenProjectFolder]: ["E:/projects/Pilot"],
  [IPC.sessionRemoveRecentProject]: ["E:/projects/Pilot"],
  [IPC.sessionGitHead]: ["E:/projects/Pilot"],
  [IPC.sessionGitChanges]: [sessionId],
  [IPC.sessionGitDiff]: [sessionId, { path: "file.ts", area: "unstaged" }],
  [IPC.sessionStageGit]: [sessionId, { ...gitSelection, area: "unstaged" }],
  [IPC.sessionPreviewGitCommit]: [sessionId, [gitSelection]],
  [IPC.sessionCommitGit]: [sessionId, sessionId, "feat: review changes\n\nDetails"],
  [IPC.sessionGitBranches]: [sessionId],
  [IPC.sessionGitWorktrees]: [sessionId],
  [IPC.sessionCreateGitWorktree]: [
    sessionId,
    { branch: "codex/task", baseBranch: "main", baseCommit: "a".repeat(40) },
  ],
  [IPC.sessionOpenGitWorktree]: [sessionId, sessionId],
  [IPC.sessionPreviewGitWorktree]: [sessionId, sessionId],
  [IPC.sessionApplyGitWorktree]: [sessionId, sessionId, "merge"],
  [IPC.sessionPreviewWorktreeArchive]: [sessionId],
  [IPC.sessionSwitchGitBranch]: [sessionId, sessionId, { kind: "create", branch: "feature/stage" }],
  [IPC.sessionPreviewGitPush]: [sessionId],
  [IPC.sessionPushGit]: [sessionId, sessionId],
  [IPC.sessionPreviewGitPullRequest]: [sessionId],
  [IPC.sessionCreateGitPullRequest]: [
    sessionId,
    sessionId,
    { base: "main", title: "Changes", body: "First line\n\nSecond line" },
  ],
  [IPC.sessionGitCheckpointDiff]: [sessionId, sessionId, "file.ts"],
  [IPC.sessionPreviewGitRollback]: [
    sessionId,
    { checkpointId: sessionId, revision: sessionId, path: "file.ts", hunks: [0, 1] },
  ],
  [IPC.sessionApplyGitRollback]: [sessionId, sessionId],
  [IPC.sessionOpenGitLine]: [sessionId, { path: "file.ts", area: "staged" }, 4],
  [IPC.sessionOpenWorkspaceFile]: [sessionId, { path: "file.ts", workingDirectory: "E:/project" }],
  [IPC.sessionLoad]: [sessionId],
  [IPC.sessionRename]: [sessionId, "标题"],
  [IPC.sessionDelete]: [sessionId],
  [IPC.sessionPin]: [sessionId, true],
  [IPC.sessionArchive]: [sessionId, false],
  [IPC.sessionUnread]: [sessionId, true],
  [IPC.sessionFork]: [sessionId],
  [IPC.sessionBranchMessage]: [sessionId, "s-1", "edit"],
  [IPC.sessionPreviewMessageRollback]: [sessionId, "s-2"],
  [IPC.sessionApplyMessageRollback]: [sessionId, sessionId],
  [IPC.sessionCopy]: [sessionId],
  [IPC.sessionSearch]: ["readme.md"],
  [IPC.sessionExportMarkdown]: [sessionId, "en"],
  [IPC.sessionPersona]: [sessionId, null],
  [IPC.sessionInstructionSources]: [sessionId],
  [IPC.sessionProjectConfig]: [sessionId],
  [IPC.sessionSetProjectTrust]: [sessionId, "E:/project", "a".repeat(64)],
  [IPC.sessionPreviewMemory]: [sessionId, "E:/project", "project", "Use pnpm."],
  [IPC.sessionSaveMemory]: [sessionId, run.runId],
  [IPC.sessionUndoMemory]: [sessionId, run.runId],
  [IPC.sessionFileDiff]: [sessionId, sessionId],
  [IPC.sessionUndoFileChange]: [sessionId, sessionId],
  [IPC.sessionVerification]: [sessionId],
  [IPC.sessionSetAfterTurnVerification]: [
    sessionId,
    "E:/project",
    { kind: "test", command: "pnpm test", shell: "powershell" },
  ],
  [IPC.sessionRepairVerification]: [sessionId, run.runId, "en"],
  [IPC.sessionVerificationRun]: [sessionId, sessionId],
  [IPC.sessionStartVerification]: [
    sessionId,
    { workingDirectory: "E:/project", kind: "test", command: "pnpm test --run" },
  ],
  [IPC.sessionStopVerification]: [sessionId, sessionId],
  [IPC.sessionRerunVerification]: [sessionId, sessionId],
  [IPC.sessionTerminals]: [sessionId],
  [IPC.sessionOpenTerminal]: [sessionId, "E:/project", { columns: 80, rows: 24 }],
  [IPC.sessionTerminalOutput]: [sessionId, run.runId],
  [IPC.sessionWriteTerminal]: [sessionId, run.runId, " \x03\r"],
  [IPC.sessionResizeTerminal]: [sessionId, run.runId, { columns: 120, rows: 40 }],
  [IPC.sessionStopTerminal]: [sessionId, run.runId],
  [IPC.settingsModelCatalog]: [draft],
  [IPC.settingsTestProvider]: ["local"],
  [IPC.settingsPickWorkingDirectory]: ["zh"],
  [IPC.settingsPickImportDirectory]: ["en"],
  [IPC.settingsPreviewExternalImport]: ["mcp", null],
  [IPC.settingsImportExternal]: ["mcp", null, ["f192288a6029c4eafd0bd219"]],
  [IPC.settingsImportedPlugins]: [],
  [IPC.settingsToggleImportedPlugin]: [pluginId, true],
  [IPC.settingsPickPluginPackage]: ["zip", "en"],
  [IPC.settingsPreviewPluginPackage]: [pluginSource],
  [IPC.settingsInstallPluginPackage]: [pluginSource, pluginId],
  [IPC.settingsUninstallPlugin]: [pluginId],
  [IPC.settingsPluginMarketplaces]: [],
  [IPC.settingsBrowsePluginMarketplace]: ["https://example.test/market.git", true],
  [IPC.settingsRemovePluginMarketplace]: ["https://example.test/market.git"],
  [IPC.settingsSearchMcpRegistry]: ["filesystem"],
  [IPC.skillsList]: [sessionId],
  [IPC.skillsRead]: [
    sessionId,
    ".agents/skills/example-skill",
    "E:/project/.agents/skills/example-skill",
  ],
  [IPC.skillsDelete]: [sessionId, "example-skill", "E:/pilot/skills/example-skill"],
  [IPC.skillsImport]: ["en", sessionId],
  [IPC.skillsToggle]: [sessionId, "example-skill", true],
  [IPC.settingsGet]: [],
  [IPC.settingsSetProjectHooks]: ["E:/project", "bash", { beforeTool: "git status" }],
  [IPC.settingsUsageReport]: [],
  [IPC.settingsDesktopBackground]: [],
  [IPC.settingsSetDesktopBackground]: ["closeToTray", true],
  [IPC.settingsSetPromptTemplates]: [[{ name: "audit", text: "Review {{file}}." }]],
  [IPC.settingsSave]: [settings],
  [IPC.settingsSetLogLevel]: ["debug"],
  [IPC.settingsSetNotificationsEnabled]: [false],
  [IPC.settingsSetAutoDownloadUpdates]: [false],
  [IPC.settingsSetExternalEditor]: [{ kind: "custom", command: "editor", args: ["{file}:{line}"] }],
  [IPC.settingsSelectModel]: ["local", "example"],
  [IPC.settingsSetThinkingLevel]: ["high"],
  [IPC.settingsRevokeToolRule]: [
    { toolName: "bash", commandPrefix: { shell: "bash", args: ["git", "status"] } },
  ],
  [IPC.settingsDismissRecovery]: [],
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
  [IPC.settingsMcpOAuthStart]: [{ id: sessionId, revision: "a".repeat(64) }, sessionId, "en"],
  [IPC.settingsMcpOAuthCancel]: [sessionId],
  [IPC.settingsMcpOAuthSignOut]: [{ id: sessionId, revision: "a".repeat(64) }],
  [IPC.settingsMcpRemove]: [sessionId],
  [IPC.toolPermissionRespond]: [run, sessionId, "once"],
  [IPC.toolProjectTrustRespond]: [run, sessionId, "trust"],
};

describe("IPC argument validation", () => {
  it("validates the project preview revision and the run-scoped trust decision", () => {
    expect(parseIpcArgs(IPC.sessionSetProjectTrust, [sessionId, "E:/project", null])).toEqual([
      sessionId,
      "E:/project",
      null,
    ]);
    expect(() =>
      parseIpcArgs(IPC.sessionSetProjectTrust, [sessionId, "E:/project", "old"]),
    ).toThrow(/Invalid IPC arguments/);
    expect(() => parseIpcArgs(IPC.toolProjectTrustRespond, [run, sessionId, "global"])).toThrow(
      /Invalid IPC arguments/,
    );
  });
  it("checks registry query lengths, cursors and Git subdirectories", () => {
    expect(parseIpcArgs(IPC.settingsSearchMcpRegistry, [""])).toEqual([""]);
    expect(parseIpcArgs(IPC.settingsSearchMcpRegistry, [" search ", "next"])).toEqual([
      "search",
      "next",
    ]);
    expect(() => parseIpcArgs(IPC.settingsSearchMcpRegistry, ["ab"])).toThrow(
      /Invalid IPC arguments/,
    );
    expect(() => parseIpcArgs(IPC.settingsSearchMcpRegistry, ["search", ""])).toThrow(
      /Invalid IPC arguments/,
    );
    const source = { ...pluginSource, path: "plugins/notes", ref: "v1.0.0", sha: "c".repeat(40) };
    expect(parseIpcArgs(IPC.settingsPreviewPluginPackage, [source])).toEqual([source]);
    for (const invalid of [
      { ...source, path: "../notes" },
      { ...source, path: "/notes" },
      { ...source, ref: "refs/main:other" },
      { ...source, sha: "deadbeef" },
      { ...source, kind: "zip" },
    ])
      expect(() => parseIpcArgs(IPC.settingsPreviewPluginPackage, [invalid])).toThrow(
        /Invalid IPC arguments/,
      );
  });
  it("checks package source types and requires a preview token before installation", () => {
    expect(parseIpcArgs(IPC.settingsPreviewPluginPackage, [pluginId])).toEqual([pluginId]);
    expect(parseIpcArgs(IPC.settingsInstallPluginPackage, [pluginId, pluginId])).toEqual([
      pluginId,
      pluginId,
    ]);
    expect(() => parseIpcArgs(IPC.settingsPickPluginPackage, ["git", "en"])).toThrow(
      /Invalid IPC arguments/,
    );
    expect(() => parseIpcArgs(IPC.settingsInstallPluginPackage, [pluginSource, "stale"])).toThrow(
      /Invalid IPC arguments/,
    );
    for (const source of [
      { kind: "tar", location: "E:/plugin.tar" },
      { kind: "zip", location: " " },
      { kind: "directory", location: "E:/plugin\0folder" },
      { ...pluginSource, token: pluginId },
    ])
      expect(() => parseIpcArgs(IPC.settingsPreviewPluginPackage, [source])).toThrow(
        /Invalid IPC arguments/,
      );
  });

  it("requires an exact command and shell for after-turn verification and allows removal", () => {
    const args = [sessionId, "E:/project"];
    expect(parseIpcArgs(IPC.sessionSetAfterTurnVerification, [...args, null])).toEqual([
      ...args,
      null,
    ]);
    for (const config of [
      { kind: "test", command: " ", shell: "bash" },
      { kind: "test", command: "node check.cjs\0", shell: "bash" },
      { kind: "test", command: "node check.cjs" },
    ])
      expect(() => parseIpcArgs(IPC.sessionSetAfterTurnVerification, [...args, config])).toThrow(
        /Invalid IPC arguments/,
      );
  });

  it("limits memory previews to the supported scopes and checks their text and tokens", () => {
    expect(
      parseIpcArgs(IPC.sessionPreviewMemory, [sessionId, null, "global", "Use pnpm."]),
    ).toEqual([sessionId, null, "global", "Use pnpm."]);
    for (const args of [
      [sessionId, null, "file", "Use pnpm."],
      [sessionId, null, "global", "bad\0text"],
      [sessionId, null, "global", "a".repeat(12_001)],
    ])
      expect(() => parseIpcArgs(IPC.sessionPreviewMemory, args)).toThrow(/Invalid IPC arguments/);
    expect(() => parseIpcArgs(IPC.sessionSaveMemory, [sessionId, "stale"])).toThrow(
      /Invalid IPC arguments/,
    );
  });

  it("requires at least one image for a blank prompt and checks attachment formats", () => {
    const input = { text: "", mentions: [], images: [image] };
    expect(parseIpcArgs(IPC.agentPrompt, [input])).toEqual([input]);
    expect(() => parseIpcArgs(IPC.agentPrompt, [{ ...input, images: [] }])).toThrow(
      /Invalid IPC arguments/,
    );
    expect(() =>
      parseIpcArgs(IPC.sessionSaveDraftImages, [
        sessionId,
        [{ ...image, mimeType: "image/svg+xml" }],
      ]),
    ).toThrow(/Invalid IPC arguments/);
    expect(() =>
      parseIpcArgs(IPC.sessionSaveDraftImages, [sessionId, [{ ...image, mimeType: "image/jpeg" }]]),
    ).toThrow(/Invalid IPC arguments/);
    expect(() =>
      parseIpcArgs(IPC.sessionSaveDraftImages, [
        sessionId,
        Array.from({ length: 5 }, () => ({ ...image })),
      ]),
    ).toThrow(/Invalid IPC arguments/);
  });

  it("accepts all-project, unlinked, and project-scoped transcript searches", () => {
    for (const project of [null, "E:/projects/Pilot"]) {
      const args = ["readme.md", project];
      expect(parseIpcArgs(IPC.sessionSearch, args)).toEqual(args);
    }
  });
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

  it("accepts a compaction focus and a context-overflow retry flag", () => {
    expect(parseIpcArgs(IPC.agentCompact, [sessionId, "保留重点"])).toEqual([
      sessionId,
      "保留重点",
    ]);
    expect(parseIpcArgs(IPC.agentResume, [run, true])).toEqual([run, true]);
  });

  it("toggles plan mode independently and requires a proposal revision for review decisions", () => {
    expect(parseIpcArgs(IPC.sessionSetPlanMode, [sessionId, false])).toEqual([sessionId, false]);
    expect(() =>
      parseIpcArgs(IPC.sessionUpdateSettings, [sessionId, { approvalMode: "plan" }]),
    ).toThrow(/Invalid IPC arguments/);
    const decision = [sessionId, run.runId, { type: "execute" }];
    expect(parseIpcArgs(IPC.sessionReviewPlan, decision)).toEqual(decision);
    expect(() => parseIpcArgs(IPC.settingsSave, [{ ...settings, approvalMode: "plan" }])).toThrow(
      /Invalid IPC arguments/,
    );
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

  it("accepts diff comments in drafts and prompts with ordered ranges on the correct side", () => {
    const diff = {
      area: "unstaged",
      before: { first: 8, last: 9 },
      after: { first: 8, last: 10 },
      openLine: 8,
    };
    const mention = {
      type: "file",
      id: "notes.txt",
      label: "notes.txt:8–10",
      meta: { workingDirectory: "E:/projects/Pilot", diff },
    };
    const draftArgs = [sessionId, [mention]];
    expect(parseIpcArgs(IPC.sessionSaveDraft, draftArgs)).toEqual(draftArgs);
    const promptArgs = [{ text: "Review the diff", mentions: [{ ...mention, offset: 0 }] }];
    expect(parseIpcArgs(IPC.agentPrompt, promptArgs)).toEqual(promptArgs);
    for (const invalid of [
      { ...diff, before: { first: 9, last: 8 } },
      { ...diff, after: undefined },
      { ...diff, area: "untracked" },
      { area: "staged" },
    ]) {
      expect(() =>
        parseIpcArgs(IPC.sessionSaveDraft, [
          sessionId,
          [{ ...mention, meta: { ...mention.meta, diff: invalid } }],
        ]),
      ).toThrow(/Invalid IPC arguments/);
    }
  });

  it.each([
    [IPC.toolPermissionRespond, [run, sessionId, "later"]],
    [IPC.agentAbort, [{ sessionId }]],
    [IPC.agentResume, [{ sessionId, runId: "other" }]],
    [IPC.agentClearQueue, [{ ...run, runId: "stale" }]],
    [IPC.sessionLoad, ["not-a-session-id"]],
    [IPC.sessionSearch, ["   "]],
    [IPC.sessionSearch, ["x".repeat(513)]],
    [IPC.sessionExportMarkdown, [sessionId, "fr"]],
    [IPC.sessionSelectProject, ["zh", "C:/projects/Pilot"]],
    [IPC.sessionOpenDroppedProject, [""]],
    [IPC.sessionOpenDroppedProject, ["E:/projects/bad\0folder"]],
    [IPC.sessionUseRecentProject, ["E:/projects/Pilot", "another-folder"]],
    [IPC.sessionOpenProjectFolder, [" "]],
    [IPC.sessionRemoveRecentProject, ["E:/projects/Pilot", true]],
    [IPC.sessionGitHead, [" "]],
    [IPC.sessionGitChanges, ["E:/projects/Pilot"]],
    [IPC.sessionStageGit, [sessionId, { ...gitSelection, area: "staged" }]],
    [IPC.sessionPreviewGitCommit, [sessionId, []]],
    [IPC.sessionCommitGit, [sessionId, sessionId, "  "]],
    [
      IPC.sessionCreateGitWorktree,
      [
        sessionId,
        {
          branch: "codex/task",
          baseBranch: "main",
          baseCommit: "HEAD",
          directory: "C:/elsewhere",
        },
      ],
    ],
    [IPC.sessionApplyGitWorktree, [sessionId, sessionId, "force"]],
    [IPC.sessionOpenGitWorktree, [sessionId, "C:/elsewhere"]],
    [IPC.sessionSwitchGitBranch, [sessionId, sessionId, { kind: "switch", branch: "--detach" }]],
    [IPC.sessionSwitchGitBranch, [sessionId, sessionId, { kind: "reset", branch: "main" }]],
    [IPC.sessionPushGit, [sessionId, sessionId, { force: true }]],
    [
      IPC.sessionCreateGitPullRequest,
      [sessionId, sessionId, { base: "main", title: "a\nb", body: "" }],
    ],
    [
      IPC.sessionCreateGitPullRequest,
      [sessionId, sessionId, { base: "main", title: "PR", body: "a\0b" }],
    ],
    [
      IPC.sessionPreviewGitRollback,
      [sessionId, { checkpointId: sessionId, revision: sessionId, path: "file.ts", hunks: [-1] }],
    ],
    [IPC.sessionOpenGitLine, [sessionId, { path: "file.ts", area: "staged" }, 0]],
    [IPC.sessionOpenWorkspaceFile, [sessionId, { path: "file.ts" }, 0]],
    [IPC.sessionOpenWorkspaceFile, [sessionId, { path: "file.ts", command: "node" }]],
    [IPC.settingsSetExternalEditor, [{ kind: "cursor", command: "node" }]],
    [IPC.settingsSetExternalEditor, [{ kind: "jetbrains", command: " " }]],
    [IPC.settingsSetExternalEditor, [{ kind: "custom", command: "editor", args: ["{line}"] }]],
    [IPC.settingsSetExternalEditor, [{ kind: "custom", command: "editor", args: ["{file}\0"] }]],
    [IPC.sessionSaveDraft, [sessionId, [{ type: "file", id: "note" }]]],
    [IPC.sessionUpdateSettings, [sessionId, { model: { providerId: "local", modelId: "" } }]],
    [IPC.sessionUpdateSettings, [sessionId, { approvalMode: "unknown" }]],
    [IPC.sessionSetPlanMode, [sessionId, "on"]],
    [IPC.sessionReviewPlan, [sessionId, "stale", { type: "execute" }]],
    [IPC.sessionReviewPlan, [sessionId, run.runId, { type: "execute", markdown: "other" }]],
    [IPC.sessionUndoFileChange, [sessionId, "C:/some/path"]],
    [
      IPC.sessionStartVerification,
      [sessionId, { workingDirectory: "E:/project", kind: "test", command: " " }],
    ],
    [
      IPC.sessionStartVerification,
      [sessionId, { workingDirectory: "E:/project", kind: "other", command: "pnpm test" }],
    ],
    [IPC.sessionStopVerification, [sessionId, "invalid-run"]],
    [IPC.sessionOpenTerminal, [sessionId, " ", { columns: 80, rows: 24 }]],
    [IPC.sessionResizeTerminal, [sessionId, run.runId, { columns: 1001, rows: 24 }]],
    [IPC.sessionWriteTerminal, [sessionId, run.runId, ""]],
    [IPC.sessionStopTerminal, [sessionId, "invalid-terminal"]],
    [IPC.sessionPin, [sessionId, "true"]],
    [IPC.appOpenPath, ["other-directory"]],
    [IPC.appSetTitlebarTheme, ["other-theme"]],
    [IPC.appSetLocale, ["fr"]],
    [IPC.agentPrompt, [" \t\n"]],
    [IPC.agentSearchWorkspace, ["x".repeat(513)]],
    [IPC.agentPreviewWorkspaceReference, [{ path: "src\0index.ts" }]],
    [IPC.skillsImport, ["other-language", sessionId]],
    [IPC.skillsRead, [sessionId, "odd\0skill", "E:/project"]],
    [IPC.skillsDelete, [sessionId, "example-skill", " "]],
    [IPC.settingsPreviewExternalImport, ["unsupported", null]],
    [IPC.settingsImportExternal, ["codex", null]],
    [IPC.settingsImportExternal, ["mcp", {}, ["f192288a6029c4eafd0bd219"]]],
    [IPC.settingsImportExternal, ["skill", null, []]],
    [IPC.settingsImportExternal, ["mcp", null, ["../invalid"]]],
    [IPC.settingsToggleImportedPlugin, ["../../other-plugin", false]],
    [IPC.settingsSave, [{ ...settings, approvalMode: "other-mode" }]],
    [IPC.settingsSetLogLevel, ["verbose"]],
    [IPC.appSetConversationVisible, ["true"]],
    [IPC.settingsSetNotificationsEnabled, [0]],
    [IPC.settingsSetAutoDownloadUpdates, ["false"]],
    [IPC.appDownloadUpdate, ["https://example.com/update.exe"]],
    [IPC.settingsSelectModel, ["local", ""]],
    [IPC.settingsSetThinkingLevel, ["ultra"]],
    [IPC.settingsSetPromptTemplates, [[{ name: "two words", text: "Review" }]]],
    [IPC.settingsSetPromptTemplates, [[{ name: "audit", text: "  " }]]],
    [
      IPC.settingsSetPromptTemplates,
      [
        [
          { name: "Audit", text: "One" },
          { name: "audit", text: "Two" },
        ],
      ],
    ],
    [IPC.settingsSave, [{ ...settings, thinkingLevels: [] }]],
    [IPC.settingsSave, [{ ...settings, toolRules: [{ toolName: "bash" }] }]],
    [IPC.settingsRevokeToolRule, [{ toolName: "write_file", pathPrefix: 7 }]],
    [
      IPC.settingsRevokeToolRule,
      [{ toolName: "bash", commandPrefix: { shell: "bash", args: [] } }],
    ],
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
