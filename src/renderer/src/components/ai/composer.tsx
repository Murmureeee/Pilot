// @env browser
import {
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
  type JSX,
  type KeyboardEvent,
  type RefObject,
} from "react";
import {
  ArrowUpIcon,
  BlocksIcon,
  CheckIcon,
  EyeIcon,
  FileIcon,
  FolderIcon,
  PlusIcon,
  ShieldCheckIcon,
  SquareIcon,
  ZapIcon,
} from "lucide-react";
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
import { InputGroup, InputGroupAddon } from "@renderer/components/ui/input-group";
import { Input } from "@renderer/components/ui/input";
import { useWorkspaceSearch } from "@renderer/hooks/use-workspace-search";
import {
  composerRange,
  insertComposerMention,
  mentionKey,
  readComposerDraft,
  readComposerSelection,
  restoreComposerDraft,
  selectComposerRange,
} from "@renderer/lib/composer-editor";
import {
  matchesComposerQuery,
  promptFromDraft,
  trimPrompt,
} from "@renderer/lib/composer-shortcuts";
import type { ComposerSelection } from "@renderer/lib/composer/types";
import {
  APPROVAL_MODE_OPTIONS,
  COMPOSER_COMMANDS,
  COMPOSER_SURFACE_CLASS,
} from "@renderer/lib/constants";
import { localizeError, t, useLocale } from "@renderer/lib/i18n";
import type {
  ComposerCommand,
  ComposerDraft,
  ComposerSuggestion,
  ComposerToolbarMenu,
} from "@renderer/lib/types";
import { useAgentStore } from "@renderer/stores/agent";
import { APP_NAME, WORKSPACE_QUERY_LENGTH } from "@shared/constants";
import type { ApprovalMode, PromptMention } from "@shared/contract";
import { cn } from "cn";
import { ComposerModelControls } from "./composer-model-controls";
import { ComposerCaretMenu, ComposerSuggestions } from "./composer-suggestions";
import { ContextUsage } from "./context-usage";

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
  amber: "text-amber-600 dark:text-amber-400",
};

const TONE_BADGE: Record<ModeTone, string> = {
  neutral: "bg-muted text-foreground hover:bg-accent",
  amber: "bg-amber-500/10 text-amber-600 hover:bg-amber-500/20 dark:text-amber-400",
};

