// @env node
import { z } from "zod";
import type { SessionMeta } from "@shared/contract";
import { SESSION_FILE_ID } from "../constants";
import type { SessionIndex } from "./types";

const optionalText = z.string().optional();
const sessionMeta = z.looseObject({
  id: z.string().regex(SESSION_FILE_ID),
  title: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
  workingDirectory: optionalText,
  approvalMode: z.enum(["standard", "read-only", "full-access"]).optional(),
  model: z.object({ providerId: z.string(), modelId: z.string() }).optional(),
  lastTask: z
    .object({ taskId: z.string(), agentRunId: optionalText, title: optionalText })
    .optional(),
  titleCustom: z.boolean().optional(),
  pinned: z.boolean().optional(),
  archived: z.boolean().optional(),
  unread: z.boolean().optional(),
  personaOverride: optionalText,
}) satisfies z.ZodType<SessionMeta>;

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
