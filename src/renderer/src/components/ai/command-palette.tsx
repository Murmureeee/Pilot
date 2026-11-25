// @env browser
// 全局命令面板（Codex/ChatGPT 风格）：Ctrl+K 唤起，搜快捷操作与会话，键盘导航执行。
import { cn } from "cn";
import {
  ArrowUpIcon,
  EyeIcon,
  FileDiffIcon,
  FileTextIcon,
  ListChecksIcon,
  LocateFixedIcon,
  MessageSquareIcon,
  SearchIcon,
  SettingsIcon,
  ShieldCheckIcon,
  SquarePenIcon,
  SquareIcon,
  ZapIcon,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type JSX, type KeyboardEvent } from "react";

import { Dialog, DialogContent, DialogTitle } from "@renderer/components/ui/dialog";
import { COMPOSER_SHORTCUTS, REVIEW_SHORTCUTS } from "@renderer/lib/constants";
import { t, useLocale } from "@renderer/lib/i18n";
import {
  filterEntries,
  PALETTE_TABS,
  type PaletteEntry,
  type PaletteTab,
} from "@renderer/lib/palette";
import { relativeTime } from "@renderer/lib/relative-time";
import type { ComposerShortcut } from "@renderer/lib/types";
import { selectApprovalMode, selectPlanReview, useAgentStore } from "@renderer/stores/agent";
import { activateReview } from "@renderer/stores/review";
import type { ApprovalMode } from "@shared/contract";

function EntryIcon({ entry }: { entry: PaletteEntry }): JSX.Element {
  if (entry.kind === "chat") return <MessageSquareIcon className="size-4 shrink-0" />;
  switch (entry.id) {
    case "new-chat":
      return <SquarePenIcon className="size-4 shrink-0" />;
    case "open-settings":
      return <SettingsIcon className="size-4 shrink-0" />;
    case "review-changes":
      return <FileDiffIcon className="size-4 shrink-0" />;
    case "review-files":
      return <FileTextIcon className="size-4 shrink-0" />;
    case "review-verification":
      return <ListChecksIcon className="size-4 shrink-0" />;
    case "focus-composer":
      return <LocateFixedIcon className="size-4 shrink-0" />;
    case "recall-message":
      return <ArrowUpIcon className="size-4 shrink-0" />;
    case "stop-run":
      return <SquareIcon className="size-4 shrink-0" />;
    case "cycle-approval-mode":
    case "mode-standard":
      return <ShieldCheckIcon className="size-4 shrink-0" />;
    case "mode-readonly":
      return <EyeIcon className="size-4 shrink-0" />;
    case "mode-full":
      return <ZapIcon className="size-4 shrink-0" />;
    default:
      return <MessageSquareIcon className="size-4 shrink-0" />;
  }
}

