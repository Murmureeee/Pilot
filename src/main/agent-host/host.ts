// @env node
// Agent 宿主负责会话选择、Agent 缓存和工作区审查。
import { randomUUID } from "node:crypto";
import { basename } from "node:path";

import { Agent, type AgentMessage, type AgentTool } from "@earendil-works/pi-agent-core";
import type { ToolResultMessage } from "@earendil-works/pi-ai";

import type {
  ActiveRun,
  ApprovalMode,
  ComposerDraft,
  FileDiff,
  GitCheckpointDiff,
  GitChangesView,
  GitCommitPreview,
  GitCommitResult,
  GitDiffRequest,
  GitFileDiff,
  GitPatchSelection,
  GitRollbackPreview,
  GitRollbackSelection,
  GitStageSelection,
  ImageAttachment,
  Locale,
  MessageBranchAction,
  MessageRollbackPreview,
  PermissionDecision,
  PlanDecision,
  PromptInput,
  PromptMention,
  RunRef,
  SessionMeta,
  SessionNavigation,
  SessionSearchResults,
  SessionInstructionSources,
  SessionSettings,
  SessionSettingsInput,
  SkillMeta,
  Snapshot,
  ToolRule,
  VerificationTask,
} from "@shared/contract";

import { compactFocus } from "../../shared/compact-command";
import { APP_NAME, DEFAULT_THINKING_LEVEL, PLAN_PROPOSAL_MAX_LENGTH } from "../../shared/constants";
import { imagesFromMessageParts } from "../../shared/image-attachments";
import { draftFromMessageParts, promptFromDraft } from "../../shared/mentions";
import { applyMessageEvent } from "../../shared/message-events";
import { effectiveModelCapabilities } from "../../shared/model-capabilities";
import { hasSavedModel, resolveSessionModel, selectedCatalogModel } from "../../shared/providers";
import { toPublicSettings } from "../settings";
import { decryptSecret } from "../settings/secrets";
import type { ProviderConfig, Settings } from "../settings/types";
import { readFileChange, restoreFileChange } from "../workspace/file-changes";
import { relativeGitPath } from "../workspace/git";
import { captureGitSnapshot, compareGitSnapshots } from "../workspace/git-changes";
import { gitCheckpointDiff, rollbackTarget, verifyGitRollback } from "../workspace/git-checkpoint";
import {
  applyGitCommit,
  gitActionError,
  previewGitCommit,
  stageGitSelection,
} from "../workspace/git-index-actions";
import { displayGitPatch, readGitSelection } from "../workspace/git-patch";
import {
  gitFileDiff,
  gitFilePath,
  readGitWorktreeFile,
  replaceGitWorktreeFile,
  sameGitFile,
} from "../workspace/git-review-files";
import { createToolPathResolver, normalizeWorkingDirectory } from "../workspace/paths";
import { getCommandShell } from "../workspace/shell";
import { buildTextDiff, textLines } from "../workspace/text-diff";
import type {
  GitCheckpointFile,
  GitRollbackOperation,
  GitSnapshot,
  GitTaskCheckpoint,
  GitWorktree,
  RecordedFileChange,
} from "../workspace/types";
import {
  APPROVED_PLAN_INSTRUCTIONS,
  PROJECT_INSTRUCTION_PRIORITY,
  SKILL_CATALOG_INSTRUCTIONS,
} from "./constants";
import { compactedContext, contextSize, transcriptUsage } from "./context-compaction";
import { droppedWorkspaceReferences, prepareMentionPrompt } from "./mentions";
import { messageIndex } from "./message-operations";
import {
  applyMessageRollbackFiles,
  prepareMessageRollback,
  recoverMessageRollbackFiles,
} from "./message-rollback";
import { resolveModel } from "./models";
import { ProjectInstructionScopes, loadProjectInstructions } from "./project-instructions";
import { failedRunOf, interruptedRunOf } from "./recovery";
import { AgentRun, finishedGitView } from "./run";
import { messageParts, toUiMessages } from "./session-store";
import { scanSkills, skillCatalog } from "./skills";
import { createTools } from "./tools";
import type { ToolEnvironment } from "./tools/types";
import type {
  AgentInstructions,
  AgentRunOptions,
  AgentSessionView,
  HostDeps,
  GitCommitOperation,
  MessageRollbackOperation,
  NewChatDraft,
  ReferencedUserMessage,
  SavedGitChanges,
} from "./types";

const BASE_SYSTEM_PROMPT = `You are a helpful assistant running inside ${APP_NAME}.`;

function createSessionView(): AgentSessionView {
  return {
    messages: [],
    nextId: 0,
    error: null,
    usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, costTotal: 0 },
    contextTokens: 0,
    contextWindow: null,
  };
}

export class AgentHost {
  private agent: Agent | null = null;
  private agentSessionId: string | null = null;
  private agentProvider: ProviderConfig | null = null;
  private agentInstructions: AgentInstructions | null = null;
  private agentToolEnvironment: ToolEnvironment | null = null;
  private localTools: AgentTool[] = [];
  private view = createSessionView();
  private run?: AgentRun;
  private gitRollback?: GitRollbackOperation;
  private applyingGitRollback = false;
  private messageRollback?: MessageRollbackOperation;
  private gitCommit?: GitCommitOperation;
  private applyingGitSelection = false;
  private readonly sessionRules = new Map<string, ToolRule[]>();
  private sessionId: string | null = null;
  private newChatDraft: NewChatDraft;

  constructor(private readonly deps: HostDeps) {
    this.newChatDraft = deps.store.newChatDraft() ?? this.emptyDraft();
  }

  private emptyDraft(workingDirectory?: string): NewChatDraft {
    return { id: randomUUID(), workingDirectory, draft: [], settings: {} };
  }

  private get composerId(): string {
    return this.sessionId ?? this.newChatDraft.id;
  }

  private selectedRun(ref: RunRef): AgentRun | undefined {
    const run = this.run;
    return run?.state.runId === ref.runId &&
      run.state.sessionId === ref.sessionId &&
      this.sessionId === ref.sessionId
      ? run
      : undefined;
  }

  respondPermission(ref: RunRef, requestId: string, decision: PermissionDecision): void {
    this.selectedRun(ref)?.respondPermission(requestId, decision);
  }

  private sendSessions(activeSessionId?: string): SessionMeta[] {
    const sessions = this.deps.store.list();
    this.deps.broadcast({
      type: "sessions",
      sessions,
      recentProjects: this.deps.store.listRecentProjects(sessions),
      activeSessionId,
    });
    return sessions;
  }

  private getCurrentSession(): SessionMeta | null {
    return this.sessionId ? this.deps.store.getMeta(this.sessionId) : null;
  }

  private get currentSettings(): SessionSettings {
    return this.getCurrentSession() ?? this.newChatDraft.settings;
  }

  private executionMode(settings = this.currentSettings): ApprovalMode {
    return settings.approvalMode ?? this.deps.getSettings().approvalMode ?? "standard";
  }

  selectedSessionId(): string | null {
    return this.sessionId;
  }

  getProjectDirectory(): string | undefined {
    return this.sessionId
      ? this.getCurrentSession()?.workingDirectory
      : this.newChatDraft.workingDirectory;
  }

