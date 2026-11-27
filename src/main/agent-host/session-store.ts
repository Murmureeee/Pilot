// @env node
// 会话持久化：每个会话一个 JSONL 文件，另存 index.json 元数据索引。
import { randomUUID } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import type { AgentMessage } from "@earendil-works/pi-agent-core";
import type { ToolResultMessage } from "@earendil-works/pi-ai";

import type {
  ComposerDraft,
  ImageAttachment,
  Locale,
  ManagedWorktree,
  SessionMeta,
  SessionRunResult,
  SessionSearchResults,
  SessionSettings,
  StorageUpgrade,
  UiMessage,
  UiPart,
} from "@shared/contract";

import { RUN_SUBTASK_TOOL_NAME } from "../../shared/constants";
import { visibleMessageText } from "../../shared/mentions";
import { insertCompactionMarker } from "../../shared/message-events";
import { applyPlanUpdate } from "../../shared/plan";
import { findTranscript, transcriptSegments } from "../../shared/transcript-search";
import { isWebTool, webSources } from "../../shared/web";
import {
  NEW_CHAT_DRAFTS_FILE,
  SESSION_DRAFT_EXTENSION,
  SESSION_DRAFT_IMAGES_EXTENSION,
  SESSION_FILE_ID,
  SESSION_FORMAT_VERSION,
  SESSION_INDEX_SAVE_BLOCKED,
  SESSION_TRANSCRIPT_EXTENSION,
} from "../constants";
import { backupCorruptFile } from "../corrupt-file";
import { toolRuleSchema } from "../settings/schema";
import {
  formatVersion,
  NewerFormatError,
  parseStoredJson,
  readStoredText,
  writeStorageAtomic,
} from "../storage-format";
import { readFileChange } from "../workspace/file-changes";
import { gitDiffReferenceSchema } from "../workspace/reference";
import { CONVERSATION_INDEX_CACHE_SIZE, CONVERSATION_SEARCH_LIMIT } from "./constants";
import { imageAttachmentsSchema, messageImages } from "./image-attachments";
import { legacyMentionParts } from "./mentions";
import { completeToolResults } from "./recovery";
import {
  headerVersion,
  sessionEntries,
  transcriptHeader,
  transcriptPrefix,
} from "./session-format";
import { parseNewChatDrafts, parseSessionIndex } from "./session-index";
import { readSubtaskTrace } from "./subtask-record";
import { labelOf } from "./tools";
import { PLAN_TOOL_NAME, PROPOSE_MEMORY_TOOL_NAME } from "./tools/constants";
import { readMemoryProposal } from "./tools/memory";
import { readPlanSteps } from "./tools/plan";
import { transcriptFilename, transcriptMarkdown } from "./transcript-markdown";
import type {
  ApprovedToolResult,
  CheckpointAppend,
  MessageHistory,
  MessageRollbackJournal,
  NewChatDraft,
  ReferencedUserMessage,
  RunCheckpoint,
  SavedCompaction,
  SavedGitChanges,
  SavedMessageTask,
  SessionIndex,
  SessionRecord,
  SessionRunSettlement,
  TimedAssistantMessage,
  TranscriptWriteState,
} from "./types";

export function messageText(message: AgentMessage): string {
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((block) =>
        block && typeof block === "object" && "text" in block
          ? String((block as { text: unknown }).text)
          : "",
      )
      .join("");
  }
  return "";
}

export function messageParts(message: AgentMessage, getToolLabel = labelOf): UiPart[] {
  if (message.role === "user") {
    const user = message as ReferencedUserMessage;
    const parts = user.pilotReference?.parts;
    const images = messageImages(user);
    if (
      Array.isArray(parts) &&
      parts.length &&
      parts.every((part) =>
        part?.type === "text"
          ? typeof part.text === "string"
          : part?.type === "mention" &&
            (part.kind === "directory" || part.kind === "file" || part.kind === "skill") &&
            typeof part.label === "string" &&
            typeof part.id === "string" &&
            (part.workingDirectory === undefined || typeof part.workingDirectory === "string") &&
            (part.diff === undefined ||
              (part.kind === "file" && gitDiffReferenceSchema.safeParse(part.diff).success)),
      )
    ) {
      return images.length ? [...parts, ...images] : parts;
    }
    const text = messageText(message);
    return [...(legacyMentionParts(text) ?? [{ type: "text" as const, text }]), ...images];
  }
  const content = (message as { content?: unknown }).content;
  if (typeof content === "string") return [{ type: "text", text: content }];
  if (!Array.isArray(content)) return [];
  const timings =
    message.role === "assistant"
      ? (message as TimedAssistantMessage).pilotThinkingDurations
      : undefined;
  const parts: UiPart[] = [];
  for (const [blockIndex, block] of content.entries()) {
    if (!block || typeof block !== "object") continue;
    if (block.type === "text" && typeof block.text === "string") {
      parts.push({ type: "text", text: block.text });
    } else if (block.type === "thinking" && typeof block.thinking === "string") {
      const durationMs = timings?.[blockIndex];
      parts.push({
        type: "thinking",
        text: block.thinking,
        blockIndex,
        ...(typeof durationMs === "number" && durationMs >= 0 ? { durationMs } : {}),
      });
    } else if (
      message.role === "assistant" &&
      block.type === "toolCall" &&
      typeof block.id === "string" &&
      typeof block.name === "string" &&
      block.name !== PLAN_TOOL_NAME
    ) {
      parts.push({
        type: "tool",
        callId: block.id,
        toolName: block.name,
        label: getToolLabel(block.name),
        inputSummary: JSON.stringify(block.arguments) ?? "{}",
        state: "pending",
      });
    }
  }
  return parts;
}

