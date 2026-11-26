// @env node
import { z } from "zod";

import {
  EXECUTION_APPROVAL_MODES,
  LOG_LEVELS,
  PROMPT_TEMPLATE_LIMIT,
  PROMPT_TEMPLATE_NAME_PATTERN,
  PROMPT_TEMPLATE_TEXT_LIMIT,
  THINKING_LEVELS,
  VERIFICATION_COMMAND_LIMIT,
} from "../../shared/constants";
import { VERIFICATION_KINDS, type ExternalEditor } from "../../shared/contract";
import { WEB_DOMAIN_PATTERN } from "../../shared/web";
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
const domain = z.string().regex(WEB_DOMAIN_PATTERN).optional();
const commandPrefix = z.strictObject({
  shell: z.enum(["powershell", "bash"]),
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
});

const importedPlugin = z.looseObject({
  id: z.string(),
  name: z.string(),
  source: z.enum(["codex", "claude-code"]),
  version: optionalText,
  partial: z.boolean(),
  skillIds: z.array(z.string()),
  serverIds: z.array(z.string()),
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

const storedSettings = z.looseObject({
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
  persona: optionalText,
  promptTemplates: promptTemplatesSchema.optional(),
  afterTurnVerification: z.record(z.string(), afterTurnVerificationSchema).optional(),
  skillsEnabled: z.array(z.string()).optional(),
  mcpServers: z.array(mcpServer).optional(),
  importedPlugins: z.array(importedPlugin).optional(),
  recoveredFrom: optionalText,
  recoveryBlocked: z.never().optional(),
}) satisfies z.ZodType<Settings>;

export function parseSettings(bytes: Buffer): Settings | undefined {
  try {
    const result = storedSettings.safeParse(JSON.parse(bytes.toString("utf8")));
    return result.success ? result.data : undefined;
  } catch {
    return undefined;
  }
}
