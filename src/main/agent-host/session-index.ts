// @env node
import { z } from "zod";

import { EXECUTION_APPROVAL_MODES, PLAN_PROPOSAL_MAX_LENGTH } from "../../shared/constants";
import {
  SESSION_RUN_RESULTS,
  type ComposerDraft,
  type ManagedWorktree,
  type SessionMeta,
  type SessionSettings,
} from "../../shared/contract";
import { SESSION_FILE_ID, SESSION_FORMAT_VERSION } from "../constants";
import { formatVersion, parseStoredJson } from "../storage-format";
import { GIT_OBJECT_ID } from "../workspace/constants";
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
  titleGenerated: z.literal(true).optional().catch(undefined),
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

export function parseNewChatDrafts(raw: unknown): NewChatDraft[] {
  if (!Array.isArray(raw)) return [];
  return raw.flatMap((value) => {
    const entry = newChatDraft.safeParse(value);
    return entry.success ? [entry.data] : [];
  });
}

const indexFields = z.looseObject({
  formatVersion: z.number().optional(),
  sessions: z.unknown().optional(),
  recentProjects: z.unknown().optional(),
  worktrees: z.unknown().optional(),
});

const worktreeRecord = z.object({
  id: z.uuid(),
  projectDirectory: z.string().min(1),
  directory: z.string().min(1),
  branch: z.string().min(1),
  baseBranch: z.string().min(1),
  baseCommit: z.string().regex(GIT_OBJECT_ID),
  removed: z.literal(true).optional(),
}) satisfies z.ZodType<ManagedWorktree>;

export function parseSessionIndex(
  text: string,
  path: string,
): { index: SessionIndex; damaged: boolean } {
  const raw = parseStoredJson(text);
  if (formatVersion(raw, SESSION_FORMAT_VERSION, path) === undefined)
    return { index: { sessions: [] }, damaged: true };
  const result = indexFields.safeParse(raw);
  if (!result.success) return { index: { sessions: [] }, damaged: true };

  const {
    formatVersion: _formatVersion,
    sessions,
    recentProjects,
    worktrees,
    ...otherFields
  } = result.data;
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
  const records = new Map<string, ManagedWorktree>();
  if (worktrees !== undefined) {
    damaged ||= !Array.isArray(worktrees);
    for (const record of Array.isArray(worktrees) ? worktrees : []) {
      const parsed = worktreeRecord.safeParse(record);
      if (!parsed.success || records.has(parsed.data.id)) damaged = true;
      else records.set(parsed.data.id, parsed.data);
    }
  }
  return {
    index: {
      ...otherFields,
      sessions: [...valid.values()],
      recentProjects: projects,
      ...(worktrees !== undefined && { worktrees: [...records.values()] }),
    },
    damaged,
  };
}