  getWorkingDirectory(): string | undefined {
    const active = this.run?.state;
    if (active && active.sessionId === this.sessionId) return active.workingDirectory ?? undefined;
    const interrupted = this.sessionId && this.deps.store.checkpoint(this.sessionId);
    if (interrupted) return interrupted.workingDirectory ?? undefined;
    return this.getProjectDirectory() ?? this.deps.getSettings().workingDirectory;
  }

  hasActiveRun(): boolean {
    return this.run !== undefined;
  }

  private startSession(workingDirectory: string | undefined): void {
    const { id, settings } = this.newChatDraft;
    const meta = this.deps.store.create(workingDirectory, id, settings);
    this.sessionId = meta.id;
    this.sendSessions(meta.id);
  }

  private saveNewChatDraft(draft: NewChatDraft): void {
    this.deps.store.saveNewChatDraft(draft);
    this.newChatDraft = draft;
  }

  private updateCurrentSettings(changes: SessionSettings): void {
    if (this.sessionId) {
      this.deps.store.updateSettings(this.sessionId, changes);
      this.sendSessions();
    } else {
      this.saveNewChatDraft({
        ...this.newChatDraft,
        settings: { ...this.currentSettings, ...changes },
      });
      this.publishSnapshot();
    }
  }

  getInstructionSources(composerId: string): SessionInstructionSources {
    this.checkComposerId(composerId);
    const running = this.run;
    if (running && running.state.sessionId === this.sessionId && this.agentInstructions) {
      const scopedProject = running.instructionSources();
      return {
        ...this.agentInstructions.sources,
        ...(scopedProject.length && { scopedProject }),
        running: true,
      };
    }
    const { sources, projectDirectory } = this.loadInstructions(
      this.deps.getSettings(),
      this.getWorkingDirectory(),
    );
    const scopes = new ProjectInstructionScopes(projectDirectory);
    if (projectDirectory) {
      const { store } = this.deps;
      const id = this.sessionId;
      const draft = id ? store.loadDraft(id) : this.newChatDraft.draft;
      if (!scopes.includeDraft(draft) && id) {
        const { messages, checkpoint, messageHistory } = store.read(id);
        if (checkpoint?.workingDirectory === projectDirectory)
          scopes.includeHistory([...messages.slice(checkpoint.startIndex), ...checkpoint.pending]);
        else {
          const last = messageHistory.tasks.at(-1);
          if (last?.workingDirectory === projectDirectory)
            scopes.includeHistory(messages.slice(last.startIndex, last.endIndex));
        }
      }
    }
    const scopedProject = scopes.sources();
    return { ...sources, ...(scopedProject.length && { scopedProject }), running: false };
  }

  listSkills(composerId: string): SkillMeta[] {
    this.checkComposerId(composerId);
    return scanSkills(
      this.deps.skillsDir,
      this.deps.getSettings().skillsEnabled ?? [],
      this.getWorkingDirectory(),
    );
  }

  private loadInstructions(
    settings: Settings,
    workingDirectory: string | undefined,
    skills: readonly SkillMeta[] = scanSkills(
      this.deps.skillsDir,
      settings.skillsEnabled ?? [],
      workingDirectory,
    ),
  ): AgentInstructions {
    const application = [BASE_SYSTEM_PROMPT, PROJECT_INSTRUCTION_PRIORITY];
    if (workingDirectory) {
      application.push(
        "When citing a known workspace item in a reply, link to its workspace-relative path in Markdown. Use a trailing / for folders and add #L followed by the line number for files when known. URL-encode spaces and brackets in the link target.",
      );
    }

    const context: string[] = [];
    const linkedDirectory = this.sessionId ? this.getProjectDirectory() : workingDirectory;
    const projectDirectory = linkedDirectory === workingDirectory ? linkedDirectory : undefined;
    const project = loadProjectInstructions(projectDirectory);
    if (project.body && "path" in project.source)
      context.push(`## Project instructions (${basename(project.source.path)})\n\n${project.body}`);

    const chatInstructions = this.getCurrentSession()?.personaOverride?.trim();
    const custom = chatInstructions || settings.persona?.trim();
    if (custom) {
      context.push(
        `## ${chatInstructions ? "Chat instructions" : "Global personalization"}\n\n${custom}`,
      );
    }

    const enabledSkills = skills.filter(({ enabled }) => enabled);
    if (skills.length) context.push(SKILL_CATALOG_INSTRUCTIONS);
    if (enabledSkills.length) context.push("## Available skills\n\n" + skillCatalog(enabledSkills));
    return {
      appPrompt: application.join("\n\n"),
      contextPrompt: context.join("\n\n"),
      projectDirectory,
      skills,
      sources: {
        project: project.source,
        personalization: chatInstructions ? "session" : custom ? "global" : null,
        enabledSkills: enabledSkills.map(({ name }) => name),
      },
    };
  }

  /** 确保当前会话有 Agent 实例；跨会话或 provider/模型/systemPrompt 变更时重建（转录从落盘恢复） */
  private ensureAgent(workingDirectory: string | undefined, skills?: readonly SkillMeta[]): Agent {
    const settings = this.deps.getSettings();
    const selection = resolveSessionModel(settings, this.currentSettings.model);
    const provider = selection && settings.providers.find((p) => p.id === selection.providerId);
    if (!selection || !provider) throw new Error("尚未配置 provider，请先到设置页添加");
    const active = { ...provider, modelId: selection.modelId };
    const entry = active.models?.find(({ id }) => id === active.modelId);

    if (workingDirectory) createToolPathResolver(workingDirectory)(".");
    const sessionId = this.composerId;
    const instructions = this.loadInstructions(settings, workingDirectory, skills);
    const toolEnvironment: ToolEnvironment = {
      workingDirectory,
      commandShell: getCommandShell(settings.commandShell),
    };

    // FR-1.6：provider/模型变更；FR-1.7/5.9：人设/技能变更 → 重建，下一轮请求生效（上下文不丢）
    if (
      this.agent &&
      this.agentSessionId === sessionId &&
      !this.deps.store.checkpoint(sessionId) &&
      this.agentProvider?.id === active.id &&
      this.agentProvider.kind === active.kind &&
      this.agentProvider.modelId === active.modelId &&
      this.agentProvider.baseUrl === active.baseUrl &&
      this.agentProvider.apiKey === active.apiKey &&
      JSON.stringify(this.agentProvider.models?.find(({ id }) => id === active.modelId)) ===
        JSON.stringify(entry) &&
      this.agentInstructions?.appPrompt === instructions.appPrompt &&
      this.agentInstructions.contextPrompt === instructions.contextPrompt &&
      this.agentToolEnvironment?.workingDirectory === toolEnvironment.workingDirectory &&
      this.agentToolEnvironment?.commandShell === toolEnvironment.commandShell
    ) {
      this.agentInstructions = instructions;
      this.agent.state.thinkingLevel = settings.thinkingLevel ?? DEFAULT_THINKING_LEVEL;
      return this.agent;
    }

    if (this.agentSessionId !== sessionId) this.resetAgent();
    const apiKey = decryptSecret(active.apiKey);
    const { model, streamFn } = resolveModel(active, apiKey, this.deps.request);
    const { contextWindow } = model;
    this.view.contextWindow =
      Number.isFinite(contextWindow) && contextWindow > 0 ? contextWindow : null;

    this.localTools = createTools(toolEnvironment);
    const messages = this.deps.store.load(sessionId);
    // Request-time instructions are loaded from their sources instead of copied into history.
    const first = messages[0];
    if (first?.role === "system") messages[0] = { ...first, content: BASE_SYSTEM_PROMPT };
    const agent = new Agent({
      initialState: {
        systemPrompt: BASE_SYSTEM_PROMPT,
        model,
        tools: this.localTools,
        messages,
        thinkingLevel: settings.thinkingLevel ?? DEFAULT_THINKING_LEVEL,
      },
      streamFn,
      getApiKey: () => apiKey,
    });

    if (!this.sessionId) this.startSession(workingDirectory);
    this.agent = agent;
    this.agentSessionId = sessionId;
    this.agentProvider = active;
    this.agentInstructions = instructions;
    this.agentToolEnvironment = toolEnvironment;
    const compactions = this.deps.store.compactions(sessionId);
    this.view.messages = toUiMessages(agent.state.messages, "s", undefined, compactions);
    // id 计数只数 UI 可见消息（user/assistant），与事件侧计数保持一致
    this.view.nextId = this.view.messages.filter(({ role }) => role !== "system").length;
    this.view.usage = transcriptUsage(agent.state.messages, compactions);
    this.view.contextTokens = contextSize(
      compactedContext(agent.state.messages, compactions.at(-1)),
    );
    return agent;
  }

