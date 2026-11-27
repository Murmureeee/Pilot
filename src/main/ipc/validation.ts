// @env node
import { z } from "zod";

import {
  CONVERSATION_QUERY_LENGTH,
  EXECUTION_APPROVAL_MODES,
  GIT_BRANCH_NAME_LIMIT,
  GIT_PR_BODY_LIMIT,
  GIT_PR_TITLE_LIMIT,
  LOG_LEVELS,
  MEMORY_TEXT_LIMIT,
  PLAN_PROPOSAL_MAX_LENGTH,
  SUPPORTED_LOCALES,
  THINKING_LEVELS,
  WORKSPACE_QUERY_LENGTH,
} from "../../shared/constants";
import { IPC, VERIFICATION_KINDS } from "../../shared/contract";
import { MCP_REGISTRY_MIN_QUERY } from "../../shared/discovery";
import { imageAttachmentsSchema } from "../agent-host/image-attachments";
import {
  afterTurnVerificationSchema,
  externalEditorSchema,
  mcpOAuthClientSchema,
  pluginLocationSchema,
  pluginPackageSourceSchema,
  promptTemplatesSchema,
  toolRuleSchema,
  verificationCommandSchema,
} from "../settings/schema";
import { GIT_OBJECT_ID } from "../workspace/constants";
import { gitDiffReferenceSchema } from "../workspace/reference";
import type { IpcChannel } from "./types";

const none = z.tuple([]);
const id = z.string().min(1);
const nonBlank = z.string().refine((value) => value.trim().length > 0);
const gitBranchName = z
  .string()
  .min(1)
  .max(GIT_BRANCH_NAME_LIMIT)
  .refine((value) => !/^-|[\0\r\n]/.test(value));
const mentionId = id.refine((value) => !value.includes("\0"));
const workspaceReference = z.strictObject({
  path: mentionId,
  workingDirectory: nonBlank.optional(),
});
const mentionOffset = z.number().int().nonnegative().optional();
const fileMention = z.strictObject({
  type: z.literal("file"),
  id: mentionId,
  label: id,
  meta: z.strictObject({ workingDirectory: nonBlank, diff: gitDiffReferenceSchema.optional() }),
});
const directoryMention = z.strictObject({
  type: z.literal("directory"),
  id: mentionId,
  label: id,
  meta: z.strictObject({ workingDirectory: nonBlank }),
});
const skillMention = z.strictObject({
  type: z.literal("skill"),
  id: mentionId,
  label: id,
  meta: z.strictObject({ description: z.string(), workingDirectory: nonBlank.optional() }),
});
const composerDraft = z.array(
  z.union([
    z.string(),
    z.discriminatedUnion("type", [fileMention, directoryMention, skillMention]),
  ]),
);
const promptInput = z
  .strictObject({
    text: z.string(),
    mentions: z.array(
      z.discriminatedUnion("type", [
        fileMention.extend({ offset: mentionOffset }),
        directoryMention.extend({ offset: mentionOffset }),
        skillMention.extend({ offset: mentionOffset }),
      ]),
    ),
    images: imageAttachmentsSchema.optional(),
  })
  .refine(({ text, images }) => text.trim().length > 0 || Boolean(images?.length));
