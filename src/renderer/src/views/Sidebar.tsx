// @env browser
import {
  useCallback,
  useMemo,
  useState,
  type JSX,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  ArrowLeftIcon,
  ChevronRightIcon,
  CircleIcon,
  CopyIcon,
  FolderIcon,
  FolderOpenIcon,
  GitForkIcon,
  HouseIcon,
  LoaderCircleIcon,
  PencilIcon,
  PinIcon,
  PinOffIcon,
  ScrollTextIcon,
  SearchIcon,
  SettingsIcon,
  SquarePenIcon,
  SquareTerminalIcon,
  Trash2Icon,
} from "lucide-react";
import { Button } from "@renderer/components/ui/button";
import {
  SESSION_STATUS_LABELS,
  SIDEBAR_MAX_WIDTH,
  SIDEBAR_MIN_WIDTH,
} from "@renderer/lib/constants";
import { t, useLocale } from "@renderer/lib/i18n";
import { loadCollapsedProjects, saveCollapsedProjects } from "@renderer/lib/preferences";
import { relativeTime } from "@renderer/lib/relative-time";
import { projectParents as parentsOf, sessionRowStatus } from "@renderer/lib/sidebar";
import type { SessionRowStatus } from "@renderer/lib/types";
import { referenceName } from "@renderer/lib/workspace-links";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@renderer/components/ui/context-menu";
import { selectProjectDirectory, useAgentStore } from "@renderer/stores/agent";
import { SessionDeleteDialog } from "@renderer/components/ai/session-delete-dialog";
import {
  SessionPersonaDialog,
  SessionRenameDialog,
} from "@renderer/components/ai/session-edit-dialogs";
import { UpdateRailButton } from "@renderer/components/ai/update-panel";
import { SettingsNav } from "@renderer/views/settings/SettingsNav";
import { cn } from "cn";
import { APP_NAME } from "@shared/constants";
import type { SessionMeta } from "@shared/contract";

/** rail 右缘向右拖动超过此位移 → 动画展开 */
const RAIL_EXPAND_THRESHOLD = 80;

const RAIL_CONTROL =
  "text-sidebar-foreground/80 hover:bg-sidebar-foreground/8 hover:text-sidebar-foreground aria-[current=page]:bg-sidebar-foreground/10 aria-[current=page]:text-sidebar-foreground rounded-xl";

const ROW_ACTION =
  "hover:bg-foreground/10 hover:text-foreground text-muted-foreground rounded-sm p-1 transition-colors";

/** 状态位始终占位，标题才能在有无状态的行之间对齐。 */
function SessionStatusMark({ status }: { status: SessionRowStatus | null }): JSX.Element {
  const locale = useLocale();
  const spinning = status === "running" || status === "stopping";
  return (
    <span className="grid size-3 shrink-0 place-items-center">
      {status && (
        <>
          {spinning ? (
            <LoaderCircleIcon
              aria-hidden="true"
              className={cn(
                "size-3 motion-safe:animate-spin",
                status === "running"
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-muted-foreground",
              )}
            />
          ) : (
            <span
              aria-hidden="true"
              className={cn(
                "size-2 rounded-full",
                status === "approval" && "bg-amber-500",
                status === "interrupted" && "border-muted-foreground border",
                status === "unread" && "bg-brand",
              )}
            />
          )}
          <span className="sr-only">{t(SESSION_STATUS_LABELS[status], locale)}</span>
        </>
      )}
    </span>
  );
}

