// @env browser
import { cn } from "cn";
import {
  CheckIcon,
  FolderIcon,
  MessageSquareIcon,
  SearchIcon,
  SettingsIcon,
  ZapIcon,
} from "lucide-react";
import { useEffect, useId, useMemo, useRef, useState, type JSX, type KeyboardEvent } from "react";

import { Button } from "@renderer/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@renderer/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@renderer/components/ui/select";
import { openWorkbenchSettings } from "@renderer/hooks/use-workbench-commands";
import {
  PERMISSION_ATTENTION_TEXT,
  SETTINGS_SECTION_DESCRIPTIONS,
  SETTINGS_SECTION_KEYWORDS,
  SETTINGS_SECTION_LABELS,
} from "@renderer/lib/constants";
import { showFeedbackError } from "@renderer/lib/feedback";
import { localizeError, t, useLocale } from "@renderer/lib/i18n";
import {
  filterEntries,
  PALETTE_TABS,
  type PaletteEntry,
  type PaletteSearch,
  type PaletteTab,
} from "@renderer/lib/palette";
import { relativeTime } from "@renderer/lib/relative-time";
import type { SettingsSection, WorkbenchCommand } from "@renderer/lib/types";
import { referenceName } from "@renderer/lib/workspace-links";
import { useAgentStore } from "@renderer/stores/agent";
import { CONVERSATION_QUERY_LENGTH } from "@shared/constants";
import type { TranscriptLocation } from "@shared/contract";

const entryIcons = {
  action: ZapIcon,
  project: FolderIcon,
  chat: MessageSquareIcon,
  settings: SettingsIcon,
};
const groupLabels = {
  action: "快捷操作",
  project: "项目",
  chat: "聊天",
  settings: "设置分区",
  match: "会话内容",
};