const locale = z.tuple([z.enum(SUPPORTED_LOCALES)]);
const session = z.tuple([z.uuid()]);
const runRef = z.strictObject({ sessionId: z.uuid(), runId: z.uuid() });
const sessionFlag = z.tuple([z.uuid(), z.boolean()]);
const sessionChange = z.tuple([z.uuid(), z.uuid()]);
const terminalSize = z.strictObject({
  columns: z.number().int().min(2).max(1000),
  rows: z.number().int().min(1).max(500),
});
const gitDiffRequest = z.strictObject({
  path: mentionId,
  area: z.enum(["staged", "unstaged", "untracked"]),
  live: z.boolean().optional(),
});
const gitPatchSelection = z.strictObject({
  path: mentionId,
  revision: z.string().regex(/^[a-f0-9]{64}$/),
  hunks: z.array(z.number().int().nonnegative()).min(1).max(700).optional(),
});
const gitStageSelection = gitPatchSelection.extend({ area: z.enum(["unstaged", "untracked"]) });
const gitRollbackSelection = z.strictObject({
  checkpointId: z.uuid(),
  path: mentionId,
  revision: z.uuid(),
  hunks: z.array(z.number().int().nonnegative()).min(1).max(700).optional(),
});
const executionApprovalMode = z.enum(EXECUTION_APPROVAL_MODES);
const modelCapabilities = z.strictObject({
  contextWindow: z.number().int().positive().optional(),
  maxTokens: z.number().int().positive().optional(),
  supportsImages: z.boolean().optional(),
  supportsThinking: z.boolean().optional(),
});
const provider = z.strictObject({
  id,
  kind: z.enum(["anthropic", "openai-compatible", "openai-responses", "faux"]),
  name: z.string(),
  baseUrl: z.string().optional(),
  modelId: z.string(),
  models: z
    .array(
      modelCapabilities.extend({
        id: nonBlank,
        name: z.string(),
        overrides: modelCapabilities.optional(),
        cost: z
          .strictObject({
            input: z.number().nonnegative().optional(),
            output: z.number().nonnegative().optional(),
            cacheRead: z.number().nonnegative().optional(),
            cacheWrite: z.number().nonnegative().optional(),
          })
          .optional(),
      }),
    )
    .optional(),
  apiKey: z.string().optional(),
});
const providerRef = z.tuple([z.union([id, provider])]);
const mcpServer = z.strictObject({
  id: z.uuid(),
  name: nonBlank,
  enabled: z.boolean(),
  policy: z.enum(["inherit", "confirm"]),
  transport: z
    .discriminatedUnion("type", [
      z.strictObject({ type: z.literal("stdio"), command: nonBlank, args: z.array(z.string()) }),
      z.strictObject({
        type: z.literal("http"),
        url: z.url({ protocol: /^https?$/ }).refine((value) => {
          const url = URL.parse(value);
          return url !== null && url.username === "" && url.password === "";
        }),
      }),
    ])
    .optional(),
  env: z.array(z.tuple([z.string().regex(/^[A-Za-z_][A-Za-z0-9_]*$/), z.string()])).optional(),
  headers: z
    .array(
      z.tuple([
        z.string().regex(/^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/),
        z.string().regex(/^[^\r\n\0]*$/),
      ]),
    )
    .optional(),
  oauthClient: mcpOAuthClientSchema.nullable().optional(),
});
const mcpOAuthRef = z.strictObject({
  id: z.union([z.uuid(), z.string().regex(/^project:[a-f0-9]{16}$/)]),
  revision: z.hash("sha256"),
  composerId: z.uuid().optional(),
});
const settings = z.strictObject({
  providers: z.array(provider),
  activeProviderId: z.string(),
  auxiliaryModel: z.strictObject({ providerId: nonBlank, modelId: nonBlank }).nullable().optional(),
  approvalMode: executionApprovalMode.optional(),
  thinkingLevel: z.enum(THINKING_LEVELS).optional(),
  thinkingLevels: z.array(z.enum(THINKING_LEVELS)).min(1).optional(),
  workingDirectory: z.string().nullable().optional(),
  commandShell: z.enum(["powershell", "bash"]).optional(),
  persona: z.string().optional(),
  skillsEnabled: z.array(id).optional(),
});

const importKind = z.enum(["skill", "plugin", "mcp"]);
const importId = z.string().regex(/^[a-f0-9]{24}$/);
const pluginPackageTarget = z.union([pluginPackageSourceSchema, importId]);

