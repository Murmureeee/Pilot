// @env node
import { z } from "zod";

import { LOG_LEVELS, THINKING_LEVELS } from "../../shared/constants";
import { normalizeModelCatalog } from "./models";
import type { Settings } from "./types";

const optionalText = z.string().optional();
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

const storedSettings = z.looseObject({
  providers: z.array(provider),
  activeProviderId: z.string().default(""),
  toolRules: z
    .array(toolRuleSchema.extend({ commandPrefix: commandPrefix.optional().catch(undefined) }))
    .optional(),
  approvalMode: z.enum(["standard", "read-only", "full-access"]).optional(),
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
  logLevel: z.enum(LOG_LEVELS).optional().catch(undefined),
  persona: optionalText,
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