  checkWorkingDirectory(expected: string | null): void {
    if ((this.getWorkingDirectory() ?? null) !== expected) {
      throw new Error("工作目录已变更，请重新选择文件引用。");
    }
  }

  checkComposerId(id: string): void {
    if (id !== this.composerId) throw new Error("会话已切换，请重试。");
  }

  prepareTerminal(composerId: string, expectedDirectory: string): string {
    this.checkComposerId(composerId);
    if (this.getWorkingDirectory() !== expectedDirectory)
      throw new Error("工作目录已变更，请重新打开终端。");
    const cwd = createToolPathResolver(expectedDirectory)(".");
    if (!this.sessionId) this.deps.store.saveNewChatDraft(this.newChatDraft);
    return cwd;
  }

  verificationScope(
    composerId: string,
    expectedDirectory?: string,
  ): {
    sessionId: string;
    workingDirectory: string | null;
    task?: VerificationTask;
  } {
    this.checkComposerId(composerId);
    if (expectedDirectory !== undefined && this.applyingGitRollback)
      throw new Error("请等待撤销完成后再运行验证。");
    const workingDirectory = this.getWorkingDirectory() ?? null;
    if (expectedDirectory !== undefined) {
      if (workingDirectory !== expectedDirectory)
        throw new Error("工作目录已变更，请重新打开验证。");
      if (!this.sessionId) this.deps.store.saveNewChatDraft(this.newChatDraft);
    }
    const sessionId = this.sessionId;
    const checkpoint = sessionId ? this.deps.store.checkpoint(sessionId) : undefined;
    const task = checkpoint
      ? (checkpoint.task ?? { taskId: checkpoint.runId, agentRunId: checkpoint.runId })
      : this.getCurrentSession()?.lastTask;
    return { sessionId: composerId, workingDirectory, task };
  }

  saveSessionDraft(id: string, draft: ComposerDraft): void {
    this.checkComposerId(id);
    if (this.sessionId) this.deps.store.saveDraft(this.sessionId, draft);
    else this.saveNewChatDraft({ ...this.newChatDraft, draft });
  }

  saveSessionDraftImages(id: string, images: ImageAttachment[]): void {
    this.checkComposerId(id);
    if (!this.sessionId && images.length) this.deps.store.saveNewChatDraft(this.newChatDraft);
    this.deps.store.saveDraftImages(id, images);
  }

  resolveDroppedPaths(id: string, workingDirectory: string, paths: string[]): PromptMention[] {
    this.checkComposerId(id);
    this.checkWorkingDirectory(workingDirectory);
    return droppedWorkspaceReferences(workingDirectory, paths);
  }

  private supportsImages(selection = this.currentSettings.model): boolean {
    const model = selectedCatalogModel(toPublicSettings(this.deps.getSettings()), selection);
    return Boolean(
      model && effectiveModelCapabilities(model.automatic, model.overrides).supportsImages,
    );
  }

  updateSessionSettings(id: string, input: SessionSettingsInput): void {
    this.checkComposerId(id);
    if (input.model && !hasSavedModel(this.deps.getSettings().providers, input.model)) {
      throw new Error("请从已保存的模型中选择。");
    }
    const changes: SessionSettings = {};
    if (input.model !== undefined) changes.model = input.model ?? undefined;
    if (input.approvalMode !== undefined) {
      const planMode = this.currentSettings.planMode;
      if (planMode?.proposal) throw new Error("请先确认或放弃此计划。");
      changes.approvalMode = input.approvalMode ?? undefined;
      if (planMode)
        changes.planMode = {
          ...planMode,
          executionMode: changes.approvalMode ?? this.deps.getSettings().approvalMode ?? "standard",
        };
    }
    this.updateCurrentSettings(changes);
  }

  setPlanMode(id: string, enabled: boolean): void {
    this.checkComposerId(id);
    const current = this.currentSettings.planMode;
    if (enabled === Boolean(current)) return;
    if (current?.proposal) throw new Error("请先确认或放弃此计划。");
    if (this.run?.state.sessionId === id) throw new Error("请等待当前回复结束后再切换计划模式。");
    this.updateCurrentSettings({
      planMode: enabled ? { executionMode: this.executionMode() } : undefined,
    });
  }

  reviewPlan(id: string, proposalId: string, decision: PlanDecision): Promise<void> | void {
    this.checkComposerId(id);
    const { store } = this.deps;
    const planMode = this.currentSettings.planMode;
    const proposal = planMode?.proposal;
    if (!planMode || proposal?.id !== proposalId || store.checkpoint(id))
      throw new Error("计划已更新，请重新打开会话。");
    if (decision.type === "save") {
      const markdown = decision.markdown.trim();
      if (!markdown || markdown.length > PLAN_PROPOSAL_MAX_LENGTH)
        throw new Error("请输入有效的计划内容。");
      store.updateSettings(id, {
        planMode: { ...planMode, proposal: { ...proposal, id: randomUUID(), markdown } },
      });
      this.sendSessions();
      return;
    }
    if (decision.type === "discard") {
      store.updateSettings(id, { planMode: undefined });
      this.sendSessions();
      return;
    }
    if (this.run || this.applyingGitRollback || this.applyingGitSelection)
      throw new Error("请等待当前操作结束后再执行计划。");
    const directory = this.getWorkingDirectory();
    if ((directory ?? null) !== proposal.workingDirectory)
      throw new Error("计划的工作目录已更改。请放弃此计划并重新规划。");
    const agent = this.ensureAgent(directory);
    return this.beginRun(agent, {
      initialMessage: {
        role: "user",
        content: proposal.markdown,
        timestamp: Date.now(),
        pilotReference: {
          context: APPROVED_PLAN_INSTRUCTIONS,
          parts: [{ type: "text", text: proposal.markdown }],
        },
      },
      planning: false,
      approvedPlanMode: planMode.executionMode,
      settingsOnStart: { planMode: undefined },
    });
  }

