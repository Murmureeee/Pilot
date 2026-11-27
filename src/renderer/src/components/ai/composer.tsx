// @env browser
import { cn } from "cn";
import {
  ArrowUpIcon,
  BlocksIcon,
  BookmarkPlusIcon,
  CheckIcon,
  ClipboardListIcon,
  EyeIcon,
  FileIcon,
  FolderIcon,
  ImageOffIcon,
  ImagePlusIcon,
  PlusIcon,
  ShieldCheckIcon,
  SquareIcon,
  ZapIcon,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useImperativeHandle,
  useRef,
  useState,
  type DragEvent,
  type JSX,
  type KeyboardEvent,
  type Ref,
} from "react";

import { ModelRetryLabel } from "@renderer/components/ai/model-feedback";
import { Alert, AlertDescription } from "@renderer/components/ui/alert";
import { Button } from "@renderer/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@renderer/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@renderer/components/ui/dropdown-menu";
import { Input } from "@renderer/components/ui/input";
import { InputGroup, InputGroupAddon } from "@renderer/components/ui/input-group";
import { isDroppedImage, useComposerImages } from "@renderer/hooks/use-composer-images";
import { useWorkspaceSearch } from "@renderer/hooks/use-workspace-search";
import {
  appendComposerDraft,
  composerRange,
  insertComposerMention,
  mentionKey,
  readComposerDraft,
  readComposerSelection,
  restoreComposerDraft,
  selectComposerRange,
} from "@renderer/lib/composer-editor";
import {
  composerEditingShortcut,
  composerEnterAction,
  matchesComposerQuery,
  nextApprovalMode,
  quickMemoryText,
  trimPrompt,
} from "@renderer/lib/composer-shortcuts";
import type { ComposerSelection } from "@renderer/lib/composer/types";
import {
  APPROVAL_MODE_OPTIONS,
  COMPOSER_SURFACE_CLASS,
  PERMISSION_ATTENTION_TEXT,
} from "@renderer/lib/constants";
import { localizeError, t, useLocale } from "@renderer/lib/i18n";
import { loadSendKey } from "@renderer/lib/preferences";
import type {
  ComposerShortcuts,
  ComposerSuggestion,
  ComposerToolbarMenu,
  WorkbenchCommand,
} from "@renderer/lib/types";
import {
  selectApprovalMode,
  selectComposerSettings,
  selectCurrentRun,
  selectProjectBinding,
  selectWorkspaceRun,
  useAgentStore,
} from "@renderer/stores/agent";
import { compactFocus } from "@shared/compact-command";
import {
  APP_NAME,
  IMAGE_ATTACHMENT_MIME_TYPES,
  MAX_CONCURRENT_RUNS,
  WORKSPACE_QUERY_LENGTH,
} from "@shared/constants";
import type { ApprovalMode, ComposerDraft, PromptMention, SkillMeta } from "@shared/contract";
import { imagesFromMessageParts } from "@shared/image-attachments";
import { draftFromMessageParts, promptFromDraft } from "@shared/mentions";
import { effectiveModelCapabilities } from "@shared/model-capabilities";
import { selectedCatalogModel } from "@shared/providers";

import { ComposerModelControls } from "./composer-model-controls";
import { ComposerCaretMenu, ComposerSuggestions } from "./composer-suggestions";
import { ContextUsage } from "./context-usage";
import { ImageAttachments } from "./image-attachments";
import { MemoryDialog } from "./memory-dialog";

// 语义色分级（AGENTS.md）：红 = 破坏性动作；amber 橙 = 风险提示（警觉但不吓退）；灰 = 常态
type ModeTone = "neutral" | "amber";

const MODE_META: Record<
  ApprovalMode,
  { label: string; description: string; icon: typeof ShieldCheckIcon; tone: ModeTone }
> = {
  standard: {
    ...APPROVAL_MODE_OPTIONS.standard,
    icon: ShieldCheckIcon,
    tone: "neutral",
  },
  "read-only": {
    ...APPROVAL_MODE_OPTIONS["read-only"],
    icon: EyeIcon,
    tone: "neutral",
  },
  "full-access": {
    ...APPROVAL_MODE_OPTIONS["full-access"],
    icon: ZapIcon,
    tone: "amber",
  },
};

const TONE_TEXT: Record<ModeTone, string> = {
  neutral: "",
  amber: PERMISSION_ATTENTION_TEXT,
};

const TONE_BADGE: Record<ModeTone, string> = {
  neutral: "bg-muted text-foreground hover:bg-accent",
  amber: "bg-amber-500/10 text-amber-800 hover:bg-amber-500/20 dark:text-amber-400",
};