export function toUiMessages(
  messages: AgentMessage[],
  prefix: string,
  getToolLabel = labelOf,
  compactions: readonly SavedCompaction[] = [],
): UiMessage[] {
  let uiMessages: UiMessage[] = [];
  const calls = new Map<string, Extract<UiPart, { type: "tool" }>>();
  for (const message of messages) {
    if (message.role === "user" || message.role === "assistant") {
      const parts = messageParts(message, getToolLabel);
      const timing =
        message.role === "assistant" ? (message as TimedAssistantMessage).pilotTiming : undefined;
      const validTiming =
        timing &&
        typeof timing.runId === "string" &&
        Number.isFinite(timing.startedAt) &&
        Number.isFinite(timing.endedAt) &&
        timing.endedAt >= timing.startedAt;
      uiMessages.push({
        id: prefix + "-" + uiMessages.length,
        role: message.role,
        parts,
        ...(validTiming && {
          timing: { runId: timing.runId, startedAt: timing.startedAt, endedAt: timing.endedAt },
        }),
      });
      for (const part of parts) {
        if (part.type === "tool") calls.set(part.callId, part);
      }
    } else if (message.role === "toolResult") {
      if (message.toolName === PLAN_TOOL_NAME) {
        const steps = message.isError ? undefined : readPlanSteps(message.details);
        if (steps) uiMessages = applyPlanUpdate(uiMessages, steps);
        continue;
      }
      const part = calls.get(message.toolCallId);
      if (!part) continue;
      calls.delete(message.toolCallId);
      const { details } = message;
      if (
        details &&
        typeof details === "object" &&
        "toolLabel" in details &&
        typeof details.toolLabel === "string"
      ) {
        part.label = details.toolLabel;
      }
      const output = messageText(message);
      part.output = output;
      part.state = message.isError ? "error" : "success";
      part.error = message.isError ? output || "工具执行失败" : undefined;
      if (!message.isError && isWebTool(message.toolName)) part.sources = webSources(details);
      if (!message.isError && message.toolName === PROPOSE_MEMORY_TOOL_NAME)
        part.memory = readMemoryProposal(details);
      if (message.toolName === RUN_SUBTASK_TOOL_NAME) part.subtask = readSubtaskTrace(details);
      if (typeof message.durationMs === "number") part.durationMs = message.durationMs;
      const { pilotApproval } = message as ApprovedToolResult;
      if (pilotApproval && ["once", "deny", "session", "global"].includes(pilotApproval.decision)) {
        const rule = toolRuleSchema.safeParse(pilotApproval.rule);
        part.approval = {
          decision: pilotApproval.decision,
          ...(rule.success && { rule: rule.data }),
        };
      }
      const change = readFileChange(message.toolName, details);
      if (change) part.fileChange = change.summary;
    }
  }
  for (const part of calls.values()) {
    part.state = "error";
    part.error = "工具未执行。";
  }
  return compactions.reduce(insertCompactionMarker, uiMessages);
}