  /** 运行中 = 插话（steer），空闲 = 发起新一轮 */
  prompt(
    input: string | PromptInput,
    composerId?: string,
    expectedDirectory?: string | null,
    replay = false,
  ): Promise<void> | ActiveRun {
    if (this.applyingGitRollback) throw new Error("正在撤销 Git 变更，请稍后重试。");
    if (this.applyingGitSelection) throw new Error("正在更新 Git，请稍后重试。");
    if (composerId !== undefined) this.checkComposerId(composerId);
    const images = typeof input === "string" ? [] : (input.images ?? []);
    const focus =
      !replay && !images.length && (typeof input === "string" || input.mentions.length === 0)
        ? compactFocus(typeof input === "string" ? input : input.text)
        : undefined;
    if (focus !== undefined) {
      if (expectedDirectory !== undefined) this.checkWorkingDirectory(expectedDirectory);
      return this.compact(composerId ?? this.composerId, focus, composerId);
    }
    const run = this.run;
    if (
      run &&
      (run.state.sessionId !== this.sessionId ||
        run.state.status === "stopping" ||
        !run.acceptsPrompts ||
        run.gitChangesAtEnd)
    ) {
      return run.state;
    }
    const planMode = this.currentSettings.planMode;
    if (!run && planMode?.proposal) throw new Error("请先确认或放弃此计划。");
    if (expectedDirectory !== undefined) this.checkWorkingDirectory(expectedDirectory);
    if (
      images.length &&
      !(run ? this.agent?.state.model.input.includes("image") : this.supportsImages())
    ) {
      throw new Error("当前模型仅支持文本。请选择支持图像的模型或移除图片。");
    }
    const workingDirectory = this.getWorkingDirectory();
    const skills = run
      ? this.agentInstructions!.skills
      : scanSkills(
          this.deps.skillsDir,
          this.deps.getSettings().skillsEnabled ?? [],
          workingDirectory,
        );
    const prepared =
      typeof input === "string"
        ? { text: input }
        : prepareMentionPrompt(input, (directory) => directory === workingDirectory, skills);
    const clearDraftFor = composerId ?? (this.sessionId === null ? this.composerId : undefined);
    const agent = run && this.agent ? this.agent : this.ensureAgent(workingDirectory, skills);
    const message: ReferencedUserMessage = {
      role: "user",
      content: images.length
        ? [
            ...(prepared.text ? [{ type: "text" as const, text: prepared.text }] : []),
            ...images.map(({ type, mimeType, data }) => ({ type, mimeType, data })),
          ]
        : prepared.text,
      timestamp: Date.now(),
      pilotReference: "reference" in prepared ? prepared.reference : undefined,
      pilotImageNames: images.length ? images.map(({ name }) => name) : undefined,
      pilotPlanning: (run ? run.planning : Boolean(planMode)) ? true : undefined,
    };
    if (run) {
      run.enqueue(message, composerId);
      return Promise.resolve();
    }

    return this.beginRun(agent, { initialMessage: message, clearDraftFor });
  }

  resume(ref: RunRef, compact = false): Promise<void> | ActiveRun {
    if (this.applyingGitRollback) throw new Error("正在撤销 Git 变更，请稍后重试。");
    if (this.applyingGitSelection) throw new Error("正在更新 Git，请稍后重试。");
    const active = this.run?.state;
    if (active) return active;
    const checkpoint =
      this.sessionId === ref.sessionId ? this.deps.store.checkpoint(ref.sessionId) : undefined;
    if (checkpoint?.runId !== ref.runId) {
      throw new Error("该任务已更新，请重新打开会话。");
    }
    if (compact && checkpoint.failure?.kind !== "context-limit")
      throw new Error("该任务没有上下文超限错误。");
    const directory = checkpoint.workingDirectory ?? undefined;
    const agent = this.ensureAgent(directory);
    const savedMode = checkpoint.planApprovalMode;
    const planMode = this.getCurrentSession()?.planMode;
    const planning = savedMode === undefined ? Boolean(planMode) : savedMode === "plan";
    const approvedPlanMode = savedMode === "plan" ? undefined : savedMode;
    const last = agent.state.messages.at(-1);
    const message: ReferencedUserMessage | undefined =
      !last || last.role === "assistant"
        ? {
            role: "user",
            content: "Continue the interrupted task from the saved conversation.",
            timestamp: Date.now(),
            pilotPlanning: planning ? true : undefined,
          }
        : undefined;
    return this.beginRun(agent, {
      initialMessage: message,
      compaction: compact ? { mode: "retry" } : undefined,
      planning,
      approvedPlanMode,
      settingsOnStart: approvedPlanMode && planMode?.proposal ? { planMode: undefined } : undefined,
    });
  }

  compact(composerId: string, focus = "", clearDraftFor?: string): Promise<void> {
    this.checkComposerId(composerId);
    if (this.applyingGitRollback || this.applyingGitSelection || this.run)
      throw new Error("请在当前操作结束后压缩上下文。");
    if (!this.sessionId) throw new Error("没有足够的较早内容可压缩。");
    const agent = this.ensureAgent(this.getWorkingDirectory());
    return this.beginRun(agent, { clearDraftFor, compaction: { mode: "manual", focus } });
  }

  private beginRun(
    agent: Agent,
    options: Partial<
      Pick<
        AgentRunOptions,
        | "initialMessage"
        | "clearDraftFor"
        | "compaction"
        | "planning"
        | "approvedPlanMode"
        | "settingsOnStart"
      >
    > = {},
  ): Promise<void> {
    const sessionId = this.sessionId!;
    if (this.deps.store.messageHistory(sessionId).rollback)
      throw new Error("此聊天有未完成的撤销。请重新打开「回到此处」。");
    const sessionRules = this.sessionRules.get(sessionId) ?? [];
    this.sessionRules.set(sessionId, sessionRules);
    const sessionMode = this.getCurrentSession()?.planMode;
    const planning = options.planning ?? Boolean(sessionMode);
    const run = new AgentRun({
      ...this.deps,
      ...options,
      agent,
      sessionId,
      environment: this.agentToolEnvironment!,
      tools: this.localTools,
      instructions: this.agentInstructions!,
      view: this.view,
      sessionRules,
      planning,
      settingsOnStart:
        options.settingsOnStart ??
        (planning && !sessionMode
          ? { planMode: { executionMode: this.executionMode() } }
          : undefined),
      onStarted: () => this.deps.onActivityChanged?.(),
      onSessionUpdated: () => {
        this.sendSessions();
      },
      onFinished: (completedTask) => {
        if (this.run !== run) return;
        this.run = undefined;
        const directory = run.state.workingDirectory;
        if (
          completedTask &&
          directory &&
          this.deps.store.getMeta(sessionId)?.workingDirectory === directory
        )
          this.deps.onTurnCompleted?.(sessionId, directory, completedTask);
        this.deps.onActivityChanged?.();
      },
    });
    this.run = run;
    return run.start();
  }

  abort(ref: RunRef): void {
    this.selectedRun(ref)?.stop();
  }

  async stopForExit(): Promise<void> {
    await this.run?.stopForExit();
  }

  private async stopOwnedRun(id: string): Promise<void> {
    const run = this.run;
    if (run?.state.sessionId === id) await run.stopAndWait();
  }

  clearQueue(ref: RunRef): void {
    const run = this.selectedRun(ref);
    if (run?.acceptsPrompts) run.clearQueue();
  }

  /** 手动重命名；返回刷新后的会话列表 */
  renameSession(id: string, title: string): SessionMeta[] {
    this.deps.store.rename(id, title);
    return this.sendSessions();
  }

  /** 置顶/取消置顶 */
  pinSession(id: string, pinned: boolean): SessionMeta[] {
    this.deps.store.setPinned(id, pinned);
    return this.sendSessions();
  }