export function Composer({
  composerId,
  workingDirectory,
  projectDirectory,
  shortcutRef,
  showStopHint,
  commands,
}: {
  composerId: string;
  workingDirectory: string | null;
  projectDirectory: string | null;
  shortcutRef: Ref<ComposerShortcuts>;
  showStopHint: boolean;
  commands: readonly WorkbenchCommand[];
}): JSX.Element {
  const locale = useLocale();
  const status = useAgentStore((s) => s.status);
  const busy = status !== "idle";
  const settings = useAgentStore((s) => s.settings);
  const steerCount = useAgentStore((s) => s.steerCount);
  const usage = useAgentStore((s) => s.usage);
  const sessionId = useAgentStore((s) => s.sessionId);
  const ownRun = useAgentStore(selectCurrentRun);
  const workspaceRun = useAgentStore(selectWorkspaceRun);
  const slotsFull = useAgentStore((s) => s.activeRuns.length >= MAX_CONCURRENT_RUNS);
  const [draft, setDraft] = useState(() => promptFromDraft(useAgentStore.getState().composerDraft));
  const [selection, setSelection] = useState<ComposerSelection | null>(null);
  const [focused, setFocused] = useState(false);
  const [composing, setComposing] = useState(false);
  const [dismissed, setDismissed] = useState<Range | null>(null);
  const [highlighted, setHighlighted] = useState<number | null>(null);
  const [toolbarMenu, setToolbarMenu] = useState<ComposerToolbarMenu | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const [skillError, setSkillError] = useState<string | null>(null);
  const [skills, setSkills] = useState<SkillMeta[]>([]);
  const [loadingSkills, setLoadingSkills] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [blockedSend, setBlockedSend] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [memoryDraft, setMemoryDraft] = useState<string | null>(null);
  const [fileDragging, setFileDragging] = useState(false);
  const [dropPending, setDropPending] = useState(false);
  const [dropError, setDropError] = useState<string | null>(null);
  const editor = useRef<HTMLDivElement>(null);
  const imagePicker = useRef<HTMLInputElement>(null);
  const lastRange = useRef<Range | null>(null);
  const resources = useRef(new Map<string, PromptMention>());
  const pendingMention = useRef<PromptMention | null>(null);
  const pickerInput = useRef<HTMLInputElement>(null);
  const modeUpdating = useRef(false);
  const inlineId = useId();
  const pickerId = useId();
  const imageNoticeId = useId();
  const prompt = useAgentStore((s) => s.prompt);
  const saveDraft = useAgentStore((s) => s.saveDraft);
  const abort = useAgentStore((s) => s.abort);
  const clearQueue = useAgentStore((s) => s.clearQueue);
  const loadSession = useAgentStore((s) => s.loadSession);
  const updateSessionSettings = useAgentStore((s) => s.updateSessionSettings);
  const savedMode = useAgentStore((s) => selectComposerSettings(s).approvalMode);
  const savedModel = useAgentStore((s) => selectComposerSettings(s).model);
  const planning = useAgentStore((s) => Boolean(selectComposerSettings(s).planMode));
  const selectProject = useAgentStore((s) => s.selectProject);
  const choosingProject = useAgentStore((s) => s.choosingProject);
  const projectError = useAgentStore((s) => s.projectError);

  const attachments = useComposerImages(composerId);
  const model = settings && selectedCatalogModel(settings, savedModel);
  const supportsImages = Boolean(
    model && effectiveModelCapabilities(model.automatic, model.overrides).supportsImages,
  );
  const textRun = ownRun?.modelCapabilities?.supportsImages === false;
  const imagesBlocked = attachments.images.length > 0 && (!supportsImages || textRun);
  const noticeRun = ownRun ? null : workspaceRun;
  const capacityBlocked = !ownRun && !noticeRun && slotsFull;
  const runTitle = useAgentStore(
    (s) => s.sessions.find(({ id }) => id === noticeRun?.sessionId)?.title,
  );

  const mode = useAgentStore(selectApprovalMode);
  const modeMeta = MODE_META[mode];
  const ModeIcon = modeMeta.icon;
  const isDismissed =
    dismissed &&
    selection?.caret.startContainer === dismissed.startContainer &&
    selection.caret.startOffset === dismissed.startOffset;
  const rawTrigger = !composing && !pickerOpen && toolbarMenu === null ? selection?.trigger : null;
  const trigger = focused && !isDismissed ? rawTrigger : null;
  const mentionOpen = trigger?.kind === "mention";
  const skillSearchOpen = trigger?.kind === "command" || mentionOpen;
  const workspaceQuery = pickerOpen ? pickerQuery : mentionOpen ? trigger.query : null;
  const workspace = useWorkspaceSearch(workingDirectory, workspaceQuery);

  const attachEditor = useCallback((field: HTMLDivElement | null): void => {
    editor.current = field;
    if (field) {
      restoreComposerDraft(field, useAgentStore.getState().composerDraft, resources.current);
    }
  }, []);

  const updateSelection = useCallback((): void => {
    const field = editor.current;
    if (!field || document.activeElement !== field) return;
    const range = composerRange(field);
    lastRange.current = range;
    setSelection(range ? readComposerSelection(field, range) : null);
  }, []);

  useEffect(() => {
    document.addEventListener("selectionchange", updateSelection);
    return () => document.removeEventListener("selectionchange", updateSelection);
  }, [updateSelection]);

  useEffect(() => {
    if (!skillSearchOpen) return;
    let cancelled = false;
    setLoadingSkills(true);
    setSkillError(null);
    void window.pi
      .skillsList(composerId)
      .then((next) => {
        if (!cancelled) setSkills(next);
      })
      .catch((error: unknown) => {
        if (!cancelled) setSkillError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!cancelled) setLoadingSkills(false);
      });
    return () => {
      cancelled = true;
    };
  }, [composerId, skillSearchOpen, workingDirectory]);

  const readEditor = (): void => {
    if (!editor.current) return;
    const next = readComposerDraft(editor.current, resources.current);
    setDraft(promptFromDraft(next));
    setSendError(null);
    setBlockedSend(false);
    void saveDraft(composerId, next).catch((error: unknown) => {
      if (useAgentStore.getState().composerDraft === next) {
        setSendError(error instanceof Error ? error.message : String(error));
      }
    });
    setDismissed(null);
    setHighlighted(null);
    updateSelection();
  };

  const pickDirectory = async (): Promise<void> => {
    await selectProject({
      sessionId: selectProjectBinding(useAgentStore.getState()),
    });
    (pickerInput.current ?? editor.current)?.focus();
  };

  const closePicker = (): void => {
    setPickerOpen(false);
    setPickerQuery("");
    setHighlighted(null);
  };

  const insertMention = (mention: PromptMention, range: Range | null): void => {
    if (!editor.current) return;
    insertComposerMention(editor.current, range, mention, resources.current);
    readEditor();
  };

  const dropFiles = async (event: DragEvent<HTMLDivElement>): Promise<void> => {
    const files = Array.from(event.dataTransfer.files);
    if (!files.length) return;
    event.preventDefault();
    setFileDragging(false);
    if (submitting || dropPending) return;
    setDropError(null);
    const pictures = files.filter(isDroppedImage);
    void attachments.add(pictures);
    if (pictures.length === files.length) return;
    if (!workingDirectory) {
      setDropError("请先打开工作目录，再拖入要引用的文件。");
      return;
    }
    const field = editor.current;
    const caret = document.caretRangeFromPoint(event.clientX, event.clientY);
    setDropPending(true);
    try {
      const paths = [
        ...new Set(
          files
            .filter((file) => !isDroppedImage(file))
            .map((file) => window.pi.getPathForFile(file)),
        ),
      ];
      const references = await window.pi.resolveDroppedPaths(
        composerId,
        workingDirectory,
        paths.filter(Boolean),
      );
      if (!field || field !== editor.current || useAgentStore.getState().composerId !== composerId)
        return;
      let range = caret && field.contains(caret.commonAncestorContainer) ? caret : null;
      for (const reference of references) {
        insertComposerMention(field, range, reference, resources.current);
        range = composerRange(field);
      }
      if (references.length) readEditor();
      if (references.length !== paths.length)
        setDropError("有些文件无法引用。请确认文件仍在当前工作目录内。");
    } catch (cause) {
      setDropError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setDropPending(false);
    }
  };

  const chooseMention = (mention: PromptMention): void => {
    if (pickerOpen) {
      pendingMention.current = mention;
      closePicker();
    } else if (trigger) {
      insertMention(mention, trigger.range);
    }
  };

  const runCommand = async (
    command: WorkbenchCommand,
    range: Range,
    argument?: string,
  ): Promise<void> => {
    const field = editor.current;
    if (!field) return;
    const replace = (text = ""): void => {
      if (!field.isConnected || !field.contains(range.commonAncestorContainer)) return;
      selectComposerRange(field, range);
      document.execCommand(text ? "insertText" : "delete", false, text);
      readEditor();
    };
    try {
      if (!command.insertsPrompt) replace();
      await command.run({ argument, insert: replace });
    } catch (error) {
      setSendError(error instanceof Error ? error.message : String(error));
    }
  };

  const options: ComposerSuggestion[] = [];
  const attached = new Set(draft.mentions.map(mentionKey));
  const addMention = (
    mention: PromptMention,
    detail: string | undefined,
    icon: ComposerSuggestion["icon"],
    group?: string,
    shortcut?: string,
  ): void => {
    const id = mentionKey(mention);
    options.push({
      id,
      label: mention.label,
      detail,
      group,
      shortcut,
      icon,
      attached: attached.has(id),
      select: () => chooseMention(mention),
    });
  };
  const matchedCommands =
    rawTrigger?.kind === "command"
      ? commands.filter((command) => {
          if (!command.slash) return false;
          const query = rawTrigger.query;
          return [
            command.slash,
            ...(command.slashAliases ?? []),
            command.label,
            t(command.label, locale),
          ].some((label) => matchesComposerQuery(label, query));
        })
      : [];
  const matchedSkills = rawTrigger
    ? skills.filter((skill) => {
        const available = rawTrigger.kind === "command" || skill.enabled;
        return (
          available &&
          [skill.name, skill.id].some((label) => matchesComposerQuery(label, rawTrigger.query))
        );
      })
    : [];
  if (trigger?.kind === "command") {
    const term = trigger.query.normalize("NFKC").toLowerCase();
    for (const command of matchedCommands) {
      const name = command.slashAliases?.find((alias) => alias === term) ?? command.slash;
      options.push({
        id: command.id,
        label: t(command.label, locale),
        detail: command.description && t(command.description, locale),
        shortcut: "/" + name,
        icon: command.icon,
        attached: command.checked,
        select: () => void runCommand(command, trigger.range.cloneRange()),
      });
    }
  }
  if (trigger) {
    for (const skill of matchedSkills) {
      addMention(
        {
          type: "skill",
          id: skill.id,
          label: skill.name,
          meta: {
            description: skill.description,
            workingDirectory:
              skill.source === "installed" ? undefined : (workingDirectory ?? undefined),
          },
        },
        [skill.description, skill.source === "installed" ? "" : skill.source]
          .filter(Boolean)
          .join(" · "),
        BlocksIcon,
        t("技能", locale),
        trigger.kind === "command" ? "/" + (skill.id.split("/").at(-1) ?? skill.id) : undefined,
      );
    }
  }
  if (workspaceQuery !== null) {
    if (workingDirectory === null) {
      if (!choosingProject)
        options.push({
          id: "working-directory",
          label: t(sessionId ? "关联项目…" : "打开项目…", locale),
          icon: FolderIcon,
          select: () => void pickDirectory(),
        });
    } else {
      for (const { path, kind } of workspace.entries) {
        const label = path.split("/").at(-1) ?? path;
        addMention(
          { type: kind, id: path, label, meta: { workingDirectory } },
          path !== label ? path : undefined,
          kind === "directory" ? FolderIcon : FileIcon,
          mentionOpen ? t("工作目录", locale) : undefined,
        );
      }
    }
  }
  const exactShortcut =
    trigger?.kind === "command" ? "/" + trigger.query.normalize("NFKC").toLowerCase() : null;
  const exactIndex = options.findIndex(({ shortcut }) => shortcut?.toLowerCase() === exactShortcut);
  const activeIndex = Math.min(highlighted ?? Math.max(0, exactIndex), options.length - 1);
  const pending = workspace.pending || choosingProject || (skillSearchOpen && loadingSkills);
  const feedback = t(pending ? "加载中…" : "没有匹配的结果", locale);
  const workspaceError =
    workspaceQuery !== null && !workingDirectory ? projectError : workspace.error;
  const lookupError = workspaceError ?? (skillSearchOpen ? skillError : undefined);
  const localizedLookupError = lookupError ? localizeError(lookupError, locale) : undefined;
  const commandPending =
    rawTrigger?.kind === "command" &&
    (!isDismissed || matchedCommands.length > 0 || matchedSkills.length > 0);
  const commandText =
    draft.mentions.length === 0 && !attachments.images.length
      ? draft.text.trim().normalize("NFKC").toLowerCase()
      : "";
  const focus = compactFocus(commandText ? draft.text : "");
  const standalone = commandText.startsWith("/")
    ? commands.find(({ id, slash, slashAliases }) =>
        focus === undefined
          ? slash && [slash, ...(slashAliases ?? [])].includes(commandText.slice(1))
          : id === "compact",
      )
    : undefined;
  const shouldRunCommand = Boolean(standalone) || focus !== undefined;
  const memoryText = attachments.images.length ? undefined : quickMemoryText(draft);
  const sendLabel = t(memoryText ? "审阅记忆…" : "发送", locale);
  const canSend =
    status !== "stopping" &&
    !composing &&
    !imagesBlocked &&
    !attachments.pending &&
    !dropPending &&
    (draft.text.trim().length > 0 || attachments.images.length > 0) &&
    (memoryText !== undefined || (shouldRunCommand ? Boolean(standalone) : !commandPending));
  const placeholder = busy
    ? t("输入插话消息…", locale)
    : planning
      ? t("描述要规划的任务…", locale)
      : t("给 {0} 发消息…", locale, [APP_NAME]);

  const send = async (asMessage = false): Promise<void> => {
    if (!canSend || submitting) return;
    if (memoryText !== undefined && !asMessage) {
      setMemoryDraft(memoryText);
      return;
    }
    if (!asMessage && standalone && editor.current) {
      const range = document.createRange();
      range.selectNodeContents(editor.current);
      await runCommand(standalone, range, focus);
      return;
    }
    setSubmitting(true);
    setSendError(null);
    setBlockedSend(false);
    try {
      const input = attachments.images.length ? { ...draft, images: attachments.images } : draft;
      const result = await prompt(trimPrompt(input), workingDirectory, composerId);
      if (result === true) {
        editor.current?.replaceChildren();
        resources.current.clear();
        lastRange.current = null;
        setDraft({ text: "", mentions: [] });
        setSelection(null);
      } else if (result) {
        setBlockedSend(true);
        if (result.kind === "workspace" && result.run.runId !== noticeRun?.runId)
          void window.pi.getSnapshot().catch(() => {});
      }
    } catch (error) {
      setSendError(error instanceof Error ? error.message : String(error));
    } finally {
      setSubmitting(false);
    }
  };

  const changeApprovalMode = (approvalMode: ApprovalMode | null): void => {
    if (modeUpdating.current) return;
    setSendError(null);
    modeUpdating.current = true;
    void updateSessionSettings({ approvalMode })
      .catch((error: unknown) =>
        setSendError(error instanceof Error ? error.message : String(error)),
      )
      .finally(() => {
        modeUpdating.current = false;
      });
  };

  const cycleMode = (): void => {
    changeApprovalMode(nextApprovalMode(selectApprovalMode(useAgentStore.getState())));
  };

  const recallMessage = (): void => {
    const state = useAgentStore.getState();
    const field = editor.current;
    if (!field || state.composerDraft.length !== 0 || state.draftImages.length) return;
    const previous = state.messages.findLast(({ role }) => role === "user");
    if (!previous) return;
    restoreComposerDraft(
      field,
      draftFromMessageParts(previous.parts, workingDirectory),
      resources.current,
    );
    selectComposerRange(field, null);
    readEditor();
    const images = imagesFromMessageParts(previous.parts);
    if (images.length) void attachments.replace(images);
  };

  const appendPrompt = (text: string): void => {
    const field = editor.current;
    if (!field) return;
    const separator = draft.text.trim() ? "\n\n" : "";
    selectComposerRange(field, null);
    document.execCommand("insertText", false, separator + text);
    readEditor();
  };

  const appendDraft = (parts: ComposerDraft): boolean => {
    const field = editor.current;
    if (!field || submitting) return false;
    const batch = draft.text.trim() ? ["\n\n", ...parts] : parts;
    if (!appendComposerDraft(field, batch, resources.current)) return false;
    readEditor();
    return true;
  };

  useImperativeHandle(shortcutRef, (): ComposerShortcuts => ({
    cycleMode,
    recallMessage,
    openMenu: setToolbarMenu,
    appendPrompt,
    appendDraft,
  }));

  const onSuggestionKey = (event: KeyboardEvent<HTMLElement>): boolean => {
    if (!trigger && !pickerOpen) return false;
    if (event.key === "Escape" && trigger) {
      event.preventDefault();
      setDismissed(selection?.caret ?? null);
      return true;
    }
    if ((event.key === "ArrowDown" || event.key === "ArrowUp") && options.length > 0) {
      event.preventDefault();
      const offset = event.key === "ArrowDown" ? 1 : -1;
      setHighlighted(Math.max(0, Math.min(options.length - 1, activeIndex + offset)));
      return true;
    }
    if (
      event.key === "Enter" &&
      !event.shiftKey &&
      (activeIndex >= 0 || pending || trigger?.kind === "command")
    ) {
      event.preventDefault();
      options[activeIndex]?.select();
      return true;
    }
    return false;
  };

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
    if (event.defaultPrevented || composing || event.nativeEvent.isComposing) return;
    const action = composerEnterAction(event, loadSendKey());
    if (
      standalone &&
      highlighted === null &&
      event.key === "Enter" &&
      !event.shiftKey &&
      (focus === undefined || action === "send")
    ) {
      event.preventDefault();
      void send();
      return;
    }
    if (!(memoryText !== undefined && action === "send") && onSuggestionKey(event)) return;
    const shortcut = composerEditingShortcut(
      event,
      draft.text.length === 0 && !attachments.images.length,
    );
    if (shortcut === "cycle-approval-mode") {
      event.preventDefault();
      if (!event.repeat) cycleMode();
      return;
    }
    if (shortcut === "recall-message" && !event.repeat) {
      event.preventDefault();
      recallMessage();
      return;
    }
    if (!action) return;
    event.preventDefault();
    if (action === "send") void send();
    // 与 Shift+Enter 的默认行为一致，草稿解析只认 <br> 换行。
    else document.execCommand("insertLineBreak");
  };

  const statusLabel =
    status === "stopping"
      ? "正在停止…"
      : status === "waiting_approval"
        ? "等待操作审批…"
        : ownRun?.compacting
          ? "正在压缩上下文…"
          : "回复中…";
  const runNotice =
    noticeRun?.status === "waiting_approval"
      ? "同一工作区的会话「{0}」等待审批。"
      : noticeRun?.status === "stopping"
        ? "同一工作区的会话「{0}」正在停止。"
        : "同一工作区的会话「{0}」正在运行。";

  return (
    <div className="relative flex w-full min-w-0 flex-col gap-2">
      {!ownRun && (noticeRun || capacityBlocked || blockedSend) && (
        <Alert
          role="status"
          data-run-block
          className="flex flex-wrap items-center justify-between gap-2 px-3 py-2"
        >
          <div className="min-w-0 wrap-anywhere">
            <p>
              {noticeRun
                ? t(runNotice, locale, [runTitle ?? t("新会话", locale)])
                : capacityBlocked
                  ? t("已同时运行 {0} 项任务。等一项结束后再发送。", locale, [MAX_CONCURRENT_RUNS])
                  : t("现在可以再次发送。", locale)}
            </p>
            {blockedSend && <AlertDescription>{t("此消息仍在草稿中。", locale)}</AlertDescription>}
          </div>
          {noticeRun && (
            <Button
              size="xs"
              variant="ghost"
              onClick={() => void loadSession(noticeRun.sessionId, true, true)}
            >
              {t("返回任务会话", locale)}
            </Button>
          )}
        </Alert>
      )}
      {ownRun && (
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-2 text-xs text-muted-foreground">
          <div className="flex flex-wrap items-center gap-2">
            <output
              className={cn(
                "flex items-center gap-2",
                status === "waiting_approval" && PERMISSION_ATTENTION_TEXT,
                status === "streaming" && "text-emerald-700 dark:text-emerald-400",
              )}
            >
              <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
              {status === "streaming" && ownRun.retry ? (
                <ModelRetryLabel
                  key={ownRun.retry.attempt + "/" + ownRun.retry.retryAt}
                  retry={ownRun.retry}
                  locale={locale}
                />
              ) : (
                t(statusLabel, locale)
              )}
            </output>
            {showStopHint && <span role="status">{t("再按一次 Esc 停止任务。", locale)}</span>}
            {steerCount > 0 && (
              <>
                <span>{t("插话排队 {0}", locale, [steerCount])}</span>
                <button
                  type="button"
                  onClick={() => clearQueue(ownRun)}
                  className="underline underline-offset-2 hover:text-foreground"
                >
                  {t("清空排队", locale)}
                </button>
              </>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 tabular-nums">
            <span>
              {usage.input + usage.output} tokens
              {usage.cacheRead + usage.cacheWrite > 0
                ? ` (${t("缓存", locale)} ${usage.cacheRead + usage.cacheWrite})`
                : ""}
            </span>
            <span>${usage.costTotal.toFixed(4)}</span>
          </div>
        </div>
      )}

      {trigger && selection && (
        <ComposerCaretMenu selection={selection}>
          <ComposerSuggestions
            id={inlineId}
            label={t(trigger.kind === "command" ? "快捷操作" : "提及资源", locale)}
            options={options}
            activeIndex={activeIndex}
            setActiveIndex={setHighlighted}
            feedback={feedback}
            error={localizedLookupError}
          />
        </ComposerCaretMenu>
      )}
      {sendError && (
        <p role="alert" className="px-2 text-xs wrap-anywhere text-destructive">
          {localizeError(sendError, locale)}
        </p>
      )}
      <InputGroup
        data-composer-file-drop
        className={cn(COMPOSER_SURFACE_CLASS, fileDragging && "ring-2 ring-ring")}
        onDragOver={(event) => {
          if (!event.dataTransfer.types.includes("Files")) return;
          event.preventDefault();
          event.dataTransfer.dropEffect = "copy";
          setFileDragging(true);
        }}
        onDragLeave={(event) => {
          if (
            !(
              event.relatedTarget instanceof Node &&
              event.currentTarget.contains(event.relatedTarget)
            )
          )
            setFileDragging(false);
        }}
        onDrop={(event) => void dropFiles(event)}
      >
        {planning && (
          <p
            role="status"
            data-plan-mode
            className="flex w-full items-center gap-2 px-3 pt-2 text-xs text-muted-foreground"
          >
            <ClipboardListIcon className="size-3.5" aria-hidden="true" />
            {t("计划模式", locale)}
          </p>
        )}
        <ImageAttachments
          images={attachments.images}
          className="w-full px-3 pt-2"
          remove={(index) => {
            if (submitting) return;
            void attachments.remove(index);
            editor.current?.focus({ preventScroll: true });
          }}
        />
        {attachments.pending && (
          <p role="status" className="px-3 pt-1 text-xs text-muted-foreground">
            {t("正在读取图片…", locale)}
          </p>
        )}
        {(attachments.error || dropError) && (
          <p role="alert" className="px-3 pt-1 text-xs wrap-anywhere text-destructive">
            {attachments.error ?? localizeError(dropError ?? "", locale)}
          </p>
        )}
        {imagesBlocked && (
          <div
            id={imageNoticeId}
            className={cn(
              "flex w-full flex-wrap items-center gap-x-2 gap-y-1 px-3 pt-1 text-xs",
              PERMISSION_ATTENTION_TEXT,
            )}
            role="status"
          >
            <ImageOffIcon aria-hidden="true" className="size-3.5 shrink-0" />
            <span className="min-w-0 flex-1 basis-44">
              {t(
                textRun && supportsImages
                  ? "当前任务使用文本模型。可在任务结束后发送图片，或移除图片。"
                  : "当前模型仅支持文本。请选择支持图像的模型或移除图片。",
                locale,
              )}
            </span>
            {!supportsImages && (
              <Button
                type="button"
                size="xs"
                variant="outline"
                onClick={() => setToolbarMenu("model")}
              >
                {t("选择模型", locale)}
              </Button>
            )}
          </div>
        )}
        <div
          ref={attachEditor}
          contentEditable
          role="textbox"
          aria-multiline="true"
          data-slot="input-group-control"
          data-composer-editor
          className="composer-editor relative max-h-[min(14rem,38dvh)] min-h-[3.75rem] w-full overflow-y-auto px-4 pt-3.5 pb-2 text-sm leading-6 wrap-anywhere whitespace-pre-wrap outline-none"
          aria-label={t("消息", locale)}
          aria-keyshortcuts="Control+L Shift+Tab ArrowUp"
          aria-placeholder={placeholder}
          aria-autocomplete="list"
          aria-controls={trigger ? inlineId : undefined}
          aria-describedby={imagesBlocked ? imageNoticeId : undefined}
          aria-activedescendant={
            trigger && activeIndex >= 0 ? inlineId + "-" + activeIndex : undefined
          }
          data-empty={draft.text.length === 0}
          data-placeholder={placeholder}
          onInput={readEditor}
          onFocus={() => {
            setFocused(true);
            updateSelection();
          }}
          onBlur={() => {
            setFocused(false);
            setSkillError(null);
          }}
          onCompositionStart={() => setComposing(true)}
          onCompositionEnd={() => {
            setComposing(false);
            readEditor();
          }}
          onPaste={(event) => {
            event.preventDefault();
            const images = Array.from(event.clipboardData.files).filter(
              (file) => file.type.startsWith("image/") || isDroppedImage(file),
            );
            if (!submitting) void attachments.add(images);
            const text = event.clipboardData.getData("text/plain");
            if (text) document.execCommand("insertText", false, text);
          }}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
            if (event.dataTransfer.files.length) return;
            event.preventDefault();
            const text = event.dataTransfer.getData("text/plain");
            const range = document.caretRangeFromPoint(event.clientX, event.clientY);
            if (!text || !range || !event.currentTarget.contains(range.commonAncestorContainer))
              return;
            selectComposerRange(event.currentTarget, range);
            document.execCommand("insertText", false, text);
          }}
          onKeyDown={onKeyDown}
        />
        <InputGroupAddon
          align="block-end"
          className="cursor-default items-center justify-between gap-2 p-2 pt-0"
        >
          <div className="flex shrink-0 items-center gap-1">
            <input
              ref={imagePicker}
              data-image-picker
              type="file"
              accept={IMAGE_ATTACHMENT_MIME_TYPES.join(",")}
              multiple
              hidden
              onChange={(event) => {
                const files = Array.from(event.currentTarget.files ?? []);
                event.currentTarget.value = "";
                if (!files.length) return;
                closePicker();
                void attachments.add(files);
              }}
            />
            <Dialog
              open={pickerOpen}
              onOpenChange={(open) => {
                if (open) {
                  setPickerOpen(true);
                  setHighlighted(null);
                } else closePicker();
              }}
              onOpenChangeComplete={(open) => {
                if (open || !pendingMention.current) return;
                const mention = pendingMention.current;
                pendingMention.current = null;
                insertMention(mention, lastRange.current);
              }}
            >
              <DialogTrigger
                render={
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    aria-label={t("引用文件和文件夹", locale)}
                    title={t("引用文件和文件夹", locale)}
                  />
                }
              >
                <PlusIcon />
              </DialogTrigger>
              <DialogContent
                className="gap-3 p-4"
                finalFocus={editor}
                closeLabel={t("关闭", locale)}
              >
                <DialogHeader>
                  <DialogTitle>{t("引用文件和文件夹", locale)}</DialogTitle>
                </DialogHeader>
                <div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => imagePicker.current?.click()}
                  >
                    <ImagePlusIcon data-icon="inline-start" />
                    {t("选择图片…", locale)}
                  </Button>
                </div>
                <Input
                  ref={pickerInput}
                  autoFocus
                  role="combobox"
                  aria-autocomplete="list"
                  aria-expanded={pickerOpen}
                  aria-controls={pickerId}
                  aria-activedescendant={
                    activeIndex >= 0 ? pickerId + "-" + activeIndex : undefined
                  }
                  aria-label={t("搜索文件和文件夹…", locale)}
                  placeholder={t("搜索文件和文件夹…", locale)}
                  maxLength={WORKSPACE_QUERY_LENGTH}
                  value={pickerQuery}
                  onChange={(event) => {
                    setPickerQuery(event.currentTarget.value);
                    setHighlighted(null);
                  }}
                  onKeyDown={(event) => {
                    if (!event.nativeEvent.isComposing) onSuggestionKey(event);
                  }}
                />
                <ComposerSuggestions
                  id={pickerId}
                  label={t("引用文件和文件夹", locale)}
                  options={options}
                  activeIndex={activeIndex}
                  setActiveIndex={setHighlighted}
                  feedback={feedback}
                  error={localizedLookupError}
                />
              </DialogContent>
            </Dialog>
            <DropdownMenu
              open={toolbarMenu === "permissions"}
              onOpenChange={(open) =>
                setToolbarMenu((current) =>
                  open ? "permissions" : current === "permissions" ? null : current,
                )
              }
            >
              <DropdownMenuTrigger
                render={
                  <button
                    type="button"
                    className={cn(
                      "flex min-h-8 items-center gap-1.5 rounded-full px-3 text-xs whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
                      TONE_BADGE[modeMeta.tone],
                    )}
                  />
                }
              >
                <ModeIcon className="size-3.5" />
                {t(modeMeta.label, locale)}
              </DropdownMenuTrigger>
              <span className="sr-only" role="status">
                {t("会话权限模式", locale)} {t(modeMeta.label, locale)}
              </span>
              <DropdownMenuContent
                side="top"
                align="start"
                sideOffset={8}
                className="max-w-[min(24rem,var(--available-width))] min-w-64"
              >
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="font-medium text-foreground">
                    {t("会话权限模式", locale)}
                  </DropdownMenuLabel>
                  <DropdownMenuItem
                    onClick={() => changeApprovalMode(null)}
                    className="items-start gap-2.5 py-2"
                  >
                    <ShieldCheckIcon className="mt-0.5 shrink-0" aria-hidden="true" />
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className="text-sm leading-5">{t("跟随全局默认", locale)}</span>
                      <span className="text-xs leading-4 text-muted-foreground">
                        {t(
                          APPROVAL_MODE_OPTIONS[settings?.approvalMode ?? "standard"].label,
                          locale,
                        )}
                      </span>
                    </span>
                    {!savedMode && <CheckIcon className="mt-0.5 shrink-0" aria-hidden="true" />}
                  </DropdownMenuItem>
                  <DropdownMenuSeparator />
                  {(Object.keys(MODE_META) as ApprovalMode[]).map((m) => {
                    const meta = MODE_META[m];
                    const Icon = meta.icon;
                    const current = savedMode === m;
                    return (
                      // 规范（AGENTS.md）：主标题 + 上下结构的次级说明行（muted + 小字号）；选中态用右侧 ✓；
                      // 图标带语义色时，标题文字跟随同色（主次一体）
                      <DropdownMenuItem
                        key={m}
                        onClick={() => changeApprovalMode(m)}
                        className="items-start gap-2.5 py-2"
                      >
                        <Icon className={cn("mt-0.5 size-4 shrink-0", TONE_TEXT[meta.tone])} />
                        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span className={cn("text-sm leading-5", TONE_TEXT[meta.tone])}>
                            {t(meta.label, locale)}
                          </span>
                          <span className="text-xs leading-4 text-muted-foreground">
                            {t(meta.description, locale)}
                          </span>
                        </div>
                        {current && <CheckIcon className="mt-0.5 size-4 shrink-0" />}
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <div className="ms-auto flex min-w-0 items-center gap-2">
            <ContextUsage />
            <ComposerModelControls
              menu={toolbarMenu}
              setMenu={setToolbarMenu}
              onError={setSendError}
            />

            {ownRun ? (
              <Button
                size="icon-lg"
                className="rounded-full"
                onClick={() => abort(ownRun)}
                disabled={status === "stopping"}
                aria-label={t("停止", locale)}
                title={t("停止", locale)}
              >
                <SquareIcon className="size-3.5 fill-current" />
              </Button>
            ) : (
              <Button
                size="icon-lg"
                className="rounded-full disabled:bg-muted disabled:text-muted-foreground disabled:opacity-100"
                disabled={submitting || !canSend}
                onClick={() => void send()}
                aria-label={sendLabel}
                title={sendLabel}
              >
                {memoryText === undefined ? (
                  <ArrowUpIcon className="size-4" />
                ) : (
                  <BookmarkPlusIcon className="size-4" />
                )}
              </Button>
            )}
          </div>
        </InputGroupAddon>
      </InputGroup>
      {memoryDraft !== null && (
        <MemoryDialog
          composerId={composerId}
          projectDirectory={projectDirectory}
          proposal={{ text: memoryDraft }}
          finalFocus={editor}
          onClose={(saved) => {
            setMemoryDraft(null);
            if (saved && editor.current) {
              editor.current.replaceChildren();
              resources.current.clear();
              lastRange.current = null;
              readEditor();
            }
          }}
          onSendAsMessage={() => void send(true)}
        />
      )}
    </div>
  );
}