export class SessionStore {
  private indexBackupPending = false;
  private index: SessionIndex = { sessions: [] };
  private indexUpgrade?: NewerFormatError;
  private draftsUpgrade?: NewerFormatError;
  private newChatDrafts: NewChatDraft[];
  private readonly checkpoints = new Map<string, RunCheckpoint | null>();
  private readonly gitChanges = new Map<string, SavedGitChanges | null>();
  private readonly contextCompactions = new Map<string, SavedCompaction[]>();
  private readonly messageHistories = new Map<string, MessageHistory>();
  private readonly transcriptWrites = new Map<string, TranscriptWriteState>();
  private readonly transcriptIndex = new Map<string, ReturnType<typeof transcriptSegments>>();

  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
    this.index = this.readIndex();
    this.newChatDrafts = this.readNewChatDrafts();
  }

  private readIndex(): SessionIndex {
    const path = this.indexPath();
    let text: string | undefined;
    try {
      text = readStoredText(path);
    } catch {
      this.indexBackupPending = true;
    }
    let parsed: ReturnType<typeof parseSessionIndex>;
    try {
      parsed =
        text === undefined
          ? { index: { sessions: [] }, damaged: false }
          : parseSessionIndex(text, path);
    } catch (error) {
      if (!(error instanceof NewerFormatError)) throw error;
      this.indexUpgrade = error;
      return { sessions: [] };
    }
    const { index, damaged } = parsed;
    for (const meta of index.sessions) {
      if (
        meta.lastRunResult === "interrupted" ||
        (meta.lastRunResult === undefined && this.hasCheckpointHeader(meta.id))
      ) {
        try {
          meta.lastRunResult = checkpointResult(this.checkpoint(meta.id));
        } catch {
          // Keep the index available when one transcript cannot be read.
        }
      }
    }
    if (text !== undefined && !damaged) return index;
    this.indexBackupPending ||= damaged;
    const rebuilt = this.rebuildIndex(index);
    if (this.indexBackupPending || rebuilt.sessions.length) {
      try {
        this.writeIndex(rebuilt);
      } catch {
        // 仍可查看重建出的会话，恢复文件访问后再保存索引。
        console.error("[session] 重建的会话索引暂时无法保存。");
      }
    }
    return rebuilt;
  }

  private rebuildIndex(index: SessionIndex): SessionIndex {
    const sessions = new Map(index.sessions.map((entry) => [entry.id, entry]));
    const ids = new Set<string>();
    for (const entry of readdirSync(this.dir, { withFileTypes: true })) {
      if (!entry.isFile()) continue;
      const extension = [SESSION_TRANSCRIPT_EXTENSION, SESSION_DRAFT_EXTENSION].find((suffix) =>
        entry.name.endsWith(suffix),
      );
      if (!extension) continue;
      const id = entry.name.slice(0, -extension.length);
      if (SESSION_FILE_ID.test(id) && !sessions.has(id)) ids.add(id);
    }
    for (const id of ids) {
      const file =
        statSync(this.filePath(id), { throwIfNoEntry: false }) ??
        statSync(this.draftPath(id), { throwIfNoEntry: false });
      if (!file) continue;
      let record: SessionRecord | undefined;
      try {
        record = this.read(id);
      } catch (error) {
        if (!(error instanceof NewerFormatError)) console.warn("[session] 暂时无法读取聊天记录。");
      }
      const { messages = [], checkpoint, gitChanges } = record ?? {};
      const started = (messages[0] ?? checkpoint?.pending?.[0])?.timestamp;
      const workingDirectory = checkpoint?.workingDirectory ?? gitChanges?.workingDirectory;
      sessions.set(id, {
        id,
        title: sessionTitle(messages, checkpoint),
        createdAt: Math.round(
          typeof started === "number" && Number.isFinite(started) ? started : file.birthtimeMs,
        ),
        updatedAt: Math.round(file.mtimeMs),
        workingDirectory: typeof workingDirectory === "string" ? workingDirectory : undefined,
        lastRunResult: checkpointResult(checkpoint),
      });
    }
    return { ...index, sessions: [...sessions.values()] };
  }

  private backUpIndexIfNeeded(): void {
    if (!this.indexBackupPending) return;
    try {
      const backup = backupCorruptFile(this.indexPath());
      console.warn(`[session] 已为重建会话索引保留原文件: ${backup}`);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw new Error(SESSION_INDEX_SAVE_BLOCKED, { cause: error });
      }
    }
    this.indexBackupPending = false;
  }

  private writeIndex(index = this.index): void {
    const path = this.indexPath();
    this.checkIndexFormat();
    this.backUpIndexIfNeeded();
    writeStorageAtomic(
      path,
      JSON.stringify({ ...index, formatVersion: SESSION_FORMAT_VERSION }, null, 2),
    );
    this.index = index;
  }

  private checkIndexFormat(): void {
    if (this.indexUpgrade) throw this.indexUpgrade;
    const path = this.indexPath();
    formatVersion(parseStoredJson(readStoredText(path)), SESSION_FORMAT_VERSION, path);
  }

  storageUpgrade(): StorageUpgrade | undefined {
    const problem = this.indexUpgrade ?? this.draftsUpgrade;
    if (problem) return { path: problem.path, version: problem.version };
  }

  assertSessionFormat(id: string): void {
    if (this.indexUpgrade) throw this.indexUpgrade;
    const path = this.filePath(id);
    headerVersion(transcriptPrefix(path), path);
    this.readDraftEntries(this.draftPath(id));
    this.readDraftEntries(this.draftImagesPath(id));
  }

  private indexPath(): string {
    return join(this.dir, "index.json");
  }

  private filePath(id: string): string {
    return join(this.dir, `${id}${SESSION_TRANSCRIPT_EXTENSION}`);
  }

  private hasCheckpointHeader(id: string): boolean {
    // Older settled failures have no result in the index.
    try {
      const path = this.filePath(id);
      const prefix = transcriptPrefix(path);
      const offset = headerVersion(prefix, path) ? prefix.indexOf("\n") + 1 : 0;
      return /^\{"type":"pilot_(run_checkpoint|checkpoint_append)"/.test(prefix.slice(offset));
    } catch {
      return false;
    }
  }

  private draftPath(id: string): string {
    return join(this.dir, `${id}${SESSION_DRAFT_EXTENSION}`);
  }

  private draftImagesPath(id: string): string {
    return join(this.dir, id + SESSION_DRAFT_IMAGES_EXTENSION);
  }

  private readNewChatDrafts(): NewChatDraft[] {
    if (this.indexUpgrade) return [];
    try {
      return parseNewChatDrafts(this.readDraftEntries(join(this.dir, NEW_CHAT_DRAFTS_FILE)));
    } catch (error) {
      if (error instanceof NewerFormatError) this.draftsUpgrade = error;
      return [];
    }
  }

  newChatDraft(directory?: string | null): NewChatDraft | undefined {
    return this.newChatDrafts.findLast(
      (draft) =>
        !this.getMeta(draft.id) &&
        !this.worktreeAt(draft.workingDirectory)?.removed &&
        (directory === undefined || (draft.workingDirectory ?? null) === directory),
    );
  }

  saveNewChatDraft(draft: NewChatDraft): void {
    this.writeNewChatDrafts([...this.newChatDrafts.filter(({ id }) => id !== draft.id), draft]);
  }

  private writeNewChatDrafts(drafts: NewChatDraft[]): void {
    this.checkDraftCollection();
    writeSessionEntries(join(this.dir, NEW_CHAT_DRAFTS_FILE), drafts);
    this.newChatDrafts = drafts;
  }

  private checkDraftCollection(): void {
    if (this.indexUpgrade) throw this.indexUpgrade;
    if (this.draftsUpgrade) throw this.draftsUpgrade;
    this.readDraftEntries(join(this.dir, NEW_CHAT_DRAFTS_FILE));
  }

  private readDraftEntries(path: string): unknown {
    return sessionEntries(parseStoredJson(readStoredText(path)), path);
  }

  private removeNewChatDraft(id: string): void {
    const drafts = this.newChatDrafts.filter((draft) => draft.id !== id);
    if (drafts.length !== this.newChatDrafts.length) this.writeNewChatDrafts(drafts);
  }

  loadDraft(id: string): ComposerDraft {
    try {
      const path = this.draftPath(id);
      const text = readStoredText(path);
      if (text !== undefined) {
        const draft = sessionEntries(JSON.parse(text), path);
        return Array.isArray(draft) ? (draft as ComposerDraft) : [];
      }
    } catch (error) {
      if (error instanceof NewerFormatError) throw error;
    }
    return this.newChatDrafts.find((draft) => draft.id === id)?.draft ?? [];
  }

  saveDraft(id: string, draft: ComposerDraft): void {
    const path = this.draftPath(id);
    if (this.indexUpgrade) throw this.indexUpgrade;
    this.readDraftEntries(path);
    if (this.newChatDrafts.some((entry) => entry.id === id)) this.checkDraftCollection();
    if (draft.length) writeSessionEntries(path, draft);
    else rmSync(path, { force: true });
    this.removeNewChatDraft(id);
  }

  loadDraftImages(id: string): ImageAttachment[] {
    try {
      const stored = this.readDraftEntries(this.draftImagesPath(id));
      return imageAttachmentsSchema.safeParse(stored).data ?? [];
    } catch (error) {
      if (error instanceof NewerFormatError) throw error;
      return [];
    }
  }

  saveDraftImages(id: string, images: ImageAttachment[]): void {
    const path = this.draftImagesPath(id);
    if (this.indexUpgrade) throw this.indexUpgrade;
    this.readDraftEntries(path);
    if (images.length) writeSessionEntries(path, images);
    else rmSync(path, { force: true });
  }

  clearDraft(id: string): void {
    this.readDraftEntries(this.draftImagesPath(id));
    this.saveDraft(id, []);
    this.saveDraftImages(id, []);
  }

  list(): SessionMeta[] {
    return this.index.sessions
      .map((meta) => {
        if (meta.lastRunResult !== "interrupted" || !this.checkpoints.has(meta.id)) return meta;
        const result = checkpointResult(this.checkpoints.get(meta.id) ?? undefined);
        return result === meta.lastRunResult ? meta : { ...meta, lastRunResult: result };
      })
      .map((meta) => {
        const worktree = this.worktreeAt(meta.workingDirectory);
        return worktree ? { ...meta, worktree } : meta;
      })
      .sort((a, b) => b.updatedAt - a.updatedAt);
  }

  worktreeAt(directory: string | undefined): ManagedWorktree | undefined {
    return directory !== undefined
      ? this.index.worktrees?.find((worktree) => relative(worktree.directory, directory) === "")
      : undefined;
  }

  projectWorktrees(directory: string): ManagedWorktree[] {
    return (this.index.worktrees ?? []).filter(
      (worktree) => relative(worktree.projectDirectory, directory) === "",
    );
  }

  saveWorktree(worktree: ManagedWorktree): void {
    const worktrees = (this.index.worktrees ?? []).filter(({ id }) => id !== worktree.id);
    this.writeIndex({
      ...this.index,
      worktrees: [...worktrees, worktree],
      recentProjects: this.projectOpened(worktree.projectDirectory),
    });
  }

  forgetWorktree(id: string): void {
    this.writeIndex({
      ...this.index,
      worktrees: this.index.worktrees?.filter((record) => record.id !== id),
    });
  }

  listRecentProjects(sessions = this.list()): string[] {
    // The saved list is authoritative once the user can remove entries.
    return this.index.recentProjects === undefined
      ? [
          ...new Set(
            sessions.flatMap(({ workingDirectory, worktree }) =>
              workingDirectory ? [worktree?.projectDirectory ?? workingDirectory] : [],
            ),
          ),
        ]
      : [...new Set(this.index.recentProjects)];
  }

  hasProject(workingDirectory: string): boolean {
    return (
      this.index.recentProjects?.includes(workingDirectory) === true ||
      this.index.sessions.some(
        (session) => this.projectOf(session.workingDirectory) === workingDirectory,
      )
    );
  }

  removeRecentProject(workingDirectory: string): void {
    const projects = this.listRecentProjects();
    if (projects.includes(workingDirectory)) {
      this.writeIndex({
        ...this.index,
        recentProjects: projects.filter((directory) => directory !== workingDirectory),
      });
    }
  }

  private projectOpened(workingDirectory: string): string[] {
    return [
      workingDirectory,
      ...this.listRecentProjects().filter((directory) => directory !== workingDirectory),
    ];
  }

  rememberProject(workingDirectory: string): void {
    const project = this.projectOf(workingDirectory) ?? workingDirectory;
    if (this.index.recentProjects?.[0] === project) return;
    this.writeIndex({ ...this.index, recentProjects: this.projectOpened(project) });
  }

  private projectOf(directory: string | undefined): string | undefined {
    return this.worktreeAt(directory)?.projectDirectory ?? directory;
  }

  /** 单个会话元数据（host 组装 systemPrompt 时读会话级人设覆盖） */
  getMeta(id: string): SessionMeta | null {
    return this.index.sessions.find((s) => s.id === id) ?? null;
  }

  setRunResult(id: string, lastRunResult: SessionRunResult): void {
    const meta = this.getMeta(id);
    if (!meta || meta.lastRunResult === lastRunResult) return;
    this.writeIndex({
      ...this.index,
      sessions: this.index.sessions.map((session) =>
        session.id === id ? { ...session, lastRunResult } : session,
      ),
    });
  }

  /** 会话级人设/指令覆盖（null 或空白 = 清除，回落全局 persona） */
  setPersonaOverride(id: string, persona: string | null): SessionMeta | null {
    return this.updateMeta(id, { personaOverride: persona?.trim() || undefined });
  }

  create(
    workingDirectory?: string,
    id: string = randomUUID(),
    settings?: SessionSettings,
  ): SessionMeta {
    this.assertSessionFormat(id);
    if (!this.getMeta(id)) this.checkDraftCollection();
    const meta: SessionMeta = {
      ...settings,
      id,
      title: "新会话",
      createdAt: Date.now(),
      updatedAt: Date.now(),
      workingDirectory,
    };
    this.writeIndex({
      ...this.index,
      sessions: [...this.index.sessions, meta],
      recentProjects: workingDirectory
        ? this.projectOpened(this.projectOf(workingDirectory) ?? workingDirectory)
        : this.index.recentProjects,
    });
    return meta;
  }

  updateSettings(id: string, changes: SessionSettings): void {
    this.writeIndex({
      ...this.index,
      sessions: this.index.sessions.map((meta) =>
        meta.id === id ? { ...meta, ...changes } : meta,
      ),
    });
  }

  bindProject(id: string, workingDirectory: string): void {
    const meta = this.getMeta(id);
    if (!meta) throw new Error("找不到该会话。");
    if (meta.workingDirectory) throw new Error("该会话已关联项目。");
    this.writeIndex({
      ...this.index,
      sessions: this.index.sessions.map((session) =>
        session.id === id ? { ...session, workingDirectory } : session,
      ),
      recentProjects: this.projectOpened(this.projectOf(workingDirectory) ?? workingDirectory),
    });
  }

  /** 手动重命名：置 titleCustom，之后的自动标题不再覆盖 */
  rename(id: string, title: string): SessionMeta | null {
    return this.updateMeta(id, { title, titleCustom: true, updatedAt: Date.now() });
  }

  saveGeneratedTitle(id: string, runId: string, title: string): boolean {
    const meta = this.getMeta(id);
    if (!meta || meta.titleCustom || meta.titleGenerated) return false;
    const history = this.messageHistory(id);
    if (
      history.rollback ||
      !history.tasks.some(({ task, result }) => task.agentRunId === runId && result === "success")
    )
      return false;
    this.writeIndex({
      ...this.index,
      sessions: this.index.sessions.map((session) =>
        session.id === id ? { ...session, title, titleGenerated: true } : session,
      ),
    });
    return true;
  }

  /** 置顶/取消置顶（渲染层在同一项目内优先展示） */
  setPinned(id: string, pinned: boolean): SessionMeta | null {
    return this.updateMeta(id, { pinned });
  }

  /** 归档/取消归档（主列表隐藏 ↔ 已归档分区） */
  setArchived(id: string, archived: boolean): SessionMeta | null {
    return this.updateMeta(id, { archived });
  }

  /** 标记/清除未读（打开会话时由 host 清除） */
  setUnread(id: string, unread: boolean): SessionMeta | null {
    const meta = this.getMeta(id);
    if (!meta) return null;
    if (Boolean(meta.unread) === unread) return meta;
    return this.updateMeta(id, { unread });
  }

  private updateMeta(id: string, changes: Partial<SessionMeta>): SessionMeta | null {
    const previous = this.getMeta(id);
    if (!previous) return null;
    const meta = { ...previous, ...changes };
    this.writeIndex({
      ...this.index,
      sessions: this.index.sessions.map((session) => (session.id === id ? meta : session)),
    });
    return meta;
  }

  /** 分叉：复制整个转录为新会话（标题 = 分叉：原名，titleCustom 保护），返回新会话元数据 */
  fork(id: string): SessionMeta | null {
    const origin = this.index.sessions.find((s) => s.id === id);
    if (!origin) return null;
    const { messages, checkpoint, gitChanges, compactions } = this.read(id);
    const transcript = checkpoint
      ? [...completeToolResults(messages, checkpoint.approvals), ...checkpoint.pending]
      : messages;
    const meta = this.create(origin.workingDirectory);
    if (transcript.length > 0)
      this.save(meta.id, transcript, undefined, gitChanges, undefined, compactions);
    return this.rename(meta.id, `分叉：${origin.title.slice(0, 21)}`);
  }

  branchFromMessage(
    origin: SessionMeta,
    messages: AgentMessage[],
    draft: ComposerDraft,
    planMode?: SessionSettings["planMode"],
    images?: ImageAttachment[],
  ): string {
    const settings = { model: origin.model, approvalMode: origin.approvalMode, planMode };
    const { id } = this.create(origin.workingDirectory, undefined, settings);
    try {
      const compactions = this.compactions(origin.id).filter(
        ({ cutoff }) => cutoff <= messages.length,
      );
      const tasks = this.messageHistory(origin.id).tasks.filter(
        ({ endIndex }) => endIndex <= messages.length,
      );
      if (messages.length)
        this.writeTranscript(id, messages, undefined, null, compactions, { tasks });
      if (origin.personaOverride) this.setPersonaOverride(id, origin.personaOverride);
      this.rename(id, "分叉：" + origin.title.slice(0, 21));
      this.saveDraft(id, draft);
      if (images?.length) this.saveDraftImages(id, images);
      return id;
    } catch (error) {
      this.remove(id);
      throw error;
    }
  }

  /** 会话全文（复制用）：user/assistant 逐条带角色标签 */
  transcriptText(id: string): string | null {
    const meta = this.index.sessions.find((s) => s.id === id);
    if (!meta) return null;
    const messages = this.load(id);
    return messages
      .filter((m) => m.role === "user" || m.role === "assistant")
      .map((m) =>
        m.role === "user"
          ? "【用户】" + visibleMessageText(messageParts(m))
          : "【助手】" + messageText(m),
      )
      .join("\n\n");
  }

  searchTranscripts(query: string, project?: string | null): SessionSearchResults {
    const hits: SessionSearchResults["hits"] = [];
    if (!query.trim()) return { hits, hasMore: false };
    for (const { id, workingDirectory, worktree } of this.list()) {
      if (
        project !== undefined &&
        (workingDirectory ?? null) !== project &&
        worktree?.projectDirectory !== project
      )
        continue;
      let segments: ReturnType<typeof transcriptSegments>;
      try {
        segments = this.indexedTranscript(id);
      } catch (error) {
        if (error instanceof NewerFormatError) continue;
        throw error;
      }
      for (const match of findTranscript(segments, query)) {
        if (hits.length === CONVERSATION_SEARCH_LIMIT) return { hits, hasMore: true };
        hits.push({ sessionId: id, ...match });
      }
    }
    return { hits, hasMore: false };
  }

  private indexedTranscript(id: string): ReturnType<typeof transcriptSegments> {
    const cached = this.transcriptIndex.get(id);
    if (cached) {
      const path = this.filePath(id);
      headerVersion(transcriptPrefix(path), path);
    }
    const segments =
      cached ??
      transcriptSegments(toUiMessages(this.load(id), "s", undefined, this.compactions(id)));
    this.transcriptIndex.delete(id);
    this.transcriptIndex.set(id, segments);
    if (this.transcriptIndex.size > CONVERSATION_INDEX_CACHE_SIZE) {
      const oldest = this.transcriptIndex.keys().next().value;
      if (oldest !== undefined) this.transcriptIndex.delete(oldest);
    }
    return segments;
  }

  exportMarkdown(id: string, locale: Locale): { filename: string; markdown: string } {
    const session = this.getMeta(id);
    if (!session) throw new Error("找不到该会话。");
    const messages = toUiMessages(this.load(id), "s", undefined, this.compactions(id));
    return {
      filename: transcriptFilename(session.title),
      markdown: transcriptMarkdown(session.title, messages, locale),
    };
  }

  /** 删除：移除转录文件与索引项（文件不存在也照常清索引） */
  remove(id: string): void {
    this.checkIndexFormat();
    this.assertSessionFormat(id);
    if (this.newChatDrafts.some((draft) => draft.id === id)) this.checkDraftCollection();
    this.backUpIndexIfNeeded();
    const path = this.filePath(id);
    if (existsSync(path)) rmSync(path, { force: true });
    this.clearDraft(id);
    this.checkpoints.delete(id);
    this.gitChanges.delete(id);
    this.contextCompactions.delete(id);
    this.messageHistories.delete(id);
    this.transcriptWrites.delete(id);
    this.transcriptIndex.delete(id);
    this.writeIndex({ ...this.index, sessions: this.index.sessions.filter((s) => s.id !== id) });
  }

  load(id: string): AgentMessage[] {
    const { messages, checkpoint } = this.read(id);
    return checkpoint
      ? [...completeToolResults(messages, checkpoint.approvals), ...checkpoint.pending]
      : messages;
  }

  checkpoint(id: string): RunCheckpoint | undefined {
    if (!this.checkpoints.has(id)) return this.read(id).checkpoint;
    return this.checkpoints.get(id) ?? undefined;
  }

  lastGitChanges(id: string): SavedGitChanges | undefined {
    if (!this.gitChanges.has(id)) return this.read(id).gitChanges;
    return this.gitChanges.get(id) ?? undefined;
  }

  compactions(id: string): SavedCompaction[] {
    return this.contextCompactions.get(id) ?? this.read(id).compactions;
  }

  messageHistory(id: string): MessageHistory {
    return this.messageHistories.get(id) ?? this.read(id).messageHistory;
  }

  addCompaction(
    id: string,
    messages: AgentMessage[],
    compaction: SavedCompaction,
    checkpoint = this.checkpoint(id),
  ): void {
    this.writeTranscript(id, messages, checkpoint, undefined, [
      ...this.compactions(id),
      compaction,
    ]);
  }

  read(id: string): SessionRecord {
    if (this.indexUpgrade) throw this.indexUpgrade;
    const path = this.filePath(id);
    const text = readStoredText(path) ?? "";
    const lines = text.split("\n");
    const start = headerVersion(text, path) ? 1 : 0;
    const messages: AgentMessage[] = [];
    let checkpoint: RunCheckpoint | undefined;
    let gitChanges: SavedGitChanges | undefined;
    const compactions: SavedCompaction[] = [];
    const messageHistory: MessageHistory = { tasks: [] };
    const completedTools = new Map<string, ToolResultMessage>();
    for (const [index, line] of lines.entries()) {
      if (index < start || !line.trim()) continue;
      try {
        const value = JSON.parse(line) as
          | RunCheckpoint
          | CheckpointAppend
          | SavedGitChanges
          | SavedCompaction
          | SavedMessageTask
          | MessageRollbackJournal
          | AgentMessage;
        if ("role" in value) messages.push(value);
        else if (value.type === "pilot_run_checkpoint") checkpoint = value;
        else if (value.type === "pilot_checkpoint_append") {
          // A partial write can leave valid JSON without its final newline.
          if (index === lines.length - 1 || !validCheckpointAppend(value))
            throw new Error("Invalid checkpoint append");
          for (const message of value.messages) {
            if (message.role === "toolResult") completedTools.delete(message.toolCallId);
            messages.push(message);
          }
          if (value.completedTool)
            completedTools.set(value.completedTool.toolCallId, value.completedTool);
          checkpoint = value.checkpoint;
        } else if (value.type === "pilot_git_changes") gitChanges = value;
        else if (value.type === "pilot_message_task" && validMessageTask(value))
          messageHistory.tasks.push(value);
        else if (value.type === "pilot_message_rollback" && Array.isArray(value.files))
          messageHistory.rollback = value;
        else if (value.type === "pilot_context_compaction" && validCompaction(value))
          compactions.push(value);
      } catch {
        console.error(`[session] 跳过损坏行: ${id}`);
      }
    }
    for (const tool of completedTools.values()) messages.push(tool);
    this.checkpoints.set(id, checkpoint ?? null);
    this.gitChanges.set(id, gitChanges ?? null);
    const saved = compactions.filter(({ cutoff }) => cutoff <= messages.length);
    this.contextCompactions.set(id, saved);
    messageHistory.tasks = messageHistory.tasks.filter(
      ({ endIndex }) => endIndex <= messages.length,
    );
    this.messageHistories.set(id, messageHistory);
    this.transcriptWrites.set(id, {
      messageCount: messages.length,
      appendable: lines.length === 0 || lines.at(-1) === "",
    });
    return { messages, checkpoint, gitChanges, compactions: saved, messageHistory };
  }

  startCheckpoint(
    id: string,
    messages: AgentMessage[],
    checkpoint: RunCheckpoint,
    settings?: SessionSettings,
  ): void {
    this.checkIndexFormat();
    const state = this.transcriptWriteState(id);
    if (
      !state.appendable ||
      this.checkpoint(id) ||
      (state.messageCount !== 0 && state.messageCount !== messages.length)
    ) {
      // A resumed transcript can contain repaired tool results and accepted queued input.
      this.writeTranscript(id, messages, checkpoint);
    } else {
      this.appendCheckpoint(id, state.messageCount === 0 ? messages : [], checkpoint);
    }
    this.saveSessionMeta(id, messages, checkpoint, "interrupted", { settings });
  }

  appendCheckpoint(
    id: string,
    messages: AgentMessage[],
    checkpoint: RunCheckpoint,
    completedTool?: ToolResultMessage,
  ): void {
    if (this.indexUpgrade) throw this.indexUpgrade;
    const path = this.filePath(id);
    const version = headerVersion(transcriptPrefix(path), path);
    this.transcriptIndex.delete(id);
    const state = this.transcriptWriteState(id);
    if (!state.appendable) throw new Error("无法保存任务进度。");
    const record: CheckpointAppend = {
      type: "pilot_checkpoint_append",
      checkpoint,
      messages,
      completedTool,
    };
    try {
      const line = JSON.stringify(record) + "\n";
      if (!version) {
        // Insert the first version header without rewriting the meaning of existing records.
        writeStorageAtomic(path, transcriptHeader + (readStoredText(path) ?? "") + line);
      } else {
        appendFileSync(path, line, { encoding: "utf8", flush: true });
      }
    } catch (error) {
      // Replacing the file before writing again prevents replaying an uncertain append.
      this.transcriptWrites.set(id, { ...state, appendable: false });
      throw error;
    }
    this.checkpoints.set(id, checkpoint);
    this.transcriptWrites.set(id, {
      messageCount: state.messageCount + messages.length,
      appendable: true,
    });
  }

  private transcriptWriteState(id: string): TranscriptWriteState {
    const state = this.transcriptWrites.get(id);
    if (state) return state;
    this.read(id);
    return this.transcriptWrites.get(id)!;
  }

  save(
    id: string,
    messages: AgentMessage[],
    checkpoint?: RunCheckpoint,
    gitChanges?: SavedGitChanges | null,
    settlement?: SessionRunSettlement,
    compactions?: SavedCompaction[],
  ): SessionMeta {
    this.checkIndexFormat();
    const history = this.messageHistory(id);
    const { messageRange, task, result } = settlement ?? {};
    const next =
      messageRange && task && result && messageRange.startIndex < messages.length
        ? {
            ...history,
            tasks: [
              ...history.tasks.filter((entry) => entry.task.taskId !== task.taskId),
              {
                type: "pilot_message_task" as const,
                ...messageRange,
                task,
                result,
                endIndex: messages.length,
              },
            ],
          }
        : history;
    this.writeTranscript(id, messages, checkpoint, gitChanges, compactions, next);
    return this.saveSessionMeta(id, messages, checkpoint, settlement?.result, settlement);
  }

  finishMessageRollback(id: string, record: SessionRecord, endIndex: number): void {
    this.assertSessionFormat(id);
    const tasks = record.messageHistory.tasks.filter((task) => task.endIndex <= endIndex);
    const compactions = record.compactions.filter(({ cutoff }) => cutoff <= endIndex);
    if (!this.getMeta(id)) throw new Error("找不到该会话。");
    const task = tasks.at(-1);
    const previousIndex = this.index;
    this.writeIndex({
      ...previousIndex,
      sessions: previousIndex.sessions.map((session) =>
        session.id === id
          ? {
              ...session,
              planMode: session.planMode && { executionMode: session.planMode.executionMode },
              updatedAt: Date.now(),
              lastTask: task?.task,
              lastRunResult: task?.result,
            }
          : session,
      ),
    });
    try {
      this.writeTranscript(id, record.messages.slice(0, endIndex), undefined, null, compactions, {
        tasks,
      });
    } catch (error) {
      this.writeIndex(previousIndex);
      throw error;
    }
  }

  private saveSessionMeta(
    id: string,
    messages: AgentMessage[],
    checkpoint?: RunCheckpoint,
    lastRunResult?: SessionRunResult,
    settlement?: Pick<SessionRunSettlement, "task" | "settings">,
  ): SessionMeta {
    const title = sessionTitle(messages, checkpoint);
    const previous = this.getMeta(id);
    const now = Date.now();
    const meta: SessionMeta = {
      ...previous,
      ...settlement?.settings,
      id,
      title: previous?.titleCustom || previous?.titleGenerated ? previous.title : title,
      createdAt: previous?.createdAt ?? now,
      updatedAt: now,
      lastTask: settlement?.task ?? previous?.lastTask,
      lastRunResult: lastRunResult ?? previous?.lastRunResult,
    };
    this.writeIndex({
      ...this.index,
      sessions: previous
        ? this.index.sessions.map((session) => (session.id === id ? meta : session))
        : [...this.index.sessions, meta],
    });
    return meta;
  }

  writeTranscript(
    id: string,
    messages: AgentMessage[],
    checkpoint?: RunCheckpoint,
    gitChanges = this.lastGitChanges(id) ?? null,
    compactions = this.compactions(id),
    messageHistory = this.messageHistory(id),
  ): void {
    if (this.indexUpgrade) throw this.indexUpgrade;
    const path = this.filePath(id);
    headerVersion(transcriptPrefix(path), path);
    this.transcriptIndex.delete(id);
    const git = gitChanges?.checkpoint;
    const tasks = git
      ? messageHistory.tasks.map((task) =>
          task.task.agentRunId === git.id && task.workspace.kind === "git"
            ? { ...task, workspace: { ...task.workspace, files: git.files } }
            : task,
        )
      : messageHistory.tasks;
    // The checkpoint and its transcript commit together, including the transition to a finished run.
    const records = [
      ...(checkpoint ? [checkpoint] : []),
      ...(gitChanges ? [gitChanges] : []),
      ...tasks,
      ...(messageHistory.rollback ? [messageHistory.rollback] : []),
      ...compactions,
      ...messages,
    ];
    const contents = records.map((record) => JSON.stringify(record) + "\n").join("");
    writeStorageAtomic(path, transcriptHeader + contents);
    this.checkpoints.set(id, checkpoint ?? null);
    this.gitChanges.set(id, gitChanges);
    this.contextCompactions.set(id, compactions);
    this.messageHistories.set(id, { tasks, rollback: messageHistory.rollback });
    this.transcriptWrites.set(id, { messageCount: messages.length, appendable: true });
  }
}