  /** 归档/取消归档；归档当前打开的会话时回到草稿态（数据保留在归档区） */
  async archiveSession(id: string, archived: boolean): Promise<Snapshot> {
    if (archived && this.run?.state.sessionId === id) await this.stopOwnedRun(id);
    const directory = this.deps.store.getMeta(id)?.workingDirectory;
    this.deps.store.setArchived(id, archived);
    if (archived && this.sessionId === id) {
      this.switchSession(null, this.projectDraft(directory));
      return this.publishSnapshot("reset");
    }
    this.sendSessions();
    return this.getSnapshot();
  }

  /** 标记/清除未读 */
  unreadSession(id: string, unread: boolean): SessionMeta[] {
    this.deps.store.setUnread(id, unread);
    return this.sendSessions();
  }

  /** 分叉：复制转录为新会话 */
  forkSession(id: string): SessionMeta[] {
    this.deps.store.fork(id);
    return this.sendSessions();
  }

  branchMessage(composerId: string, messageId: string, action: MessageBranchAction): Snapshot {
    this.checkComposerId(composerId);
    const origin = this.getCurrentSession();
    if (!origin) throw new Error("找不到该会话。");
    if (action === "retry" && (this.run || this.applyingGitRollback || this.applyingGitSelection))
      throw new Error("请等待当前任务结束后再重试。");
    const messages = this.deps.store.load(origin.id);
    const index = messageIndex(messages, messageId);
    const expectedRole = action === "retry" ? "assistant" : "user";
    if (messages[index].role !== expectedRole) throw new Error("消息已变更，请重新选择。");
    const userIndex =
      action === "retry"
        ? messages.findLastIndex(({ role }, i) => i < index && role === "user")
        : index;
    if (userIndex < 0) throw new Error("找不到这条回复的原始消息。");
    const directory = this.getWorkingDirectory();
    const parts = action === "fork" ? [] : messageParts(messages[userIndex]);
    const draft = draftFromMessageParts(parts, directory);
    const images = imagesFromMessageParts(parts);
    if (action === "retry" && images.length && !this.supportsImages(origin.model))
      throw new Error("请选用支持图像的模型后重试此消息。");
    const end = action === "fork" ? index + 1 : userIndex;
    const planning = (messages[userIndex] as ReferencedUserMessage).pilotPlanning;
    const planMode =
      planning || origin.planMode
        ? { executionMode: origin.planMode?.executionMode ?? this.executionMode(origin) }
        : undefined;
    const id = this.deps.store.branchFromMessage(
      origin,
      messages.slice(0, end),
      action === "edit" ? draft : [],
      planMode,
      action === "edit" ? images : undefined,
    );
    this.switchSession(id);
    const snapshot = this.publishSnapshot("reveal");
    if (action === "retry")
      void this.prompt(promptFromDraft(draft, images), id, directory ?? null, true);
    return snapshot;
  }

  /** 会话全文文本（渲染层写入剪贴板） */
  copySession(id: string): string {
    return this.deps.store.transcriptText(id) ?? "";
  }

  searchSessions(query: string, project?: string | null): SessionSearchResults {
    return this.deps.store.searchTranscripts(query, project);
  }

  exportSessionMarkdown(id: string, locale: Locale): { filename: string; markdown: string } {
    return this.deps.store.exportMarkdown(id, locale);
  }

  /** 会话级人设覆盖（FR-5.9 每会话粒度；变更经 systemPrompt 指纹在下一轮生效） */
  setSessionPersona(id: string, persona: string | null): void {
    this.deps.store.setPersonaOverride(id, persona);
  }

  /** 删除会话；删除当前会话时回到草稿态（不新建会话文件） */
  async deleteSession(id: string): Promise<Snapshot> {
    if (this.run?.state.sessionId === id) await this.stopOwnedRun(id);
    await this.deps.terminal?.removeComposer(id);
    const directory = this.deps.store.getMeta(id)?.workingDirectory;
    this.deps.store.remove(id);
    this.sessionRules.delete(id);
    if (this.agentSessionId === id) this.resetAgent();
    if (this.sessionId === id) {
      this.switchSession(null, this.projectDraft(directory));
      return this.publishSnapshot("reset");
    }
    this.sendSessions();
    return this.getSnapshot();
  }

  newSession(): Snapshot {
    const directory = this.getProjectDirectory();
    const previous = this.deps.store.newChatDraft(directory ?? null);
    if (previous) this.deps.terminal?.removeComposer(previous.id).catch(() => {});
    this.switchSession(null, this.emptyDraft(directory));
    return this.publishSnapshot();
  }

  openProject(directory: string): Snapshot {
    const workingDirectory = normalizeWorkingDirectory(directory);
    this.deps.store.rememberProject(workingDirectory);
    this.switchSession(null, this.projectDraft(workingDirectory));
    return this.publishSnapshot();
  }

  useRecentProject(directory: string, sessionId?: string): Snapshot | Promise<Snapshot> {
    if (!this.deps.store.hasProject(directory)) throw new Error("找不到该最近项目。");
    return sessionId ? this.bindProject(sessionId, directory) : this.openProject(directory);
  }

  projectFolder(directory: string): string {
    if (!this.deps.store.hasProject(directory)) throw new Error("找不到该项目。");
    return normalizeWorkingDirectory(directory);
  }

  removeRecentProject(directory: string): void {
    this.deps.store.removeRecentProject(directory);
    this.sendSessions();
  }

  async bindProject(id: string, directory: string): Promise<Snapshot> {
    if (this.composerId !== id) throw new Error("会话已切换，请重新关联项目。");
    const workingDirectory = normalizeWorkingDirectory(directory);
    if (!this.sessionId) {
      this.deps.store.rememberProject(workingDirectory);
      this.saveNewChatDraft({ ...this.newChatDraft, workingDirectory });
      return this.publishSnapshot();
    }
    if (this.run?.state.sessionId === id) await this.stopOwnedRun(id);
    if (this.sessionId !== id) throw new Error("会话已切换，请重新关联项目。");
    this.deps.store.bindProject(id, workingDirectory);
    this.sessionRules.delete(id);
    if (this.agentSessionId === id) this.resetAgent();
    return this.publishSnapshot();
  }

  loadSession(id: string, record = true): Snapshot {
    if (!this.deps.store.getMeta(id)) return this.getSnapshot();
    if (this.sessionId !== id) {
      this.deps.store.setUnread(id, false);
      this.switchSession(id);
    }
    return this.publishSnapshot(record ? "record" : undefined);
  }

  revealSession(id: string): void {
    if (!this.deps.store.getMeta(id)) return;
    if (this.sessionId !== id) this.switchSession(id);
    this.publishSnapshot("reveal");
  }

  private resetAgent(): void {
    this.agent = null;
    this.agentSessionId = null;
    this.agentInstructions = null;
    this.view = createSessionView();
  }

  private projectDraft(workingDirectory?: string): NewChatDraft {
    return (
      this.deps.store.newChatDraft(workingDirectory ?? null) ?? this.emptyDraft(workingDirectory)
    );
  }

  private switchSession(id: string | null, draft?: NewChatDraft): void {
    this.gitCommit = undefined;
    this.messageRollback = undefined;
    this.sessionId = id;
    if (!id) this.newChatDraft = draft ?? this.emptyDraft();
  }

