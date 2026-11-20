// @env node
import { z } from "zod";
import {
  LOG_LEVELS,
  SUPPORTED_LOCALES,
  THINKING_LEVELS,
  WORKSPACE_QUERY_LENGTH,
} from "../../shared/constants";
import { IPC } from "../../shared/contract";
import type { IpcChannel } from "./types";

const none = z.tuple([]);
const id = z.string().min(1);
const nonBlank = z.string().refine((value) => value.trim().length > 0);
const mentionId = id.refine((value) => !value.includes("\0"));
const mentionOffset = z.number().int().nonnegative().optional();
const promptInput = z.strictObject({
  text: nonBlank,
  mentions: z.array(
    z.discriminatedUnion("type", [
      z.strictObject({
        type: z.enum(["file", "directory"]),
        id: mentionId,
        label: id,
        offset: mentionOffset,
        meta: z.strictObject({ workingDirectory: nonBlank }),
      }),
      z.strictObject({
        type: z.literal("skill"),
        id: mentionId,
        label: id,
        offset: mentionOffset,
        meta: z.strictObject({ description: z.string() }),
      }),
    ]),
  ),
});
const locale = z.tuple([z.enum(SUPPORTED_LOCALES)]);
const session = z.tuple([z.uuid()]);
const sessionFlag = z.tuple([z.uuid(), z.boolean()]);
const sessionChange = z.tuple([z.uuid(), z.uuid()]);
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
  approvalMode: z.enum(["standard", "read-only", "full-access"]).optional(),
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
  [IPC.agentPrompt]: z.tuple([z.union([nonBlank, promptInput]), nonBlank.optional()]),
  [IPC.agentSearchWorkspace]: z.tuple([z.string().max(WORKSPACE_QUERY_LENGTH)]),
  [IPC.agentPreviewWorkspaceReference]: z.tuple([
    z.strictObject({ path: mentionId, workingDirectory: nonBlank.optional() }),
  ]),
  [IPC.agentAbort]: none,
  [IPC.agentClearQueue]: none,
  [IPC.sessionNew]: none,
  [IPC.sessionLoad]: session,
  [IPC.sessionRename]: z.tuple([z.uuid(), nonBlank]),
  [IPC.sessionDelete]: session,
  [IPC.sessionPin]: sessionFlag,
  [IPC.sessionArchive]: sessionFlag,
  [IPC.sessionUnread]: sessionFlag,
  [IPC.sessionFork]: session,
  [IPC.sessionCopy]: session,
  [IPC.sessionPersona]: z.tuple([z.uuid(), z.string().nullable()]),
  [IPC.sessionFileDiff]: sessionChange,
  [IPC.sessionUndoFileChange]: sessionChange,
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
  [IPC.toolPermissionRespond]: z.tuple([z.uuid(), z.enum(["once", "session", "global", "deny"])]),
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