function checkpointResult(checkpoint: RunCheckpoint | undefined): SessionRunResult | undefined {
  if (checkpoint) return checkpoint.failure ? "failed" : "interrupted";
}

function hasMessageRole(value: unknown): value is AgentMessage {
  return (
    value !== null &&
    typeof value === "object" &&
    "role" in value &&
    (value.role === "system" ||
      value.role === "user" ||
      value.role === "assistant" ||
      value.role === "toolResult")
  );
}

function validCheckpointAppend(value: CheckpointAppend): boolean {
  const { checkpoint, messages, completedTool } = value;
  return (
    checkpoint?.type === "pilot_run_checkpoint" &&
    typeof checkpoint.runId === "string" &&
    Number.isSafeInteger(checkpoint.startIndex) &&
    checkpoint.startIndex >= 0 &&
    (checkpoint.workingDirectory === null || typeof checkpoint.workingDirectory === "string") &&
    Array.isArray(checkpoint.pending) &&
    checkpoint.pending.every((message) => hasMessageRole(message) && message.role === "user") &&
    Array.isArray(checkpoint.actions) &&
    checkpoint.actions.every((action) => typeof action === "string") &&
    Array.isArray(messages) &&
    messages.every(hasMessageRole) &&
    (completedTool === undefined ||
      (completedTool?.role === "toolResult" && typeof completedTool.toolCallId === "string"))
  );
}