  private sessionFileChange(
    sessionId: string,
    changeId: string,
  ): {
    messages: AgentMessage[];
    index: number;
    message: ToolResultMessage;
    change: RecordedFileChange;
  } {
    if (this.sessionId !== sessionId) throw new Error("会话已切换，请重新打开文件变更。");
    const messages =
      this.agentSessionId === sessionId &&
      this.agent &&
      (this.run?.state.sessionId === sessionId || !this.deps.store.checkpoint(sessionId))
        ? this.agent.state.messages
        : this.deps.store.read(sessionId).messages;
    for (const [index, message] of messages.entries()) {
      if (message.role !== "toolResult") continue;
      const change = readFileChange(message.toolName, message.details);
      if (change?.summary.id === changeId) return { messages, index, message, change };
    }
    throw new Error("找不到这条文件变更。");
  }

  async getGitChanges(composerId: string, live = false): Promise<GitChangesView | null> {
    this.checkComposerId(composerId);
    const sessionId = this.sessionId;
    const run = this.run?.state.sessionId === sessionId ? this.run : undefined;
    const directory = this.getWorkingDirectory();
    if (!live && run?.gitChangesAtEnd) return run.gitChangesAtEnd;
    const interrupted = !run && sessionId ? this.deps.store.checkpoint(sessionId) : undefined;
    if (!run && !interrupted && sessionId) {
      const saved = this.gitRecord(sessionId, directory);
      if (saved) {
        if (!live) return finishedGitView(saved);
        const current = await captureGitSnapshot(directory);
        this.checkComposerId(composerId);
        return this.liveGitView(saved, current);
      }
    }

    const baseline = run ? await run.gitBaseline : interrupted?.gitBaseline;
    const current = await captureGitSnapshot(directory);
    this.checkComposerId(composerId);
    if (!live && run?.gitChangesAtEnd) return run.gitChangesAtEnd;
    const view = compareGitSnapshots(
      baseline,
      current,
      run ? "running" : interrupted ? "interrupted" : "workspace",
      Boolean(interrupted || run?.resumed),
    );
    if (live && view?.changes) view.changes = view.changes.filter((change) => !change.resolved);
    return view;
  }

  private liveGitView(saved: SavedGitChanges, current: GitSnapshot): GitChangesView {
    const ended = saved.checkpoint?.snapshot ?? saved.snapshot;
    const previous = finishedGitView(saved);
    const paths = new Set(previous.changes?.map((change) => change.path));
    const original = new Map(
      previous.changes?.map((change) => [change.area + ":" + change.path, change]),
    );
    const view = compareGitSnapshots(undefined, current, "workspace");
    const unchanged = new Set(
      (ended &&
        compareGitSnapshots(ended, current, "finished")
          ?.changes?.filter((change) => change.origin === "existing")
          .map((change) => change.area + ":" + change.path)) ||
        [],
    );
    return {
      phase: "workspace",
      hasHistory: true,
      checkpoint: previous.checkpoint,
      changes:
        view?.changes?.map((change) => {
          const key = change.area + ":" + change.path;
          const recorded = original.get(key);
          const origin =
            unchanged.has(key) && recorded
              ? recorded.origin
              : paths.has(change.path)
                ? "mixed"
                : "existing";
          return { ...change, origin };
        }) ?? null,
    };
  }

  private settleGitRollback(checkpoint: GitTaskCheckpoint, directory: string): GitTaskCheckpoint {
    const operation = checkpoint.pending;
    if (!operation) return checkpoint;
    const current = readGitWorktreeFile(directory, checkpoint.snapshot.root, operation.path);
    const files = checkpoint.files.map((file): GitCheckpointFile => {
      if (file.path !== operation.path) return file;
      if (sameGitFile(current, operation.after))
        return { ...file, after: operation.after, revision: operation.revision };
      return sameGitFile(current, file.after) ? file : { ...file, conflict: "later-edit" };
    });
    return { ...checkpoint, files, pending: undefined };
  }

  private gitRecord(id: string, directory: string | undefined): SavedGitChanges | undefined {
    const saved = this.deps.store.lastGitChanges(id);
    if (!saved || saved.workingDirectory !== (directory ?? null)) return;
    if (!saved.checkpoint?.pending || !directory || this.applyingGitRollback) return saved;
    const checkpoint = this.settleGitRollback(saved.checkpoint, directory);
    const recovered = { ...saved, checkpoint };
    const { messages, checkpoint: running } = this.deps.store.read(id);
    this.deps.store.writeTranscript(id, messages, running, recovered);
    return recovered;
  }

  private selectedGitCheckpoint(
    composerId: string,
    id: string,
    path: string,
  ): {
    saved: SavedGitChanges;
    checkpoint: GitTaskCheckpoint;
    file: GitCheckpointFile;
    directory: string;
  } {
    this.checkComposerId(composerId);
    const directory = this.getWorkingDirectory();
    const saved =
      this.sessionId && directory ? this.gitRecord(this.sessionId, directory) : undefined;
    const checkpoint = saved?.checkpoint;
    const file = checkpoint?.files.find((entry) => entry.path === path);
    if (
      !saved ||
      !directory ||
      !checkpoint ||
      checkpoint.id !== id ||
      !file ||
      this.deps.store.checkpoint(composerId)
    )
      throw new Error("检查点已更新，请重新预览撤销范围。");
    return { saved, checkpoint, file, directory };
  }

  getGitCheckpointDiff(composerId: string, id: string, path: string): GitCheckpointDiff {
    const { checkpoint, file, directory } = this.selectedGitCheckpoint(composerId, id, path);
    return gitCheckpointDiff(directory, checkpoint, file);
  }

  private async gitDiffContext(
    composerId: string,
    request: GitDiffRequest,
  ): Promise<{
    snapshot: GitSnapshot;
    change: NonNullable<GitChangesView["changes"]>[number];
    saved?: SavedGitChanges;
  }> {
    if (request.live) {
      this.checkComposerId(composerId);
      const snapshot = await captureGitSnapshot(this.getWorkingDirectory());
      this.checkComposerId(composerId);
      const change = compareGitSnapshots(undefined, snapshot, "workspace")?.changes?.find(
        ({ area, path }) => request.area === area && request.path === path,
      );
      if (!change) throw new Error("找不到这条文件变更。");
      return { snapshot, change };
    }
    const view = await this.getGitChanges(composerId);
    this.checkComposerId(composerId);
    const change = view?.changes?.find(
      ({ area, path }) => request.area === area && request.path === path,
    );
    if (!change) throw new Error("找不到这条文件变更。");
    const directory = this.getWorkingDirectory();
    const saved =
      this.sessionId && view?.phase === "finished" && this.run?.state.sessionId !== this.sessionId
        ? this.gitRecord(this.sessionId, directory)
        : undefined;
    const snapshot = saved?.checkpoint?.snapshot ?? (await captureGitSnapshot(directory));
    this.checkComposerId(composerId);
    return { snapshot, saved, change };
  }

