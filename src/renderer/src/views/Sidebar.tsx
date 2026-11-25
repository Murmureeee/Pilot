// @env browser
import { cn } from "cn";
import { ArrowLeftIcon, SearchIcon, SquareTerminalIcon } from "lucide-react";
import { useCallback, type JSX, type MouseEvent as ReactMouseEvent } from "react";

import { Button } from "@renderer/components/ui/button";
import { SIDEBAR_MAX_WIDTH, SIDEBAR_MIN_WIDTH } from "@renderer/lib/constants";
import { t, useLocale } from "@renderer/lib/i18n";
import { useAgentStore } from "@renderer/stores/agent";
import { SettingsNav } from "@renderer/views/settings/SettingsNav";
import { SidebarChatList } from "@renderer/views/sidebar/SidebarChatList";
import { APP_NAME } from "@shared/constants";

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
  const view = useAgentStore((s) => s.view);
  const setView = useAgentStore((s) => s.setView);
  const setPaletteOpen = useAgentStore((s) => s.setPaletteOpen);
  const inChat = view === "chat";
  const headerActionLabel = t(inChat ? "搜索" : "返回对话", locale);

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
        "relative flex h-full max-w-[max(220px,calc(100vw-400px))] shrink-0 flex-col overflow-hidden bg-sidebar text-sidebar-foreground after:pointer-events-none after:absolute after:inset-y-0 after:right-0 after:w-px after:bg-sidebar-border",
        animateWidth &&
          "motion-safe:transition-[width] motion-safe:duration-200 motion-safe:ease-out",
      )}
      style={{ width: collapsed ? 0 : width }}
    >
      <div className="flex h-10 shrink-0 items-center justify-between gap-2 pr-3 pl-4">
        <h2 className="flex min-w-0 items-center gap-2.5 text-[15px] font-semibold tracking-tight">
          {inChat && (
            <span
              className="grid size-6 shrink-0 place-items-center rounded-lg bg-sidebar-accent"
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
          className="rounded-lg text-sidebar-foreground/75 hover:bg-sidebar-accent"
          onClick={inChat ? () => setPaletteOpen(true) : () => setView("chat")}
          aria-label={headerActionLabel}
          title={inChat ? t("搜索 (Ctrl+K)", locale) : headerActionLabel}
        >
          {inChat ? <SearchIcon strokeWidth={1.7} /> : <ArrowLeftIcon strokeWidth={1.7} />}
        </Button>
      </div>

      {inChat ? <SidebarChatList /> : <SettingsNav />}

      {/* 拖拽手柄（拖宽 + 拖到阈值收起） */}
      <div
        role="presentation"
        onMouseDown={startDrag}
        className="absolute inset-y-10 right-0 z-10 w-1.5 cursor-col-resize transition-colors hover:bg-sidebar-ring/20"
        title={t("拖拽调整宽度；向左拖到底收起面板", locale)}
      />
    </aside>
  );
}
