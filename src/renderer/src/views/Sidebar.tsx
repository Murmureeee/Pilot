// @env browser
import {
  useCallback,
  useState,
  type JSX,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import {
  ArchiveIcon,
  ArchiveRestoreIcon,
  ArrowLeftIcon,
  BlocksIcon,
  BotIcon,
  CheckIcon,
  CircleIcon,
  CopyIcon,
  DownloadIcon,
  GitForkIcon,
  HardDriveIcon,
  HouseIcon,
  PencilIcon,
  PinIcon,
  PinOffIcon,
  PlugIcon,
  ScrollTextIcon,
  SearchIcon,
  SettingsIcon,
  SquarePenIcon,
  SquareTerminalIcon,
  Trash2Icon,
  UserRoundIcon,
} from "lucide-react";
import { Button } from "@renderer/components/ui/button";
import { SETTINGS_SECTION_LABELS } from "@renderer/lib/constants";
import { t, useLocale } from "@renderer/lib/i18n";
import type { SettingsSection } from "@renderer/lib/types";
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from "@renderer/components/ui/context-menu";
import { useAgentStore } from "@renderer/stores/agent";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@renderer/components/ui/dialog";
import { Input } from "@renderer/components/ui/input";
import { Textarea } from "@renderer/components/ui/textarea";
import { SessionDeleteDialog } from "@renderer/components/ai/session-delete-dialog";
import { cn } from "cn";
import { APP_NAME } from "@shared/constants";
import type { SessionMeta } from "@shared/contract";

const SIDEBAR_MIN_WIDTH = 220;
const SIDEBAR_MAX_WIDTH = 520;
/** rail 右缘向右拖动超过此位移 → 动画展开 */
const RAIL_EXPAND_THRESHOLD = 80;

const SETTINGS_NAV: {
  label: string;
  items: { id: SettingsSection; icon: typeof BotIcon }[];
}[] = [
  {
    label: "应用",
    items: [
      { id: "general", icon: SettingsIcon },
      { id: "providers", icon: BotIcon },
      { id: "persona", icon: UserRoundIcon },
      { id: "data", icon: HardDriveIcon },
    ],
  },
  {
    label: "集成",
    items: [
      { id: "skills", icon: BlocksIcon },
      { id: "mcp", icon: PlugIcon },
      { id: "imports", icon: DownloadIcon },
    ],
  },
];

const RAIL_CONTROL =
  "text-sidebar-foreground/80 hover:bg-sidebar-foreground/8 hover:text-sidebar-foreground aria-[current=page]:bg-sidebar-foreground/10 aria-[current=page]:text-sidebar-foreground rounded-xl";

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

        <Button
          variant="ghost"
          size="icon-lg"
          className={cn(RAIL_CONTROL, "mt-auto")}
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
  dragging,
  onResize,
  onDragStart,
  onDragEnd,
  onCollapse,
  collapsed,
}: {
  width: number;
  dragging: boolean;
  onResize(width: number): void;
  onDragStart(): void;
  onDragEnd(): void;
  onCollapse(): void;
  collapsed: boolean;
}): JSX.Element {
  const locale = useLocale();
  const sessions = useAgentStore((s) => s.sessions);
  const sessionId = useAgentStore((s) => s.sessionId);
  const newSession = useAgentStore((s) => s.newSession);
  const loadSession = useAgentStore((s) => s.loadSession);
  const renameSession = useAgentStore((s) => s.renameSession);
  const setSessionPinned = useAgentStore((s) => s.setSessionPinned);
  const setSessionArchived = useAgentStore((s) => s.setSessionArchived);
  const setSessionUnread = useAgentStore((s) => s.setSessionUnread);
  const forkSession = useAgentStore((s) => s.forkSession);
  const copySession = useAgentStore((s) => s.copySession);
  const setSessionPersona = useAgentStore((s) => s.setSessionPersona);
  const setView = useAgentStore((s) => s.setView);
  const setPaletteOpen = useAgentStore((s) => s.setPaletteOpen);
  const view = useAgentStore((s) => s.view);
  const settingsSection = useAgentStore((s) => s.settingsSection);
  const setSettingsSection = useAgentStore((s) => s.setSettingsSection);
  // 重命名走 Dialog 弹窗（ChatGPT 同款）：显式「保存」提交，无行内编辑的焦点竞争问题；
  // Esc / 点击遮罩经 onOpenChange(false) 关闭
  const [renameTarget, setRenameTarget] = useState<SessionMeta | null>(null);
  const [renameValue, setRenameValue] = useState("");
  // 永久删除是不可恢复操作（转录文件从磁盘彻底清除），必须二次确认（共享弹窗组件）
  const [deleteTarget, setDeleteTarget] = useState<SessionMeta | null>(null);
  // 会话级人设覆盖（FR-5.9 每会话粒度）：保存空文本 = 清除回落全局
  const [personaTarget, setPersonaTarget] = useState<SessionMeta | null>(null);
  const [personaValue, setPersonaValue] = useState("");
  const inChat = view === "chat";
  const headerActionLabel = t(inChat ? "搜索" : "返回对话", locale);

  const saveSessionPersona = (): void => {
    const id = personaTarget?.id;
    setPersonaTarget(null);
    if (id) void setSessionPersona(id, personaValue.trim() || null);
  };

  const saveRename = (): void => {
    const title = renameValue.trim();
    setRenameTarget(null);
    if (renameTarget && title.length > 0 && title !== renameTarget.title) {
      void renameSession(renameTarget.id, title);
    }
  };

  // 侧栏三分区：置顶（pinned 且未归档）→ 最近 → 已归档（降权显示）
  const active = sessions.filter((s) => !s.archived);
  const pinned = active.filter((s) => s.pinned);
  const recent = active.filter((s) => !s.pinned);
  const archived = sessions.filter((s) => s.archived);

  const openSession = (id: string): void => {
    setView("chat");
    void loadSession(id);
  };

  /** 会话行：左键切换 + 悬停浮现「置顶/归档」按钮 + 右键上下文菜单（三分区共用） */
  const renderSessionRow = (s: SessionMeta): JSX.Element => (
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
              className="focus-visible:ring-sidebar-ring flex min-w-0 flex-1 items-center rounded-lg px-2.5 py-1.5 text-left text-[13px] outline-none focus-visible:ring-2 focus-visible:ring-inset"
              aria-current={s.id === sessionId ? "page" : undefined}
              title={s.title}
            >
              {/* 未读：圆点 + 加粗标题，打开会话即清除（ChatGPT 同款） */}
              {s.unread && (
                <span className="bg-sidebar-foreground/80 mr-2 size-1.5 shrink-0 rounded-full" />
              )}
              <span className={cn("truncate", s.unread && "font-semibold")}>{s.title}</span>
            </button>
            {s.id === sessionId && (
              <CheckIcon
                aria-hidden="true"
                className="pointer-events-none absolute right-2.5 size-3.5 group-focus-within:opacity-0 group-hover:opacity-0"
              />
            )}
            {/* Hover and keyboard focus share the space used by the selection indicator. */}
            <div className="mr-1 flex shrink-0 items-center gap-0.5 opacity-0 transition-opacity group-focus-within:opacity-100 group-hover:opacity-100">
              {!s.archived && (
                <button
                  type="button"
                  aria-label={s.pinned ? t("取消置顶", locale) : t("置顶聊天", locale)}
                  title={s.pinned ? t("取消置顶", locale) : t("置顶聊天", locale)}
                  onClick={() => void setSessionPinned(s.id, !s.pinned)}
                  className="hover:bg-foreground/10 hover:text-foreground text-muted-foreground rounded-sm p-1 transition-colors"
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
                  className="hover:bg-foreground/10 hover:text-foreground text-muted-foreground rounded-sm p-1 transition-colors"
                >
                  <ArchiveRestoreIcon className="size-3.5" />
                </button>
              ) : (
                <button
                  type="button"
                  aria-label={t("归档聊天", locale)}
                  title={t("归档聊天", locale)}
                  onClick={() => void setSessionArchived(s.id, true)}
                  className="hover:bg-foreground/10 hover:text-foreground text-muted-foreground rounded-sm p-1 transition-colors"
                >
                  <ArchiveIcon className="size-3.5" />
                </button>
              )}
            </div>
          </div>
        }
      />
      <ContextMenuContent className="min-w-44">
        <ContextMenuItem
          onClick={() => {
            setRenameValue(s.title);
            setRenameTarget(s);
          }}
        >
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
        <ContextMenuItem
          onClick={() => {
            setPersonaValue(s.personaOverride ?? "");
            setPersonaTarget(s);
          }}
        >
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
      const cleanup = (): void => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", onUp);
      };
      const onMove = (ev: globalThis.MouseEvent): void => {
        const next = startWidth + (ev.clientX - startX);
        // 越过下界：立即打断拖拽并播放收起动画（不等松手）
        if (next < SIDEBAR_MIN_WIDTH) {
          cleanup();
          onCollapse();
          return;
        }
        onResize(Math.min(SIDEBAR_MAX_WIDTH, next));
      };
      const onUp = (): void => {
        cleanup();
        onDragEnd();
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
        !dragging && "motion-safe:transition-[width] motion-safe:duration-200 motion-safe:ease-out",
      )}
      style={{ width: collapsed ? 0 : width }}
    >
      <div className="flex h-12 shrink-0 items-center justify-between gap-2 pr-3 pl-4">
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
              onClick={() => {
                setView("chat");
                void newSession();
              }}
            >
              <SquarePenIcon data-icon="inline-start" strokeWidth={1.7} /> {t("新聊天", locale)}
            </Button>
          </div>

          <nav aria-label={t("聊天", locale)} className="min-h-0 flex-1 overflow-y-auto px-3 pb-3">
            {pinned.length > 0 && (
              <section className="pb-3">
                <h3 className="text-sidebar-foreground/70 px-2.5 py-1 text-xs">
                  {t("置顶", locale)}
                </h3>
                {pinned.map((s) => renderSessionRow(s))}
              </section>
            )}
            {recent.length > 0 && (
              <section className="pb-3">
                <h3 className="text-sidebar-foreground/70 px-2.5 py-1 text-xs">
                  {t("最近", locale)}
                </h3>
                {recent.map((s) => renderSessionRow(s))}
              </section>
            )}
            {sessions.length === 0 && (
              <p className="text-sidebar-foreground/70 px-2.5 py-1 text-xs">
                {t("暂无会话", locale)}
              </p>
            )}
            {archived.length > 0 && (
              <section>
                <h3 className="text-sidebar-foreground/70 px-2.5 py-1 text-xs">
                  {t("已归档", locale)}
                </h3>
                {archived.map((s) => renderSessionRow(s))}
              </section>
            )}
          </nav>
        </>
      ) : (
        <nav
          aria-label={t("设置", locale)}
          className="min-h-0 flex-1 overflow-y-auto px-3 pt-1 pb-3"
        >
          <div className="flex flex-col gap-3.5">
            {SETTINGS_NAV.map((group) => (
              <section key={group.label} className="grid gap-1.5">
                <h3 className="text-sidebar-foreground/70 px-2.5 text-xs">
                  {t(group.label, locale)}
                </h3>
                <div className="flex flex-col gap-0.5">
                  {group.items.map(({ id, icon: Icon }) => {
                    const selected = settingsSection === id;
                    return (
                      <button
                        key={id}
                        type="button"
                        onClick={() => setSettingsSection(id)}
                        aria-current={selected ? "page" : undefined}
                        className={cn(
                          "hover:bg-sidebar-accent/65 focus-visible:ring-sidebar-ring flex w-full items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-left text-[13px] transition-colors outline-none focus-visible:ring-2 focus-visible:ring-inset",
                          selected && "bg-sidebar-accent",
                        )}
                      >
                        <Icon
                          aria-hidden="true"
                          className="text-sidebar-foreground/70 size-4 shrink-0"
                          strokeWidth={1.7}
                        />
                        <span className="min-w-0 flex-1 truncate">
                          {t(SETTINGS_SECTION_LABELS[id], locale)}
                        </span>
                        {selected && <CheckIcon aria-hidden="true" className="size-3.5 shrink-0" />}
                      </button>
                    );
                  })}
                </div>
              </section>
            ))}
          </div>
        </nav>
      )}

      {/* 重命名弹窗：标题 + 说明行（muted 次级）+ 输入 + 取消/保存 */}
      <Dialog
        open={renameTarget !== null}
        onOpenChange={(open) => {
          if (!open) setRenameTarget(null);
        }}
      >
        <DialogContent closeLabel={t("关闭", locale)}>
          <DialogHeader>
            <DialogTitle>{t("重命名聊天", locale)}</DialogTitle>
            <DialogDescription>{t("保持简短且易于识别", locale)}</DialogDescription>
          </DialogHeader>
          <Input
            value={renameValue}
            onChange={(e) => setRenameValue(e.target.value)}
            onKeyDown={(e: ReactKeyboardEvent<HTMLInputElement>) => {
              if (e.key === "Enter") saveRename();
            }}
            className="h-9 rounded-lg"
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setRenameTarget(null)}>
              {t("取消", locale)}
            </Button>
            <Button onClick={saveRename}>{t("保存", locale)}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* 永久删除确认（面板级共享实例；弹窗放菜单内容里会随菜单关闭被卸载） */}
      <SessionDeleteDialog target={deleteTarget} onClose={() => setDeleteTarget(null)} />

      {/* 会话指令（FR-5.9 每会话人设覆盖）：保存空文本 = 清除回落全局 */}
      <Dialog
        open={personaTarget !== null}
        onOpenChange={(open) => {
          if (!open) setPersonaTarget(null);
        }}
      >
        <DialogContent closeLabel={t("关闭", locale)}>
          <DialogHeader>
            <DialogTitle>{t("会话指令", locale)}</DialogTitle>
            <DialogDescription>
              {t("只对本会话生效，覆盖设置页的全局人设；留空保存 = 清除覆盖", locale)}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={personaValue}
            onChange={(e) => setPersonaValue(e.target.value)}
            rows={5}
            placeholder={t("例如：用英文回复；回答尽量带代码示例…", locale)}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setPersonaTarget(null)}>
              {t("取消", locale)}
            </Button>
            <Button onClick={saveSessionPersona}>{t("保存", locale)}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
