// @env browser
import { useEffect, useState, type JSX } from "react";
import { MessageSquareIcon } from "lucide-react";
import { CommandPalette } from "@renderer/components/ai/command-palette";
import { ConfirmationDialog } from "@renderer/components/ai/confirmation-dialog";
import { TopBar } from "@renderer/components/ai/top-bar";
import { AppRail, SidebarPanel } from "@renderer/views/Sidebar";
import { ChatView } from "@renderer/views/ChatView";
import { SettingsView } from "@renderer/views/SettingsView";
import { applyTheme, loadTheme, watchSystemTheme } from "@renderer/lib/theme";
import { t, useLocale } from "@renderer/lib/i18n";
import { useAgentStore } from "@renderer/stores/agent";
import { LOCALE_DETAILS } from "@shared/constants";

export default function App(): JSX.Element {
  const view = useAgentStore((s) => s.view);
  const init = useAgentStore((s) => s.init);
  const sessions = useAgentStore((s) => s.sessions);
  const sessionId = useAgentStore((s) => s.sessionId);
  const locale = useLocale();
  const setPaletteOpen = useAgentStore((s) => s.setPaletteOpen);
  const [sidebarWidth, setSidebarWidth] = useState(262);
  const [collapsed, setCollapsed] = useState(false);
  const [dragging, setDragging] = useState(false);

  useEffect(() => {
    void init();
    // 主题恢复 + 跟随系统时的实时切换
    applyTheme(loadTheme());
    return watchSystemTheme(() => applyTheme(loadTheme()));
  }, [init]);

  useEffect(() => {
    document.documentElement.lang = LOCALE_DETAILS[locale].htmlLang;
  }, [locale]);

  // 全局快捷键：Ctrl+K 面板 / Ctrl+N 新聊天 / Ctrl+[ ] 导航 / Ctrl+, 设置 / Ctrl+Shift+S 侧栏
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      const store = useAgentStore.getState();
      if (key === "k") {
        event.preventDefault();
        setPaletteOpen(!store.paletteOpen);
      } else if (key === "n") {
        event.preventDefault();
        store.setView("chat");
        void store.newSession();
      } else if (key === "[") {
        event.preventDefault();
        void store.navBack();
      } else if (key === "]") {
        event.preventDefault();
        void store.navForward();
      } else if (key === ",") {
        event.preventDefault();
        setCollapsed(false);
        store.setView("settings");
      } else if (key === "s" && event.shiftKey) {
        event.preventDefault();
        setDragging(false);
        setCollapsed((c) => !c);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setPaletteOpen]);

  const title = sessions.find((s) => s.id === sessionId)?.title ?? t("新会话", locale);
  const togglePanel = (): void => {
    setDragging(false);
    setCollapsed((value) => !value);
  };

  return (
    <div className="bg-window-frame text-foreground grid h-screen grid-cols-[max-content_minmax(0,1fr)] grid-rows-[var(--app-titlebar-height)_minmax(0,1fr)] overflow-hidden">
      <div className="app-drag flex items-center px-3">
        <TopBar collapsed={collapsed} onToggleSidebar={togglePanel} />
      </div>
      <div className="app-drag" aria-hidden="true" />

      <div className="col-span-2 flex min-h-0 pt-1.5 pr-2.5 pb-2.5">
        <AppRail collapsed={collapsed} onExpand={() => setCollapsed(false)} />
        <div className="border-sidebar-border bg-background flex min-w-0 flex-1 overflow-hidden rounded-xl border">
          <SidebarPanel
            width={sidebarWidth}
            dragging={dragging}
            onResize={setSidebarWidth}
            onDragStart={() => setDragging(true)}
            onDragEnd={() => setDragging(false)}
            onCollapse={() => {
              setDragging(false);
              setCollapsed(true);
            }}
            collapsed={collapsed}
          />
          <main className="flex min-h-0 min-w-0 flex-1 flex-col">
            {view === "chat" ? (
              <>
                <header className="border-border/65 flex h-12 shrink-0 items-center gap-2.5 border-b px-5">
                  <MessageSquareIcon
                    className="text-muted-foreground size-3.5 shrink-0"
                    aria-hidden="true"
                  />
                  <span className="truncate text-[13px] font-medium">{title}</span>
                </header>
                <ChatView />
              </>
            ) : (
              <SettingsView />
            )}
          </main>
        </div>
      </div>

      <ConfirmationDialog />
      <CommandPalette />
    </div>
  );
}