function validCompaction(value: SavedCompaction): boolean {
  return (
    typeof value.id === "string" &&
    typeof value.summary === "string" &&
    [value.position, value.cutoff, value.trimBefore, value.trimmedTools, value.timestamp].every(
      (n) => Number.isSafeInteger(n) && n >= 0,
    ) &&
    Number.isSafeInteger(value.toolOutputLimit) &&
    value.toolOutputLimit > 0
  );
}

function validMessageTask(value: SavedMessageTask): boolean {
  return (
    Number.isSafeInteger(value.startIndex) &&
    value.startIndex >= 0 &&
    Number.isSafeInteger(value.endIndex) &&
    value.endIndex > value.startIndex &&
    typeof value.task?.agentRunId === "string" &&
    typeof value.task.taskId === "string" &&
    (value.workspace?.kind === "folder" ||
      value.workspace?.kind === "unknown" ||
      (value.workspace?.kind === "git" &&
        typeof value.workspace.snapshot?.root === "string" &&
        typeof value.workspace.snapshot.head === "string" &&
        Array.isArray(value.workspace.files)))
  );
}

function sessionTitle(messages: AgentMessage[], checkpoint?: RunCheckpoint): string {
  const firstUser = messages.find((m) => m.role === "user") ?? checkpoint?.pending?.[0];
  return firstUser
    ? visibleMessageText(messageParts(firstUser)).slice(0, 24) || "新会话"
    : "新会话";
}

function writeSessionEntries(path: string, entries: unknown[]): void {
  writeStorageAtomic(
    path,
    JSON.stringify({ formatVersion: SESSION_FORMAT_VERSION, entries }, null, 2),
  );
}
