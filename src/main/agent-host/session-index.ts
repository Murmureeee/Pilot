// @env node
import { z } from "zod";

import { EXECUTION_APPROVAL_MODES, PLAN_PROPOSAL_MAX_LENGTH } from "../../shared/constants";
import {
  SESSION_RUN_RESULTS,
  type ComposerDraft,
  type SessionMeta,
  type SessionSettings,
} from "../../shared/contract";
import { SESSION_FILE_ID } from "../constants";
import type { NewChatDraft, SessionIndex } from "./types";

const optionalText = z.string().optional();
const executionMode = z.enum(EXECUTION_APPROVAL_MODES);
const sessionSettings = z.object({
  approvalMode: executionMode.optional(),
  planMode: z
    .object({
      executionMode,
      proposal: z
        .object({
          id: z.uuid(),
          markdown: z.string().trim().min(1).max(PLAN_PROPOSAL_MAX_LENGTH),
          workingDirectory: z.string().nullable(),
        })
        .optional(),
    })
    .optional(),
  model: z.object({ providerId: z.string(), modelId: z.string() }).optional(),
}) satisfies z.ZodType<SessionSettings>;

const sessionMeta = z.looseObject({
  ...sessionSettings.shape,
  id: z.string().regex(SESSION_FILE_ID),
  title: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  workingDirectory: optionalText,
  lastTask: z
    .object({ taskId: z.string(), agentRunId: optionalText, title: optionalText })
    .optional(),
  lastRunResult: z.enum(SESSION_RUN_RESULTS).optional().catch(undefined),
  titleCustom: z.boolean().optional(),
  pinned: z.boolean().optional(),
  archived: z.boolean().optional(),
  unread: z.boolean().optional(),
  personaOverride: optionalText,
}) satisfies z.ZodType<SessionMeta>;

const newChatDraft = z.object({
  id: z.uuid(),
  draft: z.custom<ComposerDraft>(Array.isArray),
  settings: sessionSettings,
  workingDirectory: optionalText,
}) satisfies z.ZodType<NewChatDraft>;

export function parseNewChatDrafts(text: string): NewChatDraft[] {
  const raw: unknown = JSON.parse(text);
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((value) => {
    const entry = newChatDraft.safeParse(value);
    return entry.success ? [entry.data] : [];
  });
}

const indexFields = z.looseObject({
  sessions: z.unknown().optional(),
  recentProjects: z.unknown().optional(),
});

export function parseSessionIndex(text: string): { index: SessionIndex; damaged: boolean } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { index: { sessions: [] }, damaged: true };
  }
  const result = indexFields.safeParse(raw);
  if (!result.success) return { index: { sessions: [] }, damaged: true };

  const { sessions, recentProjects, ...otherFields } = result.data;
  let damaged = !Array.isArray(sessions);
  const valid = new Map<string, SessionMeta>();
  for (const candidate of Array.isArray(sessions) ? sessions : []) {
    const entry = sessionMeta.safeParse(candidate);
    if (!entry.success || valid.has(entry.data.id)) {
      damaged = true;
      continue;
    }
    valid.set(entry.data.id, entry.data);
  }

  const projects = Array.isArray(recentProjects)
    ? recentProjects.filter((entry): entry is string => typeof entry === "string")
    : undefined;
  if (recentProjects !== undefined) {
    damaged ||= !Array.isArray(recentProjects) || projects?.length !== recentProjects.length;
  }
  return {
    index: { ...otherFields, sessions: [...valid.values()], recentProjects: projects },
    damaged,
  };
}