  async getGitFileDiff(composerId: string, request: GitDiffRequest): Promise<GitFileDiff> {
    const { snapshot, saved, change } = await this.gitDiffContext(composerId, request);
    const directory = this.getWorkingDirectory();
    if (!directory || !snapshot || !("root" in snapshot)) return { diff: null, canOpen: false };
    try {
      const review = request.live ? await readGitSelection(directory, snapshot, change) : undefined;
      const diff = await gitFileDiff(
        directory,
        snapshot,
        change,
        saved?.checkpoint?.files.find(({ path }) => path === change.path)?.after,
        review?.partial?.diff,
      );
      return {
        ...diff,
        revision: review?.revision,
        selectableHunks: review?.partial && diff.diff ? true : undefined,
        patch:
          !diff.diff?.hunks.length && review?.patch.length
            ? displayGitPatch(review.patch)
            : undefined,
      };
    } catch (error) {
      throw gitActionError(error);
    }
  }

  private gitActionDirectory(composerId: string): string {
    this.checkComposerId(composerId);
    if (this.applyingGitSelection || this.applyingGitRollback)
      throw new Error("正在更新 Git，请稍后重试。");
    if (this.run) throw new Error("请等待当前回复结束后再更新 Git。");
    const directory = this.getWorkingDirectory();
    if (!directory) throw new Error("请先选择工作目录。");
    return directory;
  }

  private checkGitActionSession(composerId: string, directory: string): void {
    this.checkComposerId(composerId);
    this.checkWorkingDirectory(directory);
  }

  private async gitActionSnapshot(directory: string): Promise<GitWorktree> {
    const snapshot = await captureGitSnapshot(directory);
    if (!snapshot || !("root" in snapshot)) throw new Error("无法读取 Git 变更");
    return snapshot;
  }

  async stageGit(composerId: string, selection: GitStageSelection): Promise<void> {
    const directory = this.gitActionDirectory(composerId);
    this.applyingGitSelection = true;
    try {
      const snapshot = await this.gitActionSnapshot(directory);
      await stageGitSelection(directory, snapshot, selection, () =>
        this.checkGitActionSession(composerId, directory),
      );
      this.gitCommit = undefined;
    } catch (error) {
      throw gitActionError(error);
    } finally {
      this.applyingGitSelection = false;
    }
  }

  async previewGitCommit(
    composerId: string,
    selections: GitPatchSelection[],
  ): Promise<GitCommitPreview> {
    const directory = this.gitActionDirectory(composerId);
    try {
      const snapshot = await this.gitActionSnapshot(directory);
      const { plan, branch, patch } = await previewGitCommit(directory, snapshot, selections);
      if (this.gitActionDirectory(composerId) !== directory)
        throw new Error("Git 变更已更新，请重新查看差异。");
      const token = randomUUID();
      this.gitCommit = { composerId, directory, token, plan };
      return { token, branch, patch };
    } catch (error) {
      throw gitActionError(error);
    }
  }

  async commitGit(composerId: string, token: string, message: string): Promise<GitCommitResult> {
    const directory = this.gitActionDirectory(composerId);
    const operation = this.gitCommit;
    if (
      !operation ||
      operation.composerId !== composerId ||
      operation.token !== token ||
      operation.directory !== directory
    )
      throw new Error("Git 分支或暂存区已变更，请重新预览提交。");
    this.gitCommit = undefined;
    this.applyingGitSelection = true;
    try {
      const snapshot = await this.gitActionSnapshot(directory);
      if (snapshot.root !== operation.plan.root)
        throw new Error("Git 分支或暂存区已变更，请重新预览提交。");
      return await applyGitCommit(operation.plan, message, () =>
        this.checkGitActionSession(composerId, directory),
      );
    } catch (error) {
      throw gitActionError(error);
    } finally {
      this.applyingGitSelection = false;
    }
  }

  async getGitEditorPath(
    composerId: string,
    request: GitDiffRequest,
    line: number,
  ): Promise<string> {
    const { snapshot } = await this.gitDiffContext(composerId, request);
    const directory = this.getWorkingDirectory();
    if (!directory || !snapshot || !("root" in snapshot))
      throw new Error("无法在编辑器中打开该行。");
    const current = readGitWorktreeFile(directory, snapshot.root, request.path);
    if (!current || line > Math.max(1, textLines(current.text).length))
      throw new Error("无法在编辑器中打开该行。");
    return gitFilePath(directory, snapshot.root, request.path);
  }

  async previewGitRollback(
    composerId: string,
    selection: GitRollbackSelection,
  ): Promise<GitRollbackPreview> {
    if (this.run || this.applyingGitRollback) throw new Error("请等待当前回复结束后再撤销。");
    const { checkpoint, directory, file } = this.selectedGitCheckpoint(
      composerId,
      selection.checkpointId,
      selection.path,
    );
    await verifyGitRollback(directory, checkpoint.snapshot, [file]);
    const current = this.selectedGitCheckpoint(composerId, checkpoint.id, file.path);
    if (this.run || this.applyingGitRollback) throw new Error("请等待当前回复结束后再撤销。");
    const after = rollbackTarget(directory, current.checkpoint, current.file, selection);
    const token = randomUUID();
    this.gitRollback = {
      token,
      sessionId: composerId,
      checkpointId: checkpoint.id,
      file: current.file,
      after,
    };
    return {
      token,
      path: file.path,
      operation: after ? (file.after ? "modify" : "create") : "delete",
      diff: buildTextDiff(file.after?.text ?? null, after?.text ?? "").diff,
    };
  }

  async applyGitRollback(composerId: string, token: string): Promise<void> {
    this.checkComposerId(composerId);
    if (this.applyingGitSelection) throw new Error("正在更新 Git，请稍后重试。");
    if (this.run || this.applyingGitRollback) throw new Error("请等待当前回复结束后再撤销。");
    const operation = this.gitRollback;
    if (!operation || operation.token !== token || operation.sessionId !== composerId)
      throw new Error("检查点已更新，请重新预览撤销范围。");
    this.gitRollback = undefined;
    this.applyingGitRollback = true;
    try {
      const { checkpoint, file, directory } = this.selectedGitCheckpoint(
        composerId,
        operation.checkpointId,
        operation.file.path,
      );
      if (file.revision !== operation.file.revision || file.after === undefined)
        throw new Error("检查点已更新，请重新预览撤销范围。");
      await verifyGitRollback(directory, checkpoint.snapshot, [file]);
      const { saved } = this.selectedGitCheckpoint(composerId, checkpoint.id, file.path);
      const { messages } = this.deps.store.read(composerId);
      // If the app closes between the file write and transcript update, compare both recorded versions.
      const journal = {
        ...checkpoint,
        pending: { path: file.path, after: operation.after, revision: randomUUID() },
      };
      this.deps.store.writeTranscript(composerId, messages, undefined, {
        ...saved,
        checkpoint: journal,
      });
      try {
        replaceGitWorktreeFile(
          directory,
          checkpoint.snapshot.root,
          file.path,
          file.after,
          operation.after,
        );
      } finally {
        this.deps.store.writeTranscript(composerId, messages, undefined, {
          ...saved,
          checkpoint: this.settleGitRollback(journal, directory),
        });
      }
    } finally {
      this.applyingGitRollback = false;
    }
  }