export function Composer({ savedDraft }: { savedDraft: RefObject<ComposerDraft> }): JSX.Element {
  const locale = useLocale();
  const status = useAgentStore((s) => s.status);
  const busy = status !== "idle";
  const settings = useAgentStore((s) => s.settings);
  const steerCount = useAgentStore((s) => s.steerCount);
  const usage = useAgentStore((s) => s.usage);
  const sessionId = useAgentStore((s) => s.sessionId);
  const [draft, setDraft] = useState(() => promptFromDraft(savedDraft.current));
  const [selection, setSelection] = useState<ComposerSelection | null>(null);
  const [focused, setFocused] = useState(false);
  const [composing, setComposing] = useState(false);
  const [dismissed, setDismissed] = useState<Range | null>(null);
  const [highlighted, setHighlighted] = useState<number | null>(null);
  const [toolbarMenu, setToolbarMenu] = useState<ComposerToolbarMenu | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const [directoryError, setDirectoryError] = useState<string | null>(null);
  const [skillError, setSkillError] = useState<string | null>(null);
  const [loadingSkills, setLoadingSkills] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [pickingDirectory, setPickingDirectory] = useState(false);
  const editor = useRef<HTMLDivElement>(null);
  const lastRange = useRef<Range | null>(null);
  const resources = useRef(new Map<string, PromptMention>());
  const pendingMention = useRef<PromptMention | null>(null);
  const pickerInput = useRef<HTMLInputElement>(null);
  const inlineId = useId();
  const pickerId = useId();
  const prompt = useAgentStore((s) => s.prompt);
  const abort = useAgentStore((s) => s.abort);
  const clearQueue = useAgentStore((s) => s.clearQueue);
  const setApprovalMode = useAgentStore((s) => s.setApprovalMode);
  const newSession = useAgentStore((s) => s.newSession);
  const archiveSession = useAgentStore((s) => s.setSessionArchived);
  const setView = useAgentStore((s) => s.setView);
  const setSettingsSection = useAgentStore((s) => s.setSettingsSection);
  const saveToolEnvironment = useAgentStore((s) => s.saveToolEnvironment);
  const skills = useAgentStore((s) => s.skills);
  const listSkills = useAgentStore((s) => s.listSkills);

  const mode = settings?.approvalMode ?? "standard";
  const modeMeta = MODE_META[mode];
  const ModeIcon = modeMeta.icon;
  const workingDirectory = settings?.workingDirectory ?? null;
  const enabledSkills = settings?.skillsEnabled;
  const isDismissed =
    dismissed &&
    selection?.caret.startContainer === dismissed.startContainer &&
    selection.caret.startOffset === dismissed.startOffset;
  const rawTrigger = !composing && !pickerOpen && toolbarMenu === null ? selection?.trigger : null;
  const trigger = focused && !isDismissed ? rawTrigger : null;
  const mentionOpen = trigger?.kind === "mention";
  const skillSearchOpen =
    trigger?.kind === "command" || (mentionOpen && Boolean(enabledSkills?.length));
  const workspaceQuery = pickerOpen ? pickerQuery : mentionOpen ? trigger.query : null;
  const workspace = useWorkspaceSearch(workingDirectory, workspaceQuery);

  const attachEditor = useCallback(
    (field: HTMLDivElement | null): void => {
      editor.current = field;
      if (field) restoreComposerDraft(field, savedDraft.current, resources.current);
    },
    [savedDraft],
  );

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
    void listSkills()
      .catch((error: unknown) => {
        if (!cancelled) setSkillError(error instanceof Error ? error.message : String(error));
      })
      .finally(() => {
        if (!cancelled) setLoadingSkills(false);
      });
    return () => {
      cancelled = true;
    };
  }, [skillSearchOpen, enabledSkills, listSkills]);

  const readEditor = (): void => {
    if (!editor.current) return;
    savedDraft.current = readComposerDraft(editor.current, resources.current);
    setDraft(promptFromDraft(savedDraft.current));
    setSendError(null);
    setDismissed(null);
    setHighlighted(null);
    updateSelection();
  };

  const pickDirectory = async (): Promise<void> => {
    if (pickingDirectory) return;
    setPickingDirectory(true);
    setDirectoryError(null);
    try {
      const directory = await window.pi.pickWorkingDirectory(locale);
      if (directory !== null) await saveToolEnvironment({ workingDirectory: directory });
    } catch (error) {
      setDirectoryError(error instanceof Error ? error.message : String(error));
    } finally {
      setPickingDirectory(false);
      (pickerInput.current ?? editor.current)?.focus();
    }
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

  const chooseMention = (mention: PromptMention): void => {
    if (pickerOpen) {
      pendingMention.current = mention;
      closePicker();
    } else if (trigger) {
      insertMention(mention, trigger.range);
    }
  };

  const chooseCommand = async (command: ComposerCommand): Promise<void> => {
    if (trigger?.kind !== "command" || !editor.current) return;
    const range = trigger.range.cloneRange();
    range.setEnd(editor.current, editor.current.childNodes.length);
    selectComposerRange(editor.current, range);
    document.execCommand("delete");
    readEditor();
    try {
      await command.action({
        newChat: newSession,
        archiveChat: () => (sessionId ? archiveSession(sessionId, true) : Promise.resolve()),
        openMenu: setToolbarMenu,
        openSettings: (section) => {
          setSettingsSection(section);
          setView("settings");
        },
      });
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
  const commands =
    rawTrigger?.kind === "command"
      ? COMPOSER_COMMANDS.filter((command) => {
          if (command.requiresSession && !sessionId) return false;
          const query = rawTrigger.query;
          return [command.id, command.label, t(command.label, locale)].some((label) =>
            matchesComposerQuery(label, query),
          );
        })
      : [];
  const matchedSkills = rawTrigger
    ? skills.filter((skill) => {
        const available = rawTrigger.kind === "command" || enabledSkills?.includes(skill.id);
        return (
          available &&
          [skill.name, skill.id].some((label) => matchesComposerQuery(label, rawTrigger.query))
        );
      })
    : [];
  if (trigger?.kind === "command") {
    for (const command of commands) {
      options.push({
        id: command.id,
        label: t(command.label, locale),
        detail: t(command.description, locale),
        shortcut: "/" + command.id,
        icon: command.icon,
        select: () => void chooseCommand(command),
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
          meta: { description: skill.description },
        },
        skill.description,
        BlocksIcon,
        t("技能", locale),
        trigger.kind === "command" ? "/" + skill.id : undefined,
      );
    }
  }
  if (workspaceQuery !== null) {
    if (workingDirectory === null) {
      if (!pickingDirectory)
        options.push({
          id: "working-directory",
          label: t("选择工作目录", locale),
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
  const pending = workspace.pending || pickingDirectory || (skillSearchOpen && loadingSkills);
  const feedback = t(pending ? "加载中…" : "没有匹配的结果", locale);
  const workspaceError = workspaceQuery !== null ? (directoryError ?? workspace.error) : undefined;
  const lookupError = workspaceError ?? (skillSearchOpen ? skillError : undefined);
  const localizedLookupError = lookupError ? localizeError(lookupError, locale) : undefined;
  const commandPending =
    rawTrigger?.kind === "command" &&
    (!isDismissed || commands.length > 0 || matchedSkills.length > 0);
  const canSend = !composing && draft.text.trim().length > 0 && !commandPending;
  const placeholder = busy ? t("输入插话消息…", locale) : t("给 {0} 发消息…", locale, [APP_NAME]);

  const send = async (): Promise<void> => {
    if (!canSend || submitting) return;
    const sentDraft = savedDraft.current;
    setSubmitting(true);
    setSendError(null);
    try {
      await prompt(trimPrompt(draft));
      if (savedDraft.current === sentDraft) {
        savedDraft.current = [];
        editor.current?.replaceChildren();
        resources.current.clear();
        lastRange.current = null;
        setDraft({ text: "", mentions: [] });
        setSelection(null);
      }
    } catch (error) {
      setSendError(error instanceof Error ? error.message : String(error));
    } finally {
      setSubmitting(false);
    }
  };

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
    if (composing || event.nativeEvent.isComposing || onSuggestionKey(event)) return;
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  };

  const statusLabel =
    status === "waiting_approval" ? t("等待操作审批…", locale) : t("回复中…", locale);

  return (
    <div className="relative flex w-full min-w-0 flex-col gap-2">
      {busy && (
        <div className="text-muted-foreground flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-2 text-xs">
          <div className="flex flex-wrap items-center gap-2">
            <output
              className={cn(
                "flex items-center gap-2",
                status === "waiting_approval"
                  ? "text-amber-700 dark:text-amber-400"
                  : "text-emerald-700 dark:text-emerald-400",
              )}
            >
              <span aria-hidden="true" className="size-1.5 rounded-full bg-current" />
              {statusLabel}
            </output>
            {steerCount > 0 && (
              <>
                <span>{t("插话排队 {0}", locale, [steerCount])}</span>
                <button
                  type="button"
                  onClick={clearQueue}
                  className="hover:text-foreground underline underline-offset-2"
                >
                  {t("清空排队", locale)}
                </button>
              </>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 tabular-nums">
            <span>
              {usage.input + usage.output} tokens
              {usage.cacheRead > 0 ? ` (${t("缓存", locale)} ${usage.cacheRead})` : ""}
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
        <p role="alert" className="text-destructive wrap-anywhere px-2 text-xs">
          {localizeError(sendError, locale)}
        </p>
      )}
      <InputGroup className={COMPOSER_SURFACE_CLASS}>
        <div
          ref={attachEditor}
          contentEditable
          role="textbox"
          aria-multiline="true"
          data-slot="input-group-control"
          className="composer-editor relative min-h-[3.75rem] max-h-[min(14rem,38dvh)] w-full overflow-y-auto px-4 pt-3.5 pb-2 text-[15px] leading-6 wrap-anywhere whitespace-pre-wrap outline-none"
          aria-label={t("消息", locale)}
          aria-placeholder={placeholder}
          aria-autocomplete="list"
          aria-controls={trigger ? inlineId : undefined}
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
            setDirectoryError(null);
            setSkillError(null);
          }}
          onCompositionStart={() => setComposing(true)}
          onCompositionEnd={() => {
            setComposing(false);
            readEditor();
          }}
          onPaste={(event) => {
            event.preventDefault();
            const text = event.clipboardData.getData("text/plain");
            if (text) document.execCommand("insertText", false, text);
          }}
          onDragOver={(event) => event.preventDefault()}
          onDrop={(event) => {
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
            <Dialog
              open={pickerOpen}
              onOpenChange={(open) => {
                if (open) {
                  setPickerOpen(true);
                  setHighlighted(null);
                  setDirectoryError(null);
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
                      "focus-visible:ring-ring/40 flex min-h-8 items-center gap-1.5 rounded-full px-3 text-xs whitespace-nowrap transition-colors outline-none focus-visible:ring-2",
                      TONE_BADGE[modeMeta.tone],
                    )}
                  />
                }
              >
                <ModeIcon className="size-3.5" />
                {t(modeMeta.label, locale)}
              </DropdownMenuTrigger>
              <DropdownMenuContent
                side="top"
                align="start"
                sideOffset={8}
                className="min-w-64 max-w-[min(24rem,var(--available-width))]"
              >
                <DropdownMenuGroup>
                  <DropdownMenuLabel className="text-foreground font-medium">
                    {t("应如何批准 Agent 操作？", locale)}
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {(Object.keys(MODE_META) as ApprovalMode[]).map((m) => {
                    const meta = MODE_META[m];
                    const Icon = meta.icon;
                    const current = mode === m;
                    return (
                      // 规范（AGENTS.md）：主标题 + 上下结构的次级说明行（muted + 小字号）；选中态用右侧 ✓；
                      // 图标带语义色时，标题文字跟随同色（主次一体）
                      <DropdownMenuItem
                        key={m}
                        onClick={() => void setApprovalMode(m)}
                        className="items-start gap-2.5 py-2"
                      >
                        <Icon className={cn("mt-0.5 size-4 shrink-0", TONE_TEXT[meta.tone])} />
                        <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                          <span className={cn("text-sm leading-5", TONE_TEXT[meta.tone])}>
                            {t(meta.label, locale)}
                          </span>
                          <span className="text-muted-foreground text-xs leading-4">
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

            {busy ? (
              <Button
                size="icon-lg"
                className="rounded-full"
                onClick={abort}
                aria-label={t("停止", locale)}
                title={t("停止", locale)}
              >
                <SquareIcon className="size-3.5 fill-current" />
              </Button>
            ) : (
              <Button
                size="icon-lg"
                className="disabled:bg-muted disabled:text-muted-foreground rounded-full disabled:opacity-100"
                disabled={submitting || !canSend}
                onClick={() => void send()}
                aria-label={t("发送", locale)}
                title={t("发送", locale)}
              >
                <ArrowUpIcon className="size-4" />
              </Button>
            )}
          </div>
        </InputGroupAddon>
      </InputGroup>
    </div>
  );
}