export function AppRail({
  collapsed,
  onExpand,
}: {
  collapsed: boolean;
  onExpand(): void;
}): JSX.Element {
  const locale = useLocale();
  const view = useAgentStore((s) => s.view);
  const newSession = useAgentStore((s) => s.newSession);
  const setView = useAgentStore((s) => s.setView);
  const setPaletteOpen = useAgentStore((s) => s.setPaletteOpen);

  const startExpandDrag = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>): void => {
      event.preventDefault();
      const startX = event.clientX;
      const onMove = (ev: globalThis.MouseEvent): void => {
        if (ev.clientX - startX > RAIL_EXPAND_THRESHOLD) {
          cleanup();
          onExpand();
        }
      };
      const onUp = (): void => {
        cleanup();
      };
      const cleanup = (): void => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [onExpand],
  );

  return (
    <div className="relative flex w-13 shrink-0 flex-col">
      <nav
        aria-label={t("应用导航", locale)}
        className="flex min-h-0 flex-1 flex-col items-center gap-1 pt-[7px] pb-1"
      >
        <Button
          variant="ghost"
          size="icon-lg"
          className={RAIL_CONTROL}
          onClick={() => setView("chat")}
          aria-current={view === "chat" ? "page" : undefined}
          aria-label={t("首页", locale)}
          title={t("首页", locale)}
        >
          <HouseIcon strokeWidth={1.7} />
        </Button>

        {collapsed && (
          <>
            <Button
              variant="ghost"
              size="icon-lg"
              className={RAIL_CONTROL}
              onClick={() => {
                setView("chat");
                void newSession();
              }}
              aria-label={t("新聊天", locale)}
              title={t("新聊天", locale)}
            >
              <SquarePenIcon strokeWidth={1.7} />
            </Button>
            <Button
              variant="ghost"
              size="icon-lg"
              className={RAIL_CONTROL}
              onClick={() => setPaletteOpen(true)}
              aria-label={t("搜索", locale)}
              title={t("搜索 (Ctrl+K)", locale)}
            >
              <SearchIcon strokeWidth={1.7} />
            </Button>
          </>
        )}

        <div className="mt-auto flex flex-col items-center gap-1">
          <UpdateRailButton locale={locale} />
          <Button
            variant="ghost"
            size="icon-lg"
            className={RAIL_CONTROL}
            onClick={() => {
              setView("settings");
              if (collapsed) onExpand();
            }}
            aria-current={view === "settings" ? "page" : undefined}
            aria-label={t("设置", locale)}
            title={t("设置", locale)}
          >
            <SettingsIcon strokeWidth={1.7} />
          </Button>
        </div>
      </nav>

      {collapsed && (
        <div
          role="presentation"
          onMouseDown={startExpandDrag}
          className="hover:bg-sidebar-ring/20 absolute inset-y-10 right-0 z-10 w-1.5 cursor-col-resize transition-colors"
          title={t("向右拖拽展开面板", locale)}
        />
      )}
    </div>
  );
}

