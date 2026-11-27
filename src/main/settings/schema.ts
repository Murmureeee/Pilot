// @env node
import { z } from "zod";

import {
  EXECUTION_APPROVAL_MODES,
  LOG_LEVELS,
  HOOK_COMMAND_LIMIT,
  HOOK_PHASES,
  PROMPT_TEMPLATE_LIMIT,
  PROMPT_TEMPLATE_NAME_PATTERN,
  PROMPT_TEMPLATE_TEXT_LIMIT,
  THINKING_LEVELS,
  VERIFICATION_COMMAND_LIMIT,
} from "../../shared/constants";
import { VERIFICATION_KINDS, type ExternalEditor } from "../../shared/contract";
import { isMcpOAuthCallbackUrl } from "../../shared/mcp";
import { WEB_DOMAIN_PATTERN } from "../../shared/web";
import { SETTINGS_FILE_NAME, SETTINGS_FORMAT_VERSION } from "../constants";
import { formatVersion } from "../storage-format";
import { normalizeModelCatalog } from "./models";
import type { Settings } from "./types";

const optionalText = z.string().optional();
const editorCommand = z
  .string()
  .trim()
  .min(1)
  .refine((value) => !/[\0\r\n]/.test(value));
export const externalEditorSchema = z.discriminatedUnion("kind", [
  z.strictObject({ kind: z.enum(["vscode", "cursor"]) }),
  z.strictObject({ kind: z.literal("jetbrains"), command: editorCommand }),
  z.strictObject({
    kind: z.literal("custom"),
    command: editorCommand,
    args: z
      .array(z.string().refine((argument) => !/[\0\r\n]/.test(argument)))
      .refine((args) => args.some((argument) => argument.includes("{file}"))),
  }),
]) satisfies z.ZodType<ExternalEditor>;

export const verificationCommandSchema = z
  .string()
  .trim()
  .min(1)
  .max(VERIFICATION_COMMAND_LIMIT)
  .refine((command) => !command.includes("\0"));
export const afterTurnVerificationSchema = z.strictObject({
  kind: z.enum(VERIFICATION_KINDS),
  command: verificationCommandSchema,
  shell: z.enum(["powershell", "bash"]),
});
export const hookCommandsSchema = z.partialRecord(
  z.enum(HOOK_PHASES),
  z
    .string()
    .trim()
    .min(1)
    .max(HOOK_COMMAND_LIMIT)
    .refine((command) => !command.includes("\0")),
);
const projectHooksSchema = z.strictObject({
  shell: z.enum(["powershell", "bash"]),
  commands: hookCommandsSchema,
});
const domain = z.string().regex(WEB_DOMAIN_PATTERN).optional();
const commandPrefix = z.strictObject({
  shell: z.enum(["powershell", "bash"]),
  wslDistribution: z
    .string()
    .regex(/^[a-z0-9][a-z0-9_.-]*$/i)
    .optional(),
  args: z
    .array(z.string())
    .min(1)
    .refine((args) => Boolean(args[0])),
});
export const toolRuleSchema = z.object({
  toolName: z.string(),
  pathPrefix: optionalText,
  commandPrefix: commandPrefix.optional(),
  domain,
});

const provider = z.looseObject({
  id: z.string().min(1),
  kind: z.enum(["anthropic", "openai-compatible", "openai-responses", "faux"]),
  name: z.string(),
  baseUrl: optionalText,
  modelId: z.string().default(""),
  models: z.unknown().optional().transform(normalizeModelCatalog),
  apiKey: optionalText,
});

export const mcpOAuthClientSchema = z.strictObject({
  clientId: z.string().trim().min(1).max(2048),
  callbackUrl: z.string().trim().max(2048).refine(isMcpOAuthCallbackUrl).optional(),
  scope: z.string().trim().min(1).max(2048).optional(),
});

const mcpServer = z.looseObject({
  id: z.string(),
  name: z.string(),
  enabled: z.boolean(),
  policy: z.enum(["inherit", "confirm"]),
  transport: z.discriminatedUnion("type", [
    z.looseObject({ type: z.literal("stdio"), command: z.string(), args: z.array(z.string()) }),
    z.looseObject({ type: z.literal("http"), url: z.string() }),
  ]),
  encryptedEnv: optionalText,
  encryptedHeaders: optionalText,
  encryptedImport: optionalText,
  importKey: optionalText,
  oauthClient: mcpOAuthClientSchema.optional().catch(undefined),
});

export const promptTemplatesSchema = z
  .array(
    z.strictObject({
      name: z.string().trim().normalize("NFKC").toLowerCase().regex(PROMPT_TEMPLATE_NAME_PATTERN),
      text: z.string().trim().min(1).max(PROMPT_TEMPLATE_TEXT_LIMIT),
    }),
  )
  .max(PROMPT_TEMPLATE_LIMIT)
  .refine((templates) => new Set(templates.map(({ name }) => name)).size === templates.length);

export const pluginLocationSchema = z
  .string()
  .trim()
  .min(1)
  .max(8192)
  .refine((text) => !text.includes("\0"));

