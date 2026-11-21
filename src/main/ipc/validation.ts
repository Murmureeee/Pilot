// @env node
import { z } from "zod";
import {
  LOG_LEVELS,
  SUPPORTED_LOCALES,
  THINKING_LEVELS,
  WORKSPACE_QUERY_LENGTH,
} from "../../shared/constants";
import { IPC, VERIFICATION_KINDS } from "../../shared/contract";
import type { IpcChannel } from "./types";

const none = z.tuple([]);
const id = z.string().min(1);
const nonBlank = z.string().refine((value) => value.trim().length > 0);
const mentionId = id.refine((value) => !value.includes("\0"));
const mentionOffset = z.number().int().nonnegative().optional();
const fileMention = z.strictObject({
  type: z.enum(["file", "directory"]),
  id: mentionId,
  label: id,
  meta: z.strictObject({ workingDirectory: nonBlank }),
});
const skillMention = z.strictObject({
  type: z.literal("skill"),
  id: mentionId,
  label: id,
  meta: z.strictObject({ description: z.string() }),
});
const composerDraft = z.array(
  z.union([z.string(), z.discriminatedUnion("type", [fileMention, skillMention])]),
);
const promptInput = z.strictObject({
  text: nonBlank,
  mentions: z.array(
    z.discriminatedUnion("type", [
      fileMention.extend({ offset: mentionOffset }),
      skillMention.extend({ offset: mentionOffset }),
    ]),
  ),
});
const locale = z.tuple([z.enum(SUPPORTED_LOCALES)]);
const session = z.tuple([z.uuid()]);
const runRef = z.strictObject({ sessionId: z.uuid(), runId: z.uuid() });
const sessionFlag = z.tuple([z.uuid(), z.boolean()]);
const sessionChange = z.tuple([z.uuid(), z.uuid()]);
const gitDiffRequest = z.strictObject({
  path: mentionId,
  area: z.enum(["staged", "unstaged", "untracked"]),
});
const gitRollbackSelection = z.strictObject({
  checkpointId: z.uuid(),
  path: mentionId,
  revision: z.uuid(),
  hunks: z.array(z.number().int().nonnegative()).min(1).max(700).optional(),
});
const approvalMode = z.enum(["standard", "read-only", "full-access"]);
const provider = z.strictObject({
  id,
  kind: z.enum(["anthropic", "openai-compatible", "openai-responses", "faux"]),
  name: z.string(),
  baseUrl: z.string().optional(),
  modelId: z.string(),
  models: z
    .array(
      z.strictObject({
        id: nonBlank,
        name: z.string(),
        contextWindow: z.number().positive().optional(),
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
});
const settings = z.strictObject({
  providers: z.array(provider),
  activeProviderId: z.string(),
  approvalMode: approvalMode.optional(),
  thinkingLevel: z.enum(THINKING_LEVELS).optional(),
  thinkingLevels: z.array(z.enum(THINKING_LEVELS)).min(1).optional(),
  workingDirectory: z.string().nullable().optional(),
  commandShell: z.enum(["powershell", "bash"]).optional(),
  toolRules: z
    .array(z.strictObject({ toolName: id, pathPrefix: z.string().optional() }))
    .optional(),
  persona: z.string().optional(),
  skillsEnabled: z.array(id).optional(),
});

const importKind = z.enum(["skill", "plugin", "mcp"]);
const importId = z.string().regex(/^[a-f0-9]{24}$/);

const inputs = {
  [IPC.ping]: z.tuple([z.strictObject({ payload: z.string() })]),
  [IPC.runAgentSmoke]: none,
  [IPC.appInfo]: none,
  [IPC.appOpenPath]: z.tuple([z.enum(["settings", "sessions", "skills", "logs"])]),
  [IPC.appSetTitlebarTheme]: z.tuple([z.enum(["light", "dark", "system"])]),
  [IPC.appGetUpdateStatus]: none,
  [IPC.appCheckForUpdates]: none,
  [IPC.appInstallUpdate]: none,
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
  [IPC.agentPreviewWorkspaceReference]: z.tuple([
    z.strictObject({ path: mentionId, workingDirectory: nonBlank.optional() }),
  ]),
  [IPC.agentAbort]: z.tuple([runRef]),
  [IPC.agentResume]: z.tuple([runRef]),
  [IPC.agentClearQueue]: z.tuple([runRef]),
  [IPC.sessionNew]: none,
  [IPC.sessionSaveDraft]: z.tuple([z.uuid(), composerDraft]),
  [IPC.sessionUpdateSettings]: z.tuple([
    z.uuid(),
    z.strictObject({
      model: z.strictObject({ providerId: nonBlank, modelId: nonBlank }).nullable().optional(),
      approvalMode: approvalMode.nullable().optional(),
    }),
  ]),
  [IPC.sessionSelectProject]: z.tuple([z.enum(SUPPORTED_LOCALES), z.uuid().optional()]),
  [IPC.sessionUseRecentProject]: z.tuple([nonBlank, z.uuid().optional()]),
  [IPC.sessionGitHead]: z.tuple([nonBlank]),
  [IPC.sessionGitChanges]: session,
  [IPC.sessionGitDiff]: z.tuple([z.uuid(), gitDiffRequest]),
  [IPC.sessionGitCheckpointDiff]: z.tuple([z.uuid(), z.uuid(), mentionId]),
  [IPC.sessionPreviewGitRollback]: z.tuple([z.uuid(), gitRollbackSelection]),
  [IPC.sessionApplyGitRollback]: sessionChange,
  [IPC.sessionOpenGitLine]: z.tuple([z.uuid(), gitDiffRequest, z.number().int().positive()]),
  [IPC.sessionLoad]: z.tuple([z.uuid(), z.boolean().optional()]),
  [IPC.sessionRename]: z.tuple([z.uuid(), nonBlank]),
  [IPC.sessionDelete]: session,
  [IPC.sessionPin]: sessionFlag,
  [IPC.sessionArchive]: sessionFlag,
  [IPC.sessionUnread]: sessionFlag,
  [IPC.sessionFork]: session,
  [IPC.sessionCopy]: session,
  [IPC.sessionPersona]: z.tuple([z.uuid(), z.string().nullable()]),
  [IPC.sessionInstructionSources]: session,
  [IPC.sessionFileDiff]: sessionChange,
  [IPC.sessionUndoFileChange]: sessionChange,
  [IPC.sessionVerification]: session,
  [IPC.sessionVerificationRun]: sessionChange,
  [IPC.sessionStartVerification]: z.tuple([
    z.uuid(),
    z.strictObject({
      workingDirectory: mentionId,
      kind: z.enum(VERIFICATION_KINDS),
      command: z
        .string()
        .trim()
        .min(1)
        .max(4096)
        .refine((command) => !command.includes("\0")),
    }),
  ]),
  [IPC.sessionStopVerification]: sessionChange,
  [IPC.sessionRerunVerification]: sessionChange,
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
  [IPC.skillsList]: none,
  [IPC.skillsImport]: locale,
  [IPC.skillsToggle]: z.tuple([id, z.boolean()]),
  [IPC.settingsGet]: none,
  [IPC.settingsSave]: z.tuple([settings]),
  [IPC.settingsSetLogLevel]: z.tuple([z.enum(LOG_LEVELS)]),
  [IPC.settingsSelectModel]: z.tuple([id, nonBlank]),
  [IPC.settingsSetThinkingLevel]: z.tuple([z.enum(THINKING_LEVELS)]),
  [IPC.settingsMcpList]: none,
  [IPC.settingsMcpSave]: z.tuple([mcpServer]),
  [IPC.settingsMcpReconnect]: z.tuple([z.uuid()]),
  [IPC.settingsMcpRemove]: z.tuple([z.uuid()]),
  [IPC.toolPermissionRespond]: z.tuple([
    runRef,
    z.uuid(),
    z.enum(["once", "session", "global", "deny"]),
  ]),
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
