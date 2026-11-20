// @env browser
import { useId, useRef, useState, type KeyboardEvent } from "react";
import type { JSX } from "react";
import {
  ArrowUpIcon,
  CheckIcon,
  ChevronDownIcon,
  CpuIcon,
  EyeIcon,
  FileIcon,
  FolderIcon,
  PlugIcon,
  PlusIcon,
  ShieldCheckIcon,
  SquarePenIcon,
  SquareIcon,
  XIcon,
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
import {
  InputGroup,
  InputGroupAddon,
  InputGroupTextarea,
} from "@renderer/components/ui/input-group";
import { Input } from "@renderer/components/ui/input";
import { useWorkspaceSearch } from "@renderer/hooks/use-workspace-search";
import { composerTrigger, promptWithReferences } from "@renderer/lib/composer-shortcuts";
import { levelAt, levelIndex, levelLabel, THINKING_LEVELS } from "@renderer/lib/thinking-level";
import { APPROVAL_MODE_OPTIONS } from "@renderer/lib/constants";
import { displayProviderName, localizeError, t } from "@renderer/lib/i18n";
import type { ComposerSuggestion } from "@renderer/lib/types";
import { useAgentStore } from "@renderer/stores/agent";
import { APP_NAME, WORKSPACE_QUERY_LENGTH } from "@shared/constants";
import type { ApprovalMode, WorkspaceEntry } from "@shared/contract";
import { cn } from "cn";
import { ComposerSuggestions } from "./composer-suggestions";

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

const COMMANDS = [
  { id: "new", label: "新聊天", icon: SquarePenIcon },
  { id: "model", label: "选择模型", icon: CpuIcon },
  { id: "permissions", label: "权限模式", icon: ShieldCheckIcon },
  { id: "mcp", label: "MCP 服务", icon: PlugIcon },
] as const;

export function Composer(): JSX.Element {
  const locale = useAgentStore((s) => s.locale);
  const status = useAgentStore((s) => s.status);
  const busy = status !== "idle";
  const settings = useAgentStore((s) => s.settings);
  const steerCount = useAgentStore((s) => s.steerCount);
  const usage = useAgentStore((s) => s.usage);
  const contextTokens = useAgentStore((s) => s.contextTokens);
  const contextWindow = useAgentStore((s) => s.contextWindow);
  const sessionId = useAgentStore((s) => s.sessionId);
  const [text, setText] = useState("");
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const [focused, setFocused] = useState(false);
  const [composing, setComposing] = useState(false);
  const [dismissed, setDismissed] = useState("");
  const [highlighted, setHighlighted] = useState(0);
  const [toolbarMenu, setToolbarMenu] = useState<"permissions" | "model" | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [pickerQuery, setPickerQuery] = useState("");
  const [directoryError, setDirectoryError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [pickingDirectory, setPickingDirectory] = useState(false);
  const [draftReferences, setDraftReferences] = useState<{
    workingDirectory: string | null;
    sessionId: string | null;
    entries: WorkspaceEntry[];
  } | null>(null);
  const editor = useRef<HTMLTextAreaElement>(null);
  const pickerInput = useRef<HTMLInputElement>(null);
  const inlineId = useId();
  const pickerId = useId();
  const prompt = useAgentStore((s) => s.prompt);
  const abort = useAgentStore((s) => s.abort);
  const clearQueue = useAgentStore((s) => s.clearQueue);
  const setApprovalMode = useAgentStore((s) => s.setApprovalMode);
  const switchModel = useAgentStore((s) => s.switchModel);
  const setThinkingLevel = useAgentStore((s) => s.setThinkingLevel);
  const newSession = useAgentStore((s) => s.newSession);
  const setView = useAgentStore((s) => s.setView);
  const setSettingsSection = useAgentStore((s) => s.setSettingsSection);
  const saveToolEnvironment = useAgentStore((s) => s.saveToolEnvironment);

  const mode = settings?.approvalMode ?? "standard";
  const modeMeta = MODE_META[mode];
  const ModeIcon = modeMeta.icon;
  const active = settings?.providers.find((p) => p.id === settings.activeProviderId);
  const thinkingLevel = settings?.thinkingLevel ?? "medium";
  const workingDirectory = settings?.workingDirectory ?? null;
  const references =
    draftReferences?.workingDirectory === workingDirectory &&
    draftReferences.sessionId === sessionId
      ? draftReferences.entries
      : [];
  const rawTrigger =
    focused && !composing && !pickerOpen && toolbarMenu === null
      ? composerTrigger(text, selection.start, selection.end)
      : null;
  const triggerKey = rawTrigger ? JSON.stringify(rawTrigger) : "";
  const trigger = triggerKey !== dismissed ? rawTrigger : null;
  const workspaceQuery = pickerOpen
    ? pickerQuery
    : trigger?.kind === "reference"
      ? trigger.query
      : null;
  const workspace = useWorkspaceSearch(workingDirectory, workspaceQuery);

  const updateSelection = (field: HTMLTextAreaElement): void => {
    const start = field.selectionStart;
    const end = field.selectionEnd;
    if (start === selection.start && end === selection.end) return;
    setSelection({ start, end });
    setHighlighted(0);
  };

  const editReferences = (entries: WorkspaceEntry[]): void => {
    setSendError(null);
    setDraftReferences({ workingDirectory, sessionId, entries });
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
      (pickerOpen ? pickerInput.current : editor.current)?.focus();
    }
  };

  const closePicker = (): void => {
    setPickerOpen(false);
    setPickerQuery("");
    setHighlighted(0);
  };

  const chooseReference = (entry: WorkspaceEntry): void => {
    if (!references.some(({ path }) => path === entry.path)) editReferences([...references, entry]);
    if (pickerOpen) closePicker();
    if (trigger?.kind === "reference") {
      const { start, end } = trigger;
      setText(text.slice(0, start) + text.slice(end));
      setSelection({ start, end: start });
      requestAnimationFrame(() => editor.current?.setSelectionRange(start, start));
    }
    setHighlighted(0);
  };

  const chooseCommand = (id: (typeof COMMANDS)[number]["id"]): void => {
    setText("");
    setSelection({ start: 0, end: 0 });
    setHighlighted(0);
    switch (id) {
      case "model":
      case "permissions":
        setToolbarMenu(id);
        return;
      case "mcp":
        setSettingsSection("mcp");
        setView("settings");
        return;
      case "new":
        setDraftReferences(null);
        void newSession();
    }
  };

  const options: ComposerSuggestion[] = [];
  if (trigger?.kind === "command") {
    const query = trigger.query.toLowerCase();
    for (const { id, label, icon } of COMMANDS) {
      const name = t(label, locale);
      if (id.includes(query) || label.includes(query) || name.toLowerCase().includes(query)) {
        options.push({ id, label: name, detail: "/" + id, icon, select: () => chooseCommand(id) });
      }
    }
  } else if (workspaceQuery !== null && workingDirectory === null && !pickingDirectory) {
    options.push({
      id: "working-directory",
      label: t("选择工作目录", locale),
      icon: FolderIcon,
      select: () => void pickDirectory(),
    });
  } else {
    for (const entry of workspace.entries) {
      options.push({
        id: entry.path,
        label: entry.path.split("/").at(-1) ?? entry.path,
        detail: entry.path.includes("/") ? entry.path : undefined,
        icon: entry.kind === "directory" ? FolderIcon : FileIcon,
        attached: references.some(({ path }) => path === entry.path),
        select: () => chooseReference(entry),
      });
    }
  }
  const activeIndex = Math.min(highlighted, options.length - 1);
  const feedback = t(workspace.pending || pickingDirectory ? "加载中…" : "没有匹配的结果", locale);
  const lookupError = workspaceQuery !== null ? (directoryError ?? workspace.error) : undefined;
  const localizedLookupError = lookupError ? localizeError(lookupError, locale) : undefined;

  const send = async (): Promise<void> => {
    const trimmed = text.trim();
    if (!trimmed || submitting) return;
    setSubmitting(true);
    setSendError(null);
    try {
      await prompt(
        promptWithReferences(trimmed, references, t("工作目录引用", locale)),
        references.length > 0 ? (workingDirectory ?? undefined) : undefined,
      );
      setText((current) => (current === text ? "" : current));
      setDraftReferences((current) => (current === draftReferences ? null : current));
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
      setDismissed(triggerKey);
      return true;
    }
    if ((event.key === "ArrowDown" || event.key === "ArrowUp") && options.length > 0) {
      event.preventDefault();
      const offset = event.key === "ArrowDown" ? 1 : -1;
      setHighlighted(Math.max(0, Math.min(options.length - 1, activeIndex + offset)));
      return true;
    }
    if (event.key === "Enter" && !event.shiftKey && (activeIndex >= 0 || workspace.pending)) {
      event.preventDefault();
      options[activeIndex]?.select();
      return true;
    }
    return false;
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>): void => {
    if (composing || event.nativeEvent.isComposing || onSuggestionKey(event)) return;
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      void send();
    }
  };

  const statusLabel =
    status === "waiting_approval" ? t("等待操作审批…", locale) : t("回复中…", locale);
  const contextPercent =
    contextWindow && contextWindow > 0 && contextTokens > 0
      ? Math.min(100, Math.round((contextTokens / contextWindow) * 100))
      : null;

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
            {contextPercent !== null && (
              <span
                className={cn(
                  "flex items-center gap-1.5",
                  contextPercent > 80 && "text-amber-700 dark:text-amber-400",
                )}
              >
                {t("上下文", locale)} {contextPercent}%
                <span
                  aria-hidden="true"
                  className="bg-border h-1 w-12 overflow-hidden rounded-full"
                >
                  <span
                    className="block h-full rounded-full bg-current"
                    style={{ width: `${contextPercent}%` }}
                  />
                </span>
              </span>
            )}
          </div>
        </div>
      )}

      {trigger && (
        <div className="border-border bg-popover text-popover-foreground absolute inset-x-0 bottom-full z-20 mb-2 rounded-xl border shadow-md">
          <ComposerSuggestions
            id={inlineId}
            label={t(trigger.kind === "command" ? "快捷操作" : "引用文件和文件夹", locale)}
            options={options}
            activeIndex={activeIndex}
            setActiveIndex={setHighlighted}
            feedback={feedback}
            error={localizedLookupError}
          />
        </div>
      )}
      {sendError && (
        <p role="alert" className="text-destructive wrap-anywhere px-2 text-xs">
          {localizeError(sendError, locale)}
        </p>
      )}
      <InputGroup className="border-border bg-card rounded-[22px] shadow-sm shadow-foreground/10">
        {references.length > 0 && (
          <InputGroupAddon align="block-start" className="flex-wrap justify-start gap-1.5 px-3">
            {references.map(({ path, kind }) => {
              const Icon = kind === "directory" ? FolderIcon : FileIcon;
              return (
                <span
                  key={path}
                  className="bg-muted flex min-w-0 max-w-full items-center gap-1.5 rounded-lg px-2 py-0.5"
                >
                  <Icon aria-hidden="true" className="text-muted-foreground size-3.5 shrink-0" />
                  <span title={path} className="min-w-0 truncate text-xs font-normal">
                    {path}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-xs"
                    aria-label={t("移除引用 {0}", locale, [path])}
                    onClick={() => {
                      editReferences(references.filter((entry) => entry.path !== path));
                      editor.current?.focus();
                    }}
                  >
                    <XIcon />
                  </Button>
                </span>
              );
            })}
          </InputGroupAddon>
        )}
        <InputGroupTextarea
          ref={editor}
          className="min-h-[3.75rem] max-h-[min(14rem,38vh)] px-4 pt-3.5 pb-2 text-[15px] leading-6 md:text-[15px]"
          aria-label={t("消息", locale)}
          aria-autocomplete="list"
          aria-controls={trigger ? inlineId : undefined}
          aria-activedescendant={
            trigger && activeIndex >= 0 ? inlineId + "-" + activeIndex : undefined
          }
          value={text}
          onChange={(event) => {
            setText(event.currentTarget.value);
            setSendError(null);
            setDismissed("");
            setHighlighted(0);
            updateSelection(event.currentTarget);
          }}
          onFocus={(event) => {
            setFocused(true);
            updateSelection(event.currentTarget);
          }}
          onBlur={() => setFocused(false)}
          onSelect={(event) => updateSelection(event.currentTarget)}
          onCompositionStart={() => setComposing(true)}
          onCompositionEnd={(event) => {
            setComposing(false);
            updateSelection(event.currentTarget);
          }}
          onKeyDown={onKeyDown}
          placeholder={busy ? t("输入插话消息…", locale) : t("给 {0} 发消息…", locale, [APP_NAME])}
          rows={2}
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
                  setHighlighted(0);
                  setDirectoryError(null);
                } else closePicker();
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
                    setHighlighted(0);
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
            <DropdownMenu
              open={toolbarMenu === "model"}
              onOpenChange={(open) =>
                setToolbarMenu((current) => (open ? "model" : current === "model" ? null : current))
              }
            >
              <DropdownMenuTrigger
                render={
                  <button
                    type="button"
                    aria-label={t("选择模型", locale)}
                    title={active?.modelId}
                    className="border-border/80 text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:ring-ring/40 flex min-h-8 min-w-0 max-w-56 items-center gap-1.5 rounded-full border px-2.5 text-xs transition-colors outline-none focus-visible:ring-2"
                  />
                }
              >
                <CpuIcon aria-hidden="true" className="size-3.5 shrink-0" />
                <span className="truncate">{active ? active.modelId : t("选择模型", locale)}</span>
                <ChevronDownIcon aria-hidden="true" className="size-3 shrink-0" />
              </DropdownMenuTrigger>
              <DropdownMenuContent
                side="top"
                align="end"
                sideOffset={8}
                className="min-w-64 max-w-[min(26rem,var(--available-width))]"
              >
                <DropdownMenuGroup>
                  <DropdownMenuLabel>{t("模型（点击切换）", locale)}</DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {(settings?.providers ?? []).map((p) => (
                    <DropdownMenuItem
                      key={p.id}
                      onClick={() => void switchModel(p.id)}
                      className="items-start gap-2"
                    >
                      <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                        <span className="text-sm">{displayProviderName(p, locale)}</span>
                        <span className="text-muted-foreground wrap-anywhere text-xs">
                          {p.modelId}
                        </span>
                      </span>
                      {p.id === settings?.activeProviderId && (
                        <CheckIcon className="mt-0.5 shrink-0" />
                      )}
                    </DropdownMenuItem>
                  ))}
                  {(settings?.providers ?? []).length === 0 && (
                    <DropdownMenuItem disabled>{t("尚未配置 Provider", locale)}</DropdownMenuItem>
                  )}
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                {/* 思考强度滑块：非 MenuItem，交互不关闭菜单 */}
                <div className="px-2 py-2">
                  <div className="flex items-center justify-between pb-2 text-xs">
                    <span className="text-muted-foreground">{t("思考强度", locale)}</span>
                    <span className="text-foreground">{t(levelLabel(thinkingLevel), locale)}</span>
                  </div>
                  <input
                    type="range"
                    aria-label={t("思考强度", locale)}
                    aria-valuetext={t(levelLabel(thinkingLevel), locale)}
                    min={0}
                    max={THINKING_LEVELS.length - 1}
                    step={1}
                    value={levelIndex(thinkingLevel)}
                    onChange={(e) => void setThinkingLevel(levelAt(Number(e.target.value)))}
                    className="level-slider w-full"
                  />
                </div>
              </DropdownMenuContent>
            </DropdownMenu>

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
                disabled={submitting || text.trim().length === 0}
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