export const gitPluginSourceSchema = z.strictObject({
  kind: z.literal("git"),
  location: pluginLocationSchema,
  path: z
    .string()
    .min(1)
    .max(2048)
    .refine((path) =>
      path
        .split("/")
        .every(
          (part) =>
            part.length > 0 &&
            part !== "." &&
            part !== ".." &&
            !/[<>:"\\|?*]/.test(part) &&
            Array.from(part).every((character) => character.charCodeAt(0) >= 32),
        ),
    )
    .optional(),
  ref: z
    .string()
    .max(255)
    .regex(/^[\p{L}\p{N}_][\p{L}\p{N}_./-]*$/u)
    .refine((ref) => !ref.includes("..") && !ref.includes("//"))
    .optional(),
  sha: z
    .string()
    .regex(/^[a-f0-9]{40}$/)
    .optional(),
});

export const pluginPackageSourceSchema = z.discriminatedUnion("kind", [
  gitPluginSourceSchema,
  z.strictObject({ kind: z.enum(["directory", "zip"]), location: pluginLocationSchema }),
]);

const importedPlugin = z.looseObject({
  id: z.string(),
  name: z.string(),
  source: z.enum(["codex", "claude-code", "pi", "skill"]),
  version: optionalText,
  partial: z.boolean(),
  skillIds: z.array(z.string()),
  serverIds: z.array(z.string()),
  managed: z
    .object({
      source: pluginPackageSourceSchema,
      revision: optionalText,
      contentId: z.string().regex(/^[a-f0-9]{24}$/),
      files: z.array(z.object({ path: z.string(), digest: z.string() })),
      templates: promptTemplatesSchema,
      enabled: z.boolean(),
    })
    .optional(),
});

const storedSettings = z.looseObject({
  formatVersion: z.number().optional(),
  providers: z.array(provider),
  activeProviderId: z.string().default(""),
  auxiliaryModel: z
    .object({ providerId: z.string().min(1), modelId: z.string().min(1) })
    .optional()
    .catch(undefined),
  toolRules: z
    .array(
      toolRuleSchema.extend({
        commandPrefix: commandPrefix.optional().catch(undefined),
        domain: domain.catch(undefined),
      }),
    )
    .optional(),
  approvalMode: z.enum(EXECUTION_APPROVAL_MODES).optional(),
  thinkingLevel: z.enum(THINKING_LEVELS).optional().catch(undefined),
  thinkingLevels: z
    .unknown()
    .optional()
    .transform((value) =>
      Array.isArray(value) ? THINKING_LEVELS.filter((level) => value.includes(level)) : undefined,
    ),
  workingDirectory: z
    .string()
    .nullish()
    .transform((value) => value ?? undefined),
  commandShell: z.enum(["powershell", "bash"]).optional().catch(undefined),
  externalEditor: externalEditorSchema.optional().catch(undefined),
  logLevel: z.enum(LOG_LEVELS).optional().catch(undefined),
  notificationsEnabled: z.boolean().optional().catch(undefined),
  closeToTray: z.boolean().optional().catch(undefined),
  globalComposerShortcut: z.boolean().optional().catch(undefined),
  autoDownloadUpdates: z.boolean().optional().catch(undefined),
  persona: optionalText,
  projectHooks: z.record(z.string().min(1), projectHooksSchema).optional(),
  promptTemplates: promptTemplatesSchema.optional(),
  afterTurnVerification: z.record(z.string(), afterTurnVerificationSchema.nullable()).optional(),
  projectTrust: z
    .record(
      z.string(),
      z.strictObject({ fingerprint: z.string().regex(/^[0-9a-f]{64}$/), trustedAt: z.number() }),
    )
    .optional()
    .catch(undefined),
  skillsEnabled: z.array(z.string()).optional(),
  mcpServers: z.array(mcpServer).optional(),
  mcpOAuth: z
    .record(
      z.string(),
      z.strictObject({
        binding: z.hash("sha256"),
        encryptedState: z.string().min(1),
        project: optionalText,
      }),
    )
    .optional()
    .catch(undefined),
  importedPlugins: z.array(importedPlugin).optional(),
  pluginMarketplaces: z
    .array(
      z.object({
        location: pluginLocationSchema,
        name: z.string().min(1).max(200),
      }),
    )
    .optional(),
  recoveredFrom: optionalText,
  recoveryBlocked: z.never().optional(),
  upgradeRequired: z.never().optional(),
}) satisfies z.ZodType<Settings>;

export function parseSettings(bytes: Buffer, path = SETTINGS_FILE_NAME): Settings | undefined {
  let raw: unknown;
  try {
    raw = JSON.parse(bytes.toString("utf8"));
  } catch {
    return undefined;
  }
  if (formatVersion(raw, SETTINGS_FORMAT_VERSION, path) === undefined) return;
  const result = storedSettings.safeParse(raw);
  if (result.success) {
    const { formatVersion: _formatVersion, ...settings } = result.data;
    return settings;
  }
}