const inputs = {
  [IPC.ping]: z.tuple([z.strictObject({ payload: z.string() })]),
  [IPC.runAgentSmoke]: none,
  [IPC.appInfo]: none,
  [IPC.appOpenPath]: z.tuple([z.enum(["settings", "sessions", "skills", "logs"])]),
  [IPC.appDiagnosticEvents]: none,
  [IPC.appExportDiagnostics]: locale,
  [IPC.appExportBackup]: none,
  [IPC.appPreviewBackup]: none,
  [IPC.appCancelBackup]: z.tuple([z.uuid()]),
  [IPC.appRestoreBackup]: z.tuple([z.uuid()]),
  [IPC.appBackupResult]: none,
  [IPC.appSetLocale]: locale,
  [IPC.appSetConversationVisible]: z.tuple([z.boolean()]),
  [IPC.appSetTitlebarTheme]: z.tuple([z.enum(["light", "dark", "system"])]),
  [IPC.appGetUpdateStatus]: none,
  [IPC.appCheckForUpdates]: none,
  [IPC.appDownloadUpdate]: none,
  [IPC.appInstallUpdate]: none,
  [IPC.appShowUpdatePackage]: none,
  [IPC.menuAction]: z.tuple([
    z.enum([
      "undo",
      "redo",
      "cut",
      "copy",
      "paste",
      "delete",
      "select-all",
      "zoom-in",
      "zoom-out",
      "zoom-reset",
      "reload",
      "fullscreen",
      "close",
      "quit",
    ]),
  ]),
  [IPC.agentGetSnapshot]: none,
  [IPC.agentPrompt]: z.tuple([
    z.union([nonBlank, promptInput]),
    nonBlank.nullable().optional(),
    z.uuid().optional(),
  ]),
  [IPC.agentSearchWorkspace]: z.tuple([
    z.string().max(WORKSPACE_QUERY_LENGTH),
    nonBlank.optional(),
  ]),
  [IPC.agentPreviewWorkspaceReference]: z.tuple([workspaceReference]),
  [IPC.agentAbort]: z.tuple([runRef]),
  [IPC.agentResume]: z.tuple([runRef, z.boolean().optional()]),
  [IPC.agentCompact]: z.tuple([id, z.string().optional()]),
  [IPC.agentClearQueue]: z.tuple([runRef]),
  [IPC.sessionNew]: none,
  [IPC.sessionSaveDraft]: z.tuple([z.uuid(), composerDraft]),
  [IPC.sessionSaveDraftImages]: z.tuple([z.uuid(), imageAttachmentsSchema]),
  [IPC.agentResolveDroppedPaths]: z.tuple([z.uuid(), nonBlank, z.array(mentionId).max(100)]),
  [IPC.sessionUpdateSettings]: z.tuple([
    z.uuid(),
    z.strictObject({
      model: z.strictObject({ providerId: nonBlank, modelId: nonBlank }).nullable().optional(),
      approvalMode: executionApprovalMode.nullable().optional(),
    }),
  ]),
  [IPC.sessionSetPlanMode]: sessionFlag,
  [IPC.sessionReviewPlan]: z.tuple([
    z.uuid(),
    z.uuid(),
    z.discriminatedUnion("type", [
      z.strictObject({
        type: z.literal("save"),
        markdown: z.string().max(PLAN_PROPOSAL_MAX_LENGTH),
      }),
      z.strictObject({ type: z.enum(["execute", "discard"]) }),
    ]),
  ]),
  [IPC.sessionSelectProject]: z.tuple([z.enum(SUPPORTED_LOCALES), z.uuid().optional()]),
  [IPC.sessionOpenDroppedProject]: z.tuple([nonBlank.refine((value) => !value.includes("\0"))]),
  [IPC.sessionUseRecentProject]: z.tuple([nonBlank, z.uuid().optional()]),
  [IPC.sessionOpenProjectFolder]: z.tuple([nonBlank]),
  [IPC.sessionRemoveRecentProject]: z.tuple([nonBlank]),
  [IPC.sessionGitHead]: z.tuple([nonBlank]),
  [IPC.sessionGitChanges]: z.tuple([z.uuid(), z.boolean().optional()]),
  [IPC.sessionGitDiff]: z.tuple([z.uuid(), gitDiffRequest]),
  [IPC.sessionStageGit]: z.tuple([z.uuid(), gitStageSelection]),
  [IPC.sessionPreviewGitCommit]: z.tuple([z.uuid(), z.array(gitPatchSelection).min(1)]),
  [IPC.sessionCommitGit]: z.tuple([
    z.uuid(),
    z.uuid(),
    nonBlank.refine((value) => !value.includes("\0")),
  ]),
  [IPC.sessionGitBranches]: session,
  [IPC.sessionGitWorktrees]: session,
  [IPC.sessionCreateGitWorktree]: z.tuple([
    z.uuid(),
    z.strictObject({
      branch: gitBranchName,
      baseBranch: gitBranchName,
      baseCommit: z.string().regex(GIT_OBJECT_ID),
    }),
  ]),
  [IPC.sessionOpenGitWorktree]: sessionChange,
  [IPC.sessionPreviewGitWorktree]: sessionChange,
  [IPC.sessionApplyGitWorktree]: z.tuple([z.uuid(), z.uuid(), z.enum(["merge", "remove"])]),
  [IPC.sessionPreviewWorktreeArchive]: session,
  [IPC.sessionSwitchGitBranch]: z.tuple([
    z.uuid(),
    z.uuid(),
    z.strictObject({ kind: z.enum(["create", "switch"]), branch: gitBranchName }),
  ]),
  [IPC.sessionPreviewGitPush]: session,
  [IPC.sessionPushGit]: sessionChange,
  [IPC.sessionPreviewGitPullRequest]: session,
  [IPC.sessionCreateGitPullRequest]: z.tuple([
    z.uuid(),
    z.uuid(),
    z.strictObject({
      base: gitBranchName,
      title: z
        .string()
        .trim()
        .min(1)
        .max(GIT_PR_TITLE_LIMIT)
        .refine((value) => !/[\0\r\n]/.test(value)),
      body: z
        .string()
        .max(GIT_PR_BODY_LIMIT)
        .refine((value) => !value.includes("\0")),
    }),
  ]),
  [IPC.sessionGitCheckpointDiff]: z.tuple([z.uuid(), z.uuid(), mentionId]),
  [IPC.sessionPreviewGitRollback]: z.tuple([z.uuid(), gitRollbackSelection]),
  [IPC.sessionApplyGitRollback]: sessionChange,
  [IPC.sessionOpenGitLine]: z.tuple([z.uuid(), gitDiffRequest, z.number().int().positive()]),
  [IPC.sessionOpenWorkspaceFile]: z.tuple([
    z.uuid(),
    workspaceReference,
    z.number().int().positive().optional(),
  ]),
  [IPC.sessionLoad]: z.tuple([z.uuid(), z.boolean().optional()]),
  [IPC.sessionRename]: z.tuple([z.uuid(), nonBlank]),
  [IPC.sessionDelete]: session,
  [IPC.sessionPin]: sessionFlag,
  [IPC.sessionArchive]: sessionFlag,
  [IPC.sessionUnread]: sessionFlag,
  [IPC.sessionFork]: session,
  [IPC.sessionBranchMessage]: z.tuple([
    z.uuid(),
    z.string().regex(/^s-(0|[1-9]\d*)$/),
    z.enum(["fork", "edit", "retry"]),
  ]),
  [IPC.sessionPreviewMessageRollback]: z.tuple([z.uuid(), z.string().regex(/^s-(0|[1-9]\d*)$/)]),
  [IPC.sessionApplyMessageRollback]: sessionChange,
  [IPC.sessionCopy]: session,
  [IPC.sessionSearch]: z.tuple([
    z.string().trim().min(1).max(CONVERSATION_QUERY_LENGTH),
    nonBlank.nullable().optional(),
  ]),
  [IPC.sessionExportMarkdown]: z.tuple([z.uuid(), z.enum(SUPPORTED_LOCALES)]),
  [IPC.sessionPersona]: z.tuple([z.uuid(), z.string().nullable()]),
  [IPC.sessionInstructionSources]: session,
  [IPC.sessionProjectConfig]: session,
  [IPC.sessionSetProjectTrust]: z.tuple([z.uuid(), mentionId, z.hash("sha256").nullable()]),
  [IPC.sessionPreviewMemory]: z.tuple([
    z.uuid(),
    mentionId.nullable(),
    z.enum(["project", "global"]),
    z
      .string()
      .max(MEMORY_TEXT_LIMIT)
      .refine((text) => !text.includes("\0")),
  ]),
  [IPC.sessionSaveMemory]: sessionChange,
  [IPC.sessionUndoMemory]: sessionChange,
  [IPC.sessionFileDiff]: sessionChange,
  [IPC.sessionUndoFileChange]: sessionChange,
  [IPC.sessionVerification]: session,
  [IPC.sessionSetAfterTurnVerification]: z.tuple([
    z.uuid(),
    mentionId,
    z.union([afterTurnVerificationSchema, z.literal("project"), z.null()]),
  ]),
  [IPC.sessionRepairVerification]: z.tuple([z.uuid(), z.uuid(), z.enum(SUPPORTED_LOCALES)]),
  [IPC.sessionVerificationRun]: sessionChange,
  [IPC.sessionStartVerification]: z.tuple([
    z.uuid(),
    z.strictObject({
      workingDirectory: mentionId,
      kind: z.enum(VERIFICATION_KINDS),
      command: verificationCommandSchema,
      projectRevision: z.hash("sha256").optional(),
    }),
  ]),
  [IPC.sessionStopVerification]: sessionChange,
  [IPC.sessionRerunVerification]: sessionChange,
  [IPC.sessionTerminals]: session,
  [IPC.sessionOpenTerminal]: z.tuple([z.uuid(), nonBlank, terminalSize]),
  [IPC.sessionTerminalOutput]: sessionChange,
  [IPC.sessionWriteTerminal]: z.tuple([z.uuid(), z.uuid(), z.string().min(1).max(1_048_576)]),
  [IPC.sessionResizeTerminal]: z.tuple([z.uuid(), z.uuid(), terminalSize]),
  [IPC.sessionStopTerminal]: sessionChange,
  [IPC.settingsModelCatalog]: providerRef,
  [IPC.settingsTestProvider]: providerRef,
  [IPC.settingsPickWorkingDirectory]: locale,
  [IPC.settingsPickImportDirectory]: locale,
  [IPC.settingsPreviewExternalImport]: z.tuple([importKind, nonBlank.nullable()]),
  [IPC.settingsImportExternal]: z.tuple([
    importKind,
    nonBlank.nullable(),
    z.array(importId).min(1),
  ]),
  [IPC.settingsImportedPlugins]: none,
  [IPC.settingsToggleImportedPlugin]: z.tuple([importId, z.boolean()]),
  [IPC.settingsPickPluginPackage]: z.tuple([
    z.enum(["directory", "zip"]),
    z.enum(SUPPORTED_LOCALES),
  ]),
  [IPC.settingsPreviewPluginPackage]: z.tuple([pluginPackageTarget]),
  [IPC.settingsInstallPluginPackage]: z.tuple([pluginPackageTarget, importId]),
  [IPC.settingsUninstallPlugin]: z.tuple([importId]),
  [IPC.settingsPluginMarketplaces]: none,
  [IPC.settingsBrowsePluginMarketplace]: z.tuple([pluginLocationSchema, z.boolean()]),
  [IPC.settingsRemovePluginMarketplace]: z.tuple([pluginLocationSchema]),
  [IPC.settingsSearchMcpRegistry]: z.tuple([
    z
      .string()
      .trim()
      .max(200)
      .refine(
        (query) => (!query || [...query].length >= MCP_REGISTRY_MIN_QUERY) && !query.includes("\0"),
      ),
    z
      .string()
      .min(1)
      .max(2048)
      .refine((cursor) => !cursor.includes("\0"))
      .optional(),
  ]),
  [IPC.skillsList]: session,
  [IPC.skillsRead]: z.tuple([z.uuid(), mentionId, nonBlank]),
  [IPC.skillsDelete]: z.tuple([z.uuid(), mentionId, nonBlank]),
  [IPC.skillsImport]: z.tuple([z.enum(SUPPORTED_LOCALES), z.uuid()]),
  [IPC.skillsToggle]: z.tuple([z.uuid(), mentionId, z.boolean()]),
  [IPC.settingsGet]: none,
  [IPC.settingsSave]: z.tuple([settings]),
  [IPC.settingsSetPromptTemplates]: z.tuple([promptTemplatesSchema]),
  [IPC.settingsSetLogLevel]: z.tuple([z.enum(LOG_LEVELS)]),
  [IPC.settingsSetNotificationsEnabled]: z.tuple([z.boolean()]),
  [IPC.settingsSetAutoDownloadUpdates]: z.tuple([z.boolean()]),
  [IPC.settingsSetExternalEditor]: z.tuple([externalEditorSchema]),
  [IPC.settingsSelectModel]: z.tuple([id, nonBlank]),
  [IPC.settingsSetThinkingLevel]: z.tuple([z.enum(THINKING_LEVELS)]),
  [IPC.settingsRevokeToolRule]: z.tuple([toolRuleSchema.extend({ toolName: id }).strict()]),
  [IPC.settingsDismissRecovery]: none,
  [IPC.settingsMcpList]: none,
  [IPC.settingsMcpSave]: z.tuple([mcpServer]),
  [IPC.settingsMcpReconnect]: z.tuple([z.uuid()]),
  [IPC.settingsMcpOAuthStart]: z.tuple([mcpOAuthRef, z.uuid(), z.enum(SUPPORTED_LOCALES)]),
  [IPC.settingsMcpOAuthCancel]: z.tuple([z.uuid()]),
  [IPC.settingsMcpOAuthSignOut]: z.tuple([mcpOAuthRef]),
  [IPC.settingsMcpRemove]: z.tuple([z.uuid()]),
  [IPC.toolPermissionRespond]: z.tuple([
    runRef,
    z.uuid(),
    z.enum(["once", "session", "global", "deny"]),
  ]),
  [IPC.toolProjectTrustRespond]: z.tuple([runRef, z.uuid(), z.enum(["trust", "skip"])]),
} satisfies Record<IpcChannel, z.ZodType<unknown[]>>;

export function parseIpcArgs<C extends IpcChannel>(
  channel: C,
  args: unknown[],
): z.output<(typeof inputs)[C]> {
  const schema: z.ZodType<unknown[]> = inputs[channel];
  const result = schema.safeParse(args);
  if (!result.success) {
    // Electron forwards handler errors to the renderer, including settings forms containing secrets.
    const field = result.error.issues[0]?.path.join(".");
    throw new Error(`Invalid IPC arguments for ${channel}${field ? ` at ${field}` : ""}`);
  }
  return result.data as z.output<(typeof inputs)[C]>;
}
