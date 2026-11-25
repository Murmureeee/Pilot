// @env browser
import { HouseIcon, SearchIcon, SettingsIcon, SquarePenIcon } from "lucide-react";
import { useCallback, type JSX, type MouseEvent as ReactMouseEvent } from "react";

import { UpdateRailButton } from "@renderer/components/ai/update-panel";
import { Button } from "@renderer/components/ui/button";
import { RAIL_EXPAND_THRESHOLD } from "@renderer/lib/constants";
import { t, useLocale } from "@renderer/lib/i18n";
import { useAgentStore } from "@renderer/stores/agent";

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
          className="absolute inset-y-10 right-0 z-10 w-1.5 cursor-col-resize transition-colors hover:bg-sidebar-ring/20"
          title={t("向右拖拽展开面板", locale)}
        />
      )}
    </div>
  );
}