export function CommandPalette({
  canReview,
  composerShortcuts,
  onComposerShortcut,
}: {
  canReview: boolean;
  composerShortcuts: Record<ComposerShortcut, boolean>;
  onComposerShortcut(shortcut: ComposerShortcut): void;
}): JSX.Element {
  const locale = useLocale();
  const open = useAgentStore((s) => s.paletteOpen);
  const setOpen = useAgentStore((s) => s.setPaletteOpen);
  const sessions = useAgentStore((s) => s.sessions);
  const approvalMode = useAgentStore(selectApprovalMode);
  const reviewingPlan = useAgentStore((state) => Boolean(selectPlanReview(state)));
  const newSession = useAgentStore((s) => s.newSession);
  const loadSession = useAgentStore((s) => s.loadSession);
  const setView = useAgentStore((s) => s.setView);
  const updateSessionSettings = useAgentStore((s) => s.updateSessionSettings);

  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<PaletteTab>("all");
  const [selected, setSelected] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const entryAfterClose = useRef<PaletteEntry | null>(null);

  const entries = useMemo<PaletteEntry[]>(() => {
    const actions: PaletteEntry[] = [
      { kind: "action", id: "new-chat", label: t("新聊天", locale), detail: "Ctrl+N" },
      { kind: "action", id: "open-settings", label: t("打开设置", locale) },
    ];
    if (!reviewingPlan)
      actions.push(
        {
          kind: "action",
          id: "mode-standard",
          label: `${t("权限模式：确认模式", locale)}${
            approvalMode === "standard" ? t("（当前）", locale) : ""
          }`,
        },
        {
          kind: "action",
          id: "mode-readonly",
          label: `${t("权限模式：只读", locale)}${
            approvalMode === "read-only" ? t("（当前）", locale) : ""
          }`,
        },
        {
          kind: "action",
          id: "mode-full",
          label: `${t("权限模式：完全访问", locale)}${
            approvalMode === "full-access" ? t("（当前）", locale) : ""
          }`,
        },
      );
    if (canReview) {
      actions.push(
        {
          kind: "action",
          id: "review-changes",
          label: t(REVIEW_SHORTCUTS.changes.label, locale),
          detail: REVIEW_SHORTCUTS.changes.keys,
        },
        { kind: "action", id: "review-files", label: t("打开文件页签", locale) },
        {
          kind: "action",
          id: "review-verification",
          label: t(REVIEW_SHORTCUTS.verification.label, locale),
          detail: REVIEW_SHORTCUTS.verification.keys,
        },
      );
    }
    for (const id of Object.keys(COMPOSER_SHORTCUTS) as ComposerShortcut[]) {
      if (!composerShortcuts[id]) continue;
      const shortcut = COMPOSER_SHORTCUTS[id];
      actions.push({ kind: "action", id, label: t(shortcut.label, locale), detail: shortcut.keys });
    }
    const chats: PaletteEntry[] = sessions.map((s) => ({
      kind: "chat",
      id: s.id,
      label: s.title,
      detail: relativeTime(s.updatedAt, locale),
    }));
    return [...actions, ...chats];
  }, [locale, sessions, approvalMode, reviewingPlan, canReview, composerShortcuts]);

  const filtered = useMemo(() => filterEntries(entries, query, tab), [entries, query, tab]);

  // 查询/标签变化时复位选中项，并保证选中项滚动进可视区
  useEffect(() => {
    setSelected(0);
  }, [query, tab]);

  useEffect(() => {
    if (!open) return;
    const el = listRef.current?.querySelector(`[data-index="${selected}"]`);
    el?.scrollIntoView({ block: "nearest" });
  }, [selected, open]);

  const changeApprovalMode = (mode: ApprovalMode): void => {
    setView("chat");
    void updateSessionSettings({ approvalMode: mode }).catch((error: unknown) =>
      useAgentStore.setState({ error: error instanceof Error ? error.message : String(error) }),
    );
  };

  const runById = (entry: PaletteEntry): void => {
    if (entry.kind === "chat") {
      setView("chat");
      void loadSession(entry.id);
      return;
    }
    switch (entry.id) {
      case "new-chat":
        setView("chat");
        void newSession();
        return;
      case "open-settings":
        setView("settings");
        return;
      case "review-changes":
        activateReview("changes");
        return;
      case "review-files":
        activateReview("files");
        return;
      case "review-verification":
        activateReview("verification");
        return;
      case "mode-standard":
        changeApprovalMode("standard");
        return;
      case "mode-readonly":
        changeApprovalMode("read-only");
        return;
      case "mode-full":
        changeApprovalMode("full-access");
        return;
      case "focus-composer":
      case "cycle-approval-mode":
      case "recall-message":
      case "stop-run":
        onComposerShortcut(entry.id);
    }
  };

  const selectEntry = (entry: PaletteEntry): void => {
    entryAfterClose.current = entry;
    setOpen(false);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelected((i) => Math.min(filtered.length - 1, i + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelected((i) => Math.max(0, i - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const entry = filtered[selected];
      if (entry) selectEntry(entry);
    }
  };

  // 渲染分组：连续同类条目归一段（操作在前、聊天在后）
  let lastKind: PaletteEntry["kind"] | null = null;

  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      onOpenChangeComplete={(next) => {
        if (next || !entryAfterClose.current) return;
        const entry = entryAfterClose.current;
        entryAfterClose.current = null;
        runById(entry);
      }}
    >
      <DialogContent
        className="top-[18%] max-h-[calc(82dvh-1rem)] translate-y-0 grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:max-w-xl"
        showCloseButton={false}
        initialFocus={searchRef}
      >
        <DialogTitle className="sr-only">{t("搜索", locale)}</DialogTitle>
        <div className="flex items-center gap-2 border-b px-4 py-3">
          <SearchIcon className="size-4 shrink-0 text-muted-foreground" />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={onKeyDown}
            aria-label={t("搜索", locale)}
            placeholder={t("搜索操作与会话…", locale)}
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>

        <div ref={listRef} className="max-h-80 min-h-0 overflow-y-auto py-1">
          {filtered.length === 0 && (
            <p className="px-4 py-6 text-center text-sm text-muted-foreground">
              {t("没有匹配的结果", locale)}
            </p>
          )}
          {filtered.map((entry, index) => {
            const showHeader = entry.kind !== lastKind;
            lastKind = entry.kind;
            return (
              <div key={`${entry.kind}-${entry.id}`}>
                {showHeader && (
                  <p className="px-4 pt-3 pb-1 text-xs text-muted-foreground">
                    {entry.kind === "action" ? t("快捷操作", locale) : t("聊天", locale)}
                  </p>
                )}
                <button
                  type="button"
                  data-index={index}
                  onMouseEnter={() => setSelected(index)}
                  onClick={() => selectEntry(entry)}
                  className={cn(
                    "flex w-full items-center gap-3 px-4 py-2 text-left text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                    index === selected ? "bg-accent text-accent-foreground" : "hover:bg-accent/60",
                  )}
                >
                  <EntryIcon entry={entry} />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate">{entry.label}</span>
                    {entry.detail && (
                      <span className="text-xs text-muted-foreground">{entry.detail}</span>
                    )}
                  </span>
                </button>
              </div>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-1 border-t px-3 py-2">
          {PALETTE_TABS.map((tabItem) => (
            <button
              key={tabItem.value}
              type="button"
              onClick={() => setTab(tabItem.value)}
              className={cn(
                "rounded-full px-2.5 py-1 text-xs whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
                tab === tabItem.value
                  ? "bg-accent font-medium text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/60",
              )}
            >
              {t(tabItem.label, locale)}
            </button>
          ))}
          <span className="ml-auto text-xs text-muted-foreground">
            {t("↑↓ 选择 · Enter 执行", locale)}
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