  async previewMessageRollback(
    composerId: string,
    messageId: string,
  ): Promise<MessageRollbackPreview> {
    this.checkComposerId(composerId);
    if (!this.sessionId) throw new Error("找不到该会话。");
    if (this.run || this.applyingGitRollback || this.applyingGitSelection)
      throw new Error("请等待当前任务结束后再撤销。");
    const directory = this.getWorkingDirectory();
    this.gitRecord(composerId, directory);
    const store = this.deps.store;
    let record = store.read(composerId);
    if (record.checkpoint && !record.checkpoint.failure)
      throw new Error("此聊天有未结束的任务。请先继续该任务。");
    const previous = record.messageHistory.rollback;
    if (previous) {
      if (previous.directory !== directory) throw new Error("工作目录已变更，无法完成上一次撤销。");
      this.applyingGitRollback = true;
      try {
        await recoverMessageRollbackFiles(previous);
        store.writeTranscript(
          composerId,
          record.messages,
          record.checkpoint,
          record.gitChanges ?? null,
          record.compactions,
          { tasks: record.messageHistory.tasks },
        );
        record = store.read(composerId);
      } finally {
        this.applyingGitRollback = false;
      }
    }
    const plan = await prepareMessageRollback(record, messageId, directory);
    this.checkComposerId(composerId);
    this.checkWorkingDirectory(directory ?? null);
    if (plan.preview.conflicts.length) {
      this.messageRollback = undefined;
      return plan.preview;
    }
    const token = randomUUID();
    this.messageRollback = { token, sessionId: composerId, messageId, revision: plan.revision };
    return { ...plan.preview, token };
  }

  async applyMessageRollback(composerId: string, token: string): Promise<Snapshot> {
    this.checkComposerId(composerId);
    if (this.run || this.applyingGitRollback || this.applyingGitSelection)
      throw new Error("请等待当前任务结束后再撤销。");
    const operation = this.messageRollback;
    if (!operation || operation.token !== token || operation.sessionId !== composerId)
      throw new Error("检查点已更新，请重新预览撤销范围。");
    this.messageRollback = undefined;
    this.applyingGitRollback = true;
    try {
      const store = this.deps.store;
      const record = store.read(composerId);
      const directory = this.getWorkingDirectory();
      const plan = await prepareMessageRollback(record, operation.messageId, directory);
      this.checkComposerId(composerId);
      this.checkWorkingDirectory(directory ?? null);
      if (plan.preview.conflicts.length) throw new Error(plan.preview.conflicts[0].reason);
      if (record.messageHistory.rollback || plan.revision !== operation.revision)
        throw new Error("检查点已更新，请重新预览撤销范围。");
      const { journal } = plan;
      if (journal) {
        store.writeTranscript(
          composerId,
          record.messages,
          record.checkpoint,
          record.gitChanges ?? null,
          record.compactions,
          { ...record.messageHistory, rollback: journal },
        );
      }
      try {
        if (journal) applyMessageRollbackFiles(journal);
        store.finishMessageRollback(composerId, record, plan.endIndex);
      } catch (error) {
        if (journal && store.messageHistory(composerId).rollback) {
          await recoverMessageRollbackFiles(journal);
          store.writeTranscript(
            composerId,
            record.messages,
            record.checkpoint,
            record.gitChanges ?? null,
            record.compactions,
            record.messageHistory,
          );
        }
        throw error;
      }
      this.resetAgent();
      return this.publishSnapshot();
    } finally {
      this.applyingGitRollback = false;
    }
  }

  getFileDiff(sessionId: string, changeId: string): FileDiff {
    const { change } = this.sessionFileChange(sessionId, changeId);
    if (!change.snapshot) throw new Error("此文件没有可用的差异预览。");
    return change.snapshot.diff;
  }

  undoFileChange(sessionId: string, changeId: string): void {
    if (this.applyingGitSelection) throw new Error("正在更新 Git，请稍后重试。");
    if (this.run?.state.sessionId === sessionId || this.applyingGitRollback) {
      throw new Error("请等待当前回复结束后再撤销。");
    }
    const { messages, index, message, change } = this.sessionFileChange(sessionId, changeId);
    if (change.summary.reverted) return;
    const directory = this.getWorkingDirectory();
    const checkpoint = this.gitRecord(sessionId, directory)?.checkpoint;
    const path =
      checkpoint && relativeGitPath(directory, checkpoint.snapshot.root, change.absolutePath);
    if (checkpoint?.files.some((file) => file.path === path))
      throw new Error("请从 Git 任务检查点预览并撤销此文件。");
    restoreFileChange(change, directory);

    const reverted = { ...change.summary, reverted: true };
    const updated = messages.with(index, {
      ...message,
      details: { pilotFileChange: { ...change, summary: reverted } },
    });
    this.deps.store.save(sessionId, updated, this.deps.store.checkpoint(sessionId));
    const event = { type: "file_change" as const, callId: message.toolCallId, change: reverted };
    if (this.agentSessionId === sessionId && this.agent) {
      this.agent.state.messages = updated;
      this.view.messages = applyMessageEvent(this.view.messages, event);
    }
    this.deps.broadcast({ ...event, sessionId });
  }

  publishSnapshot(navigation?: SessionNavigation): Snapshot {
    const snapshot = this.getSnapshot();
    // Selection and run updates share a channel so a live delta cannot overtake its snapshot.
    this.deps.broadcast({ type: "snapshot", snapshot, navigation });
    return snapshot;
  }

  getSnapshot(): Snapshot {
    const sessions = this.deps.store.list();
    const activeRun = this.run?.state ?? null;
    const ownRun = activeRun?.sessionId === this.sessionId ? this.run : undefined;
    const hasLiveMessages = this.sessionId !== null && this.sessionId === this.agentSessionId;
    const checkpoint =
      !ownRun && this.sessionId ? this.deps.store.checkpoint(this.sessionId) : undefined;
    const settings = toPublicSettings(this.deps.getSettings());
    const selected = selectedCatalogModel(settings, this.currentSettings.model);
    const configured = selected
      ? effectiveModelCapabilities(selected.automatic, selected.overrides)
      : null;
    const storedMessages =
      this.sessionId && (!hasLiveMessages || checkpoint)
        ? this.deps.store.load(this.sessionId)
        : [];
    const compactions = this.sessionId ? this.deps.store.compactions(this.sessionId) : [];
    return {
      sessionId: this.sessionId,
      composerId: this.composerId,
      composerDraft: this.sessionId
        ? this.deps.store.loadDraft(this.sessionId)
        : this.newChatDraft.draft,
      draftImages: this.deps.store.loadDraftImages(this.composerId),
      draftSettings: this.sessionId ? {} : this.newChatDraft.settings,
      draftWorkingDirectory: this.sessionId ? null : (this.newChatDraft.workingDirectory ?? null),
      sessions,
      recentProjects: this.deps.store.listRecentProjects(sessions),
      messages:
        hasLiveMessages && !checkpoint
          ? this.view.messages
          : this.sessionId
            ? toUiMessages(storedMessages, "s", undefined, compactions)
            : [],
      status: ownRun?.state.status ?? "idle",
      activeRun,
      interruptedRun: this.sessionId
        ? (interruptedRunOf(this.sessionId, checkpoint) ?? null)
        : null,
      failedRun: this.sessionId ? (failedRunOf(this.sessionId, checkpoint) ?? null) : null,
      pendingPermissions: ownRun?.pendingPermissions ?? [],
      error: hasLiveMessages ? this.view.error : null,
      settings,
      usage: hasLiveMessages
        ? { ...this.view.usage }
        : transcriptUsage(storedMessages, compactions),
      contextWindow: ownRun ? this.view.contextWindow : (configured?.contextWindow ?? null),
      contextTokens: hasLiveMessages
        ? this.view.contextTokens
        : contextSize(compactedContext(storedMessages, compactions.at(-1))),
      steerCount: ownRun?.steerCount ?? 0,
    };
  }
}