export function SidebarPanel({
  width,
  animateWidth,
  onResize,
  onDragStart,
  onDragEnd,
  onCollapse,
  collapsed,
}: {
  width: number;
  animateWidth: boolean;
  onResize(width: number): void;
  onDragStart(): void;
  onDragEnd(width: number): void;
  onCollapse(): void;
  collapsed: boolean;
}): JSX.Element {
  const locale = useLocale();
  const sessions = useAgentStore((s) => s.sessions);
  const sessionId = useAgentStore((s) => s.sessionId);
  const recentProjects = useAgentStore((s) => s.recentProjects);
  const projectDirectory = useAgentStore(selectProjectDirectory);
  const newSession = useAgentStore((s) => s.newSession);
  const loadSession = useAgentStore((s) => s.loadSession);
  const selectProject = useAgentStore((s) => s.selectProject);
  const choosingProject = useAgentStore((s) => s.choosingProject);
  const setSessionPinned = useAgentStore((s) => s.setSessionPinned);
  const setSessionArchived = useAgentStore((s) => s.setSessionArchived);
  const setSessionUnread = useAgentStore((s) => s.setSessionUnread);
  const forkSession = useAgentStore((s) => s.forkSession);
  const copySession = useAgentStore((s) => s.copySession);
  const setView = useAgentStore((s) => s.setView);
  const setPaletteOpen = useAgentStore((s) => s.setPaletteOpen);
  const view = useAgentStore((s) => s.view);
  const [renameTarget, setRenameTarget] = useState<SessionMeta | null>(null);
  // 永久删除是不可恢复操作（转录文件从磁盘彻底清除），必须二次确认（共享弹窗组件）
  const [deleteTarget, setDeleteTarget] = useState<SessionMeta | null>(null);
  const [personaTarget, setPersonaTarget] = useState<SessionMeta | null>(null);
  const [collapsedProjects, setCollapsedProjects] = useState(loadCollapsedProjects);
  const activeRun = useAgentStore((s) => s.activeRun);
  const interruptedRun = useAgentStore((s) => s.interruptedRun);
  const projectParents = useMemo(() => parentsOf(recentProjects), [recentProjects]);
  const toggleProject = (directory: string): void => {
    const next = collapsedProjects.includes(directory)
      ? collapsedProjects.filter((item) => item !== directory)
      : [...collapsedProjects, directory];
    setCollapsedProjects(next);
    saveCollapsedProjects(next);
  };
  const inChat = view === "chat";
  const headerActionLabel = t(inChat ? "搜索" : "返回对话", locale);

  const { active, archived } = useMemo(() => {
    const activeSessions = sessions
      .filter((session) => !session.archived)
      .sort((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned)));
    return {
      active: Map.groupBy(activeSessions, (session) => session.workingDirectory ?? null),
      archived: Map.groupBy(
        sessions.filter((session) => session.archived),
        (session) => session.workingDirectory ?? null,
      ),
    };
  }, [sessions]);
  const unlinked = active.get(null);

  const openSession = (id: string): void => {
    setView("chat");
    void loadSession(id);
  };

  const renderSessionRow = (s: SessionMeta, nested = false): JSX.Element => (
    <ContextMenu key={s.id}>
      <ContextMenuTrigger
        render={
          <div
            className={cn(
              "group hover:bg-sidebar-accent/65 relative flex items-center rounded-lg transition-colors",
              s.id === sessionId && "bg-sidebar-accent",
            )}
          >
            <button
              type="button"
              onClick={() => openSession(s.id)}
              className={cn(
                "focus-visible:ring-sidebar-ring flex min-w-0 flex-1 items-center gap-2 rounded-lg py-1.5 pr-2 text-left text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-inset",
                nested ? "pl-7" : "pl-2.5",
              )}
              aria-current={s.id === sessionId ? "page" : undefined}
              title={s.title + "\n" + new Date(s.updatedAt).toLocaleString(locale)}
            >
              <SessionStatusMark status={sessionRowStatus(s, activeRun, interruptedRun)} />
              {s.pinned && !s.archived && (
                <PinIcon
                  className="text-muted-foreground -mr-0.5 size-3 shrink-0"
                  aria-label={t("置顶", locale)}
                />
              )}
              <span className={cn("min-w-0 flex-1 truncate", s.unread && "font-medium")}>
                {s.title}
              </span>
              {/* 只认键盘焦点：鼠标点开会话后焦点留在行上，不该一直把时间换成按钮。 */}
              <span className="text-muted-foreground shrink-0 text-xs group-hover:hidden group-has-[:focus-visible]:hidden">
                {relativeTime(s.updatedAt, locale)}
              </span>
            </button>
            <div className="mr-1 hidden shrink-0 items-center gap-0.5 group-hover:flex group-has-[:focus-visible]:flex">
              {!s.archived && (
                <button
                  type="button"
                  aria-label={s.pinned ? t("取消置顶", locale) : t("置顶聊天", locale)}
                  title={s.pinned ? t("取消置顶", locale) : t("置顶聊天", locale)}
                  onClick={() => void setSessionPinned(s.id, !s.pinned)}
                  className={ROW_ACTION}
                >
                  {s.pinned ? (
                    <PinOffIcon className="size-3.5" />
                  ) : (
                    <PinIcon className="size-3.5" />
                  )}
                </button>
              )}
              {s.archived ? (
                <button
                  type="button"
                  aria-label={t("取消归档", locale)}
                  title={t("取消归档", locale)}
                  onClick={() => void setSessionArchived(s.id, false)}
                  className={ROW_ACTION}
                >
                  <ArchiveRestoreIcon className="size-3.5" />
                </button>
              ) : (
                <button
                  type="button"
                  aria-label={t("归档聊天", locale)}
                  title={t("归档聊天", locale)}
                  onClick={() => void setSessionArchived(s.id, true)}
                  className={ROW_ACTION}
                >
                  <ArchiveIcon className="size-3.5" />
                </button>
              )}
            </div>
          </div>
        }
      />
      <ContextMenuContent className="min-w-44">
        <ContextMenuItem onClick={() => setRenameTarget(s)}>
          <PencilIcon className="size-4" /> {t("重命名", locale)}
        </ContextMenuItem>
        {!s.archived && (
          <ContextMenuItem onClick={() => void setSessionPinned(s.id, !s.pinned)}>
            <PinIcon className="size-4" /> {s.pinned ? t("取消置顶", locale) : t("置顶", locale)}
          </ContextMenuItem>
        )}
        <ContextMenuItem onClick={() => void setSessionUnread(s.id, !s.unread)}>
          <CircleIcon className="size-4" />{" "}
          {s.unread ? t("标记为已读", locale) : t("标记为未读", locale)}
        </ContextMenuItem>
        <ContextMenuItem onClick={() => void forkSession(s.id)}>
          <GitForkIcon className="size-4" /> {t("分叉", locale)}
        </ContextMenuItem>
        <ContextMenuItem onClick={() => void copySession(s.id)}>
          <CopyIcon className="size-4" /> {t("复制全文", locale)}
        </ContextMenuItem>
        <ContextMenuItem onClick={() => void setSessionArchived(s.id, !s.archived)}>
          {s.archived ? (
            <ArchiveRestoreIcon className="size-4" />
          ) : (
            <ArchiveIcon className="size-4" />
          )}
          {s.archived ? t("取消归档", locale) : t("归档", locale)}
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={() => setPersonaTarget(s)}>
          <ScrollTextIcon className="size-4" />{" "}
          {s.personaOverride ? t("会话指令（已覆盖）", locale) : t("会话指令…", locale)}
        </ContextMenuItem>
        <ContextMenuItem variant="destructive" onClick={() => setDeleteTarget(s)}>
          <Trash2Icon className="size-4" /> {t("永久删除", locale)}
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );

  const startDrag = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>): void => {
      event.preventDefault();
      onDragStart();
      const startX = event.clientX;
      const startWidth = event.currentTarget.parentElement?.clientWidth ?? width;
      let nextWidth = width;
      const onUp = (): void => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
        onDragEnd(nextWidth);
      };
      const onMove = (ev: globalThis.MouseEvent): void => {
        const next = startWidth + (ev.clientX - startX);
        // 越过下界：立即打断拖拽并播放收起动画（不等松手）
        if (next < SIDEBAR_MIN_WIDTH) {
          onUp();
          onCollapse();
          return;
        }
        nextWidth = Math.min(SIDEBAR_MAX_WIDTH, next);
        onResize(nextWidth);
      };
      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", onUp);
    },
    [width, onResize, onDragStart, onDragEnd, onCollapse],
  );

  return (
    <aside
      id="sidebar-panel"
      inert={collapsed}
      className={cn(
        "bg-sidebar text-sidebar-foreground after:bg-sidebar-border relative flex h-full max-w-[max(220px,calc(100vw-400px))] shrink-0 flex-col overflow-hidden after:pointer-events-none after:absolute after:inset-y-0 after:right-0 after:w-px",
        animateWidth &&
          "motion-safe:transition-[width] motion-safe:duration-200 motion-safe:ease-out",
      )}
      style={{ width: collapsed ? 0 : width }}
    >
      <div className="flex h-10 shrink-0 items-center justify-between gap-2 pr-3 pl-4">
        <h2 className="flex min-w-0 items-center gap-2.5 text-[15px] font-semibold tracking-tight">
          {inChat && (
            <span
              className="bg-sidebar-accent grid size-6 shrink-0 place-items-center rounded-lg"
              aria-hidden="true"
            >
              <SquareTerminalIcon className="size-3.5" strokeWidth={1.75} />
            </span>
          )}
          <span className="truncate">{inChat ? APP_NAME : t("设置", locale)}</span>
        </h2>
        <Button
          variant="ghost"
          size="icon-sm"
          className="text-sidebar-foreground/75 hover:bg-sidebar-accent rounded-lg"
          onClick={inChat ? () => setPaletteOpen(true) : () => setView("chat")}
          aria-label={headerActionLabel}
          title={inChat ? t("搜索 (Ctrl+K)", locale) : headerActionLabel}
        >
          {inChat ? <SearchIcon strokeWidth={1.7} /> : <ArrowLeftIcon strokeWidth={1.7} />}
        </Button>
      </div>

      {inChat ? (
        <>
          <div className="shrink-0 px-3 pb-3">
            <Button
              variant="ghost"
              className="hover:bg-sidebar-accent hover:text-sidebar-accent-foreground text-sidebar-foreground w-full justify-start gap-2.5 rounded-lg text-[13px] font-normal"
              disabled={choosingProject}
              onClick={() => void selectProject()}
            >
              <FolderOpenIcon data-icon="inline-start" strokeWidth={1.7} /> {t("打开项目…", locale)}
            </Button>
            <Button
              variant="ghost"
              className="hover:bg-sidebar-accent hover:text-sidebar-accent-foreground text-sidebar-foreground w-full justify-start gap-2.5 rounded-lg text-[13px] font-normal"
              onClick={() => {
                setView("chat");
                void newSession();
              }}
            >
              <SquarePenIcon data-icon="inline-start" strokeWidth={1.7} /> {t("新聊天", locale)}
            </Button>
          </div>

          <nav aria-label={t("聊天", locale)} className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
            {recentProjects.length > 0 && (
              <section className="flex flex-col gap-1 pb-3">
                <h3 className="text-sidebar-foreground/70 px-2.5 py-1 text-xs">
                  {t("最近项目", locale)}
                </h3>
                {recentProjects.map((directory) => {
                  const chats = active.get(directory);
                  const expanded = Boolean(chats) && !collapsedProjects.includes(directory);
                  // 草稿没有会话行可以高亮，用项目行表示当前位置。
                  const current = !sessionId && directory === projectDirectory;
                  const parent = projectParents.get(directory);
                  const newChatLabel = t("在此项目新建聊天", locale);
                  const Icon = chats ? ChevronRightIcon : FolderIcon;
                  return (
                    <section key={directory} aria-label={directory}>
                      <div
                        className={cn(
                          "group hover:bg-sidebar-accent/65 flex items-center rounded-lg transition-colors",
                          current && "bg-sidebar-accent",
                        )}
                      >
                        <button
                          type="button"
                          aria-expanded={chats ? expanded : undefined}
                          aria-current={current ? "location" : undefined}
                          title={directory}
                          disabled={!chats && choosingProject}
                          // 没有聊天的项目没有可折叠的内容，点击直接在里面开始新聊天。
                          onClick={() =>
                            chats ? toggleProject(directory) : void selectProject({ directory })
                          }
                          className="focus-visible:ring-sidebar-ring flex min-w-0 flex-1 items-center gap-2 rounded-lg py-1.5 pr-2 pl-2.5 text-left text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-inset"
                        >
                          <Icon
                            aria-hidden="true"
                            className={cn(
                              "text-muted-foreground size-4 shrink-0 motion-safe:transition-transform",
                              expanded && "rotate-90",
                            )}
                          />
                          <span className="truncate">{referenceName(directory)}</span>
                          {parent && (
                            <span className="text-muted-foreground min-w-0 shrink-[2] truncate text-xs">
                              {parent}
                            </span>
                          )}
                        </button>
                        <button
                          type="button"
                          aria-label={newChatLabel}
                          title={newChatLabel}
                          disabled={choosingProject}
                          onClick={() => void selectProject({ directory })}
                          className={cn(
                            ROW_ACTION,
                            "mr-1 hidden shrink-0 group-hover:block group-has-[:focus-visible]:block",
                          )}
                        >
                          <SquarePenIcon className="size-3.5" />
                        </button>
                      </div>
                      {expanded && chats?.map((chat) => renderSessionRow(chat, true))}
                    </section>
                  );
                })}
              </section>
            )}
            {unlinked && (
              <section className="pb-3" aria-label={t("未关联项目", locale)}>
                <h3 className="text-sidebar-foreground/70 px-2.5 py-1 text-xs">
                  {t("未关联项目", locale)}
                </h3>
                {unlinked.map((chat) => renderSessionRow(chat))}
              </section>
            )}
            {sessions.length === 0 && recentProjects.length === 0 && (
              <output className="flex flex-col gap-0.5 px-2.5 py-1">
                <span className="text-[13px]">{t("还没有聊天", locale)}</span>
                <span className="text-sidebar-foreground/70 text-xs leading-5">
                  {t("打开项目或发送第一条消息后，聊天会出现在这里。", locale)}
                </span>
              </output>
            )}
            {archived.size > 0 && (
              <section>
                <h3 className="text-sidebar-foreground/70 px-2.5 py-1 text-xs">
                  {t("已归档", locale)}
                </h3>
                {[...archived].map(([directory, chats]) => (
                  <section key={directory ?? ""}>
                    <h4
                      className="text-muted-foreground truncate px-2.5 py-1 text-xs"
                      title={directory ?? undefined}
                    >
                      {directory ? referenceName(directory) : t("未关联项目", locale)}
                    </h4>
                    {chats.map((chat) => renderSessionRow(chat))}
                  </section>
                ))}
              </section>
            )}
          </nav>
        </>
      ) : (
        <SettingsNav />
      )}

      <SessionRenameDialog target={renameTarget} onClose={() => setRenameTarget(null)} />

      {/* 永久删除确认（面板级共享实例；弹窗放菜单内容里会随菜单关闭被卸载） */}
      <SessionDeleteDialog target={deleteTarget} onClose={() => setDeleteTarget(null)} />

      <SessionPersonaDialog target={personaTarget} onClose={() => setPersonaTarget(null)} />

      {/* 拖拽手柄（拖宽 + 拖到阈值收起） */}
      <div
        role="presentation"
        onMouseDown={startDrag}
        className="hover:bg-sidebar-ring/20 absolute inset-y-10 right-0 z-10 w-1.5 cursor-col-resize transition-colors"
        title={t("拖拽调整宽度；向左拖到底收起面板", locale)}
      />
    </aside>
  );
}