export function CommandPalette({
  commands,
  onOpenChatFind,
}: {
  commands: readonly WorkbenchCommand[];
  onOpenChatFind(query: string, location: TranscriptLocation): void;
}): JSX.Element {
  const locale = useLocale();
  const open = useAgentStore((s) => s.paletteOpen);
  const setOpen = useAgentStore((s) => s.setPaletteOpen);
  const sessions = useAgentStore((s) => s.sessions);
  const recentProjects = useAgentStore((s) => s.recentProjects);
  const [query, setQuery] = useState("");
  const [tab, setTab] = useState<PaletteTab>("all");
  const [selected, setSelected] = useState(0);
  const [scope, setScope] = useState("all");
  const [search, setSearch] = useState<PaletteSearch | null>(null);
  const [retrySearch, setRetrySearch] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const searchRef = useRef<HTMLInputElement>(null);
  const entryAfterClose = useRef<PaletteEntry | null>(null);
  const resultsId = useId();
  const directory = scope === "all" ? undefined : scope === "unlinked" ? null : scope;
  const term = query.trim();
  const searchKey = JSON.stringify([scope, term, retrySearch]);
  const searchChats = tab === "all" || tab === "chat";
  const currentSearch = searchChats && search?.key === searchKey ? search : null;
  const searching = Boolean(term && searchChats && !currentSearch);
  const projects = useMemo(
    () => [
      ...new Set([
        ...recentProjects,
        ...sessions.flatMap((session) => session.workingDirectory ?? []),
      ]),
    ],
    [recentProjects, sessions],
  );

  useEffect(() => {
    if (!open || !term || !searchChats) return;
    let live = true;
    const timer = window.setTimeout(() => {
      void window.pi.sessionSearch(term, directory).then(
        (result) => {
          if (live) setSearch({ key: searchKey, result });
        },
        (error: unknown) => {
          if (live)
            setSearch({
              key: searchKey,
              error: error instanceof Error ? error.message : String(error),
            });
        },
      );
    }, 150);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [open, term, searchChats, directory, searchKey, sessions]);

  const filtered = useMemo(() => {
    const actions = commands
      .filter((command) => command.palette !== false)
      .map((command): PaletteEntry => {
        const detail = command.description && t(command.description, locale);
        const aliases = command.slash
          ? [command.slash, ...(command.slashAliases ?? [])].flatMap((name) => [name, "/" + name])
          : [];
        return {
          kind: "action",
          id: command.id,
          label: t(command.label, locale),
          detail,
          terms: [command.label, command.id, command.shortcut ?? "", detail ?? "", ...aliases],
          command,
        };
      });
    const projectEntries = projects.map((project): PaletteEntry => ({
      kind: "project",
      id: project,
      label: referenceName(project),
      detail: project,
      terms: [project],
    }));
    const chats: PaletteEntry[] = sessions
      .filter(
        (session) => directory === undefined || (session.workingDirectory ?? null) === directory,
      )
      .map((session) => ({
        kind: "chat",
        id: session.id,
        label: session.title,
        detail: relativeTime(session.updatedAt, locale),
      }));
    const settings = (Object.keys(SETTINGS_SECTION_LABELS) as SettingsSection[]).map(
      (section): PaletteEntry => {
        const label = SETTINGS_SECTION_LABELS[section];
        const description = SETTINGS_SECTION_DESCRIPTIONS[section];
        const terms = [label, description, ...SETTINGS_SECTION_KEYWORDS[section]];
        return {
          kind: "settings",
          id: section,
          section,
          label: t(label, locale),
          detail: t(description, locale),
          terms: [section, ...terms, ...terms.map((key) => t(key, locale))],
        };
      },
    );
    const entries = filterEntries(
      [...actions, ...projectEntries, ...chats, ...settings],
      query,
      tab,
    );
    if (!term || !currentSearch?.result) return entries;
    const matchingSessions = new Map(sessions.map((session) => [session.id, session]));
    for (const hit of currentSearch.result.hits) {
      const session = matchingSessions.get(hit.sessionId);
      if (!session) continue;
      const { messageId, partIndex, field, occurrence } = hit.location;
      entries.push({
        kind: "chat",
        id: [hit.sessionId, messageId, partIndex, field, occurrence].join("/"),
        label: session.title,
        detail: session.workingDirectory
          ? referenceName(session.workingDirectory)
          : t("未关联项目", locale),
        hit,
        findQuery: term,
      });
    }
    return entries;
  }, [locale, sessions, projects, commands, directory, query, tab, term, currentSearch]);

  const activeIndex = Math.max(0, Math.min(selected, filtered.length - 1));
  const activeId = filtered[activeIndex]?.id;
  useEffect(() => setSelected(0), [query, tab, scope]);
  useEffect(() => {
    if (!open) return;
    listRef.current
      ?.querySelector('[data-index="' + activeIndex + '"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [activeId, activeIndex, open]);

  const runEntry = async (entry: PaletteEntry): Promise<void> => {
    const store = useAgentStore.getState();
    if (entry.kind === "chat") {
      const sessionId = entry.hit?.sessionId ?? entry.id;
      store.setView("chat");
      await store.loadSession(sessionId);
      if (entry.hit && useAgentStore.getState().sessionId === sessionId)
        onOpenChatFind(entry.findQuery ?? "", entry.hit.location);
    } else if (entry.kind === "project") {
      await store.selectProject({ directory: entry.id });
    } else if (entry.section) {
      openWorkbenchSettings(entry.section);
    } else {
      await entry.command?.run();
    }
  };

  const selectEntry = (entry: PaletteEntry): void => {
    entryAfterClose.current = entry;
    setOpen(false);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>): void => {
    if (event.nativeEvent.isComposing) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (filtered.length) setSelected(Math.min(filtered.length - 1, activeIndex + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelected(Math.max(0, activeIndex - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      const entry = filtered[activeIndex];
      if (entry) selectEntry(entry);
    }
  };

  let lastKind: keyof typeof groupLabels | null = null;
  return (
    <Dialog
      open={open}
      onOpenChange={setOpen}
      onOpenChangeComplete={(next) => {
        if (next || !entryAfterClose.current) return;
        const entry = entryAfterClose.current;
        entryAfterClose.current = null;
        void runEntry(entry).catch((error: unknown) =>
          showFeedbackError(
            entry.hit ? "无法打开搜索结果。请重试。" : "无法执行此操作。请重试。",
            error,
          ),
        );
      }}
    >
      <DialogContent
        className="top-[18%] max-h-[calc(82dvh-1rem)] translate-y-0 grid-rows-[auto_minmax(0,1fr)_auto] gap-0 overflow-hidden p-0 sm:max-w-xl"
        showCloseButton={false}
        initialFocus={searchRef}
      >
        <DialogTitle className="sr-only">{t("搜索", locale)}</DialogTitle>
        <div className="flex items-center gap-2 border-b px-4 py-3">
          <SearchIcon aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
          <input
            ref={searchRef}
            value={query}
            maxLength={CONVERSATION_QUERY_LENGTH}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            aria-label={t("搜索", locale)}
            aria-controls={resultsId}
            aria-activedescendant={activeId ? resultsId + "-" + activeIndex : undefined}
            placeholder={t("搜索操作、项目、会话和设置…", locale)}
            className="w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <div ref={listRef} className="max-h-80 min-h-0 overflow-y-auto py-1">
          {filtered.length === 0 && !currentSearch?.error && (
            <p role="status" className="px-4 py-6 text-center text-sm text-muted-foreground">
              {t(searching ? "正在搜索会话…" : "没有匹配的结果", locale)}
            </p>
          )}
          <div id={resultsId} role="listbox" aria-label={t("搜索结果", locale)}>
            {filtered.map((entry, index) => {
              const kind = entry.hit ? "match" : entry.kind;
              const showHeader = kind !== lastKind;
              lastKind = kind;
              const Icon = entry.command?.icon ?? entryIcons[entry.kind];
              const tone = entry.command?.attention ? PERMISSION_ATTENTION_TEXT : undefined;
              const shortcut =
                entry.command?.shortcut ?? (entry.command?.slash && "/" + entry.command.slash);
              return (
                <div key={kind + "-" + entry.id}>
                  {showHeader && (
                    <p role="presentation" className="px-4 pt-3 pb-1 text-xs text-muted-foreground">
                      {t(groupLabels[kind], locale)}
                    </p>
                  )}
                  <button
                    type="button"
                    id={resultsId + "-" + index}
                    role="option"
                    tabIndex={-1}
                    aria-selected={index === activeIndex}
                    aria-description={t(groupLabels[kind], locale)}
                    data-index={index}
                    data-session-search-hit={entry.hit?.sessionId}
                    onMouseEnter={() => setSelected(index)}
                    onClick={() => selectEntry(entry)}
                    className={cn(
                      "flex w-full items-start gap-3 px-4 py-2 text-left text-sm transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset",
                      index === activeIndex
                        ? "bg-accent text-accent-foreground"
                        : "hover:bg-accent/60",
                    )}
                  >
                    <Icon aria-hidden="true" className={cn("mt-0.5 size-4 shrink-0", tone)} />
                    <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                      <span className={cn("truncate", tone)}>{entry.label}</span>
                      {entry.detail && (
                        <span className="line-clamp-2 text-xs wrap-anywhere text-muted-foreground">
                          {entry.detail}
                        </span>
                      )}
                      {entry.hit && (
                        <span className="line-clamp-2 text-xs wrap-anywhere text-muted-foreground">
                          {entry.hit.snippet.before}
                          <mark className="bg-primary text-primary-foreground">
                            {entry.hit.snippet.match}
                          </mark>
                          {entry.hit.snippet.after}
                        </span>
                      )}
                    </span>
                    {shortcut && (
                      <span
                        className="mt-0.5 max-w-[40%] truncate text-xs text-muted-foreground"
                        title={shortcut}
                      >
                        {shortcut}
                      </span>
                    )}
                    {entry.command?.checked && (
                      <CheckIcon
                        aria-label={t("当前", locale)}
                        className="mt-0.5 size-4 shrink-0"
                      />
                    )}
                  </button>
                </div>
              );
            })}
          </div>
          {currentSearch?.error && (
            <div className="flex items-center justify-between gap-2 px-4 py-2 text-sm">
              <p role="alert" className="min-w-0 wrap-anywhere text-destructive">
                {localizeError(currentSearch.error, locale)}
              </p>
              <Button
                size="sm"
                variant="outline"
                onClick={() => setRetrySearch((value) => value + 1)}
              >
                {t("重试搜索", locale)}
              </Button>
            </div>
          )}
          {currentSearch?.result?.hasMore && (
            <p className="px-4 py-2 text-xs text-muted-foreground">
              {t("还有更多结果，请缩小搜索范围。", locale)}
            </p>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-1 border-t px-3 py-2">
          {PALETTE_TABS.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              aria-pressed={tab === value}
              onClick={() => {
                setTab(value);
                searchRef.current?.focus();
              }}
              className={cn(
                "rounded-full px-2.5 py-1 text-xs whitespace-nowrap transition-colors outline-none focus-visible:ring-2 focus-visible:ring-ring",
                tab === value
                  ? "bg-accent text-accent-foreground"
                  : "text-muted-foreground hover:bg-accent/60",
              )}
            >
              {t(label, locale)}
            </button>
          ))}
          {searchChats && (
            <Select value={scope} onValueChange={(value) => value && setScope(value)}>
              <SelectTrigger size="sm" aria-label={t("搜索项目范围", locale)} className="max-w-36">
                <SelectValue>
                  {scope === "all"
                    ? t("全部项目", locale)
                    : scope === "unlinked"
                      ? t("未关联项目", locale)
                      : referenceName(scope)}
                </SelectValue>
              </SelectTrigger>
              <SelectContent align="start" alignItemWithTrigger={false} className="min-w-40">
                <SelectGroup>
                  <SelectItem value="all">{t("全部项目", locale)}</SelectItem>
                  <SelectItem value="unlinked">{t("未关联项目", locale)}</SelectItem>
                  {projects.map((project) => (
                    <SelectItem key={project} value={project}>
                      <span className="flex min-w-0 flex-col gap-0.5">
                        <span>{referenceName(project)}</span>
                        <span className="text-xs wrap-anywhere text-muted-foreground">
                          {project}
                        </span>
                      </span>
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          )}
          <span className="ml-auto text-xs text-muted-foreground">
            {t("↑↓ 选择 · Enter 执行", locale)}
          </span>
        </div>
      </DialogContent>
    </Dialog>
  );
}
