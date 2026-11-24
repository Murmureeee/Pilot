// @env browser
import { useCallback, useEffect, useState, type JSX } from "react";
import { ChatHeader } from "@renderer/components/ai/chat-header";
import { CommandPalette } from "@renderer/components/ai/command-palette";
import { FileChangesPanel } from "@renderer/components/ai/file-changes-panel";
import { GitChangesPanel } from "@renderer/components/ai/git-changes-panel";
import { TopBar } from "@renderer/components/ai/top-bar";
import { WorkspaceReferencePanel } from "@renderer/components/ai/workspace-reference-panel";
import { AppRail, SidebarPanel } from "@renderer/views/Sidebar";
import { ChatView } from "@renderer/views/ChatView";
import { SettingsView } from "@renderer/views/SettingsView";
import { applyTheme, loadTheme, watchSystemTheme } from "@renderer/lib/theme";
import {
  FILE_CHANGES_MIN_WINDOW_WIDTH,
  FILE_REVIEW_MIN_WINDOW_WIDTH,
} from "@renderer/lib/constants";
import { t, useLocale } from "@renderer/lib/i18n";
import { windowShortcutAction } from "@renderer/lib/window-shortcuts";
import {
  selectProjectDirectory,
  selectWorkingDirectory,
  useAgentStore,
} from "@renderer/stores/agent";
import { useFileChangesStore } from "@renderer/stores/file-changes";
import { useWorkspaceReferenceStore } from "@renderer/stores/workspace-reference";
import { LOCALE_DETAILS } from "@shared/constants";

export default function App(): JSX.Element {
  const view = useAgentStore((s) => s.view);
  const init = useAgentStore((s) => s.init);
  const sessions = useAgentStore((s) => s.sessions);
  const sessionId = useAgentStore((s) => s.sessionId);
  const composerId = useAgentStore((s) => s.composerId);
  const workingDirectory = useAgentStore(selectWorkingDirectory);
  const projectDirectory = useAgentStore(selectProjectDirectory);
  const locale = useLocale();
  const setPaletteOpen = useAgentStore((s) => s.setPaletteOpen);
  const [sidebarWidth, setSidebarWidth] = useState(262);
  const [collapsed, setCollapsed] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [windowWidth, setWindowWidth] = useState(() => window.innerWidth);
  const review = useFileChangesStore((state) => state.review);
  const closeReview = useFileChangesStore((state) => state.close);
  const visibleReview = view === "chat" && review?.sessionId === sessionId ? review : null;
  const gitComposerId = useFileChangesStore((state) => state.gitComposerId);
  const visibleGitReview = view === "chat" && composerId === gitComposerId ? gitComposerId : null;
  const reference = useWorkspaceReferenceStore((state) => state.reference);
  const visibleReference = view === "chat" && reference?.sessionId === sessionId ? reference : null;
  const reviewMinWidth =
    (visibleReview || visibleGitReview) && !visibleReference
      ? FILE_CHANGES_MIN_WINDOW_WIDTH
      : FILE_REVIEW_MIN_WINDOW_WIDTH;
  const compactReview =
    !!(visibleReview || visibleGitReview || visibleReference) &&
    windowWidth < reviewMinWidth + sidebarWidth;
  const sidebarCollapsed = collapsed || compactReview;

  const expandSidebar = useCallback((): void => {
    if (compactReview && useAgentStore.getState().view === "chat") {
      useWorkspaceReferenceStore.getState().close();
      closeReview();
    }
    setCollapsed(false);
  }, [closeReview, compactReview]);

  const togglePanel = useCallback((): void => {
    setDragging(false);
    if (sidebarCollapsed) expandSidebar();
    else setCollapsed(true);
  }, [expandSidebar, sidebarCollapsed]);

  useEffect(() => {
    const resize = (): void => setWindowWidth(window.innerWidth);
    window.addEventListener("resize", resize);
    return () => window.removeEventListener("resize", resize);
  }, []);

  useEffect(() => {
    void init();
    // 主题恢复 + 跟随系统时的实时切换
    applyTheme(loadTheme());
    return watchSystemTheme(() => applyTheme(loadTheme()));
  }, [init]);

  useEffect(() => {
    document.documentElement.lang = LOCALE_DETAILS[locale].htmlLang;
  }, [locale]);

  // 全局快捷键：Ctrl+K 面板 / Ctrl+N 新聊天 / Ctrl+[ ] 导航 / Ctrl+, 设置 / Ctrl+Shift+S 侧栏 / 窗口级动作
  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const store = useAgentStore.getState();
      const windowAction = windowShortcutAction(event);
      if (windowAction) {
        event.preventDefault();
        void store.menuAction(windowAction);
        return;
      }
      if (!(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === "k") {
        event.preventDefault();
        setPaletteOpen(!store.paletteOpen);
      } else if (key === "n") {
        event.preventDefault();
        store.setView("chat");
        void store.newSession();
      } else if (key === "o") {
        event.preventDefault();
        void store.selectProject();
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
        togglePanel();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [setPaletteOpen, togglePanel]);

  const title = sessions.find((s) => s.id === sessionId)?.title ?? t("新会话", locale);

  return (
    <div className="bg-window-frame text-foreground grid h-screen grid-cols-[max-content_minmax(0,1fr)] grid-rows-[var(--app-titlebar-height)_minmax(0,1fr)] overflow-hidden">
      <div className="app-drag flex items-center px-3">
        <TopBar collapsed={sidebarCollapsed} onToggleSidebar={togglePanel} />
      </div>
      <div className="app-drag" aria-hidden="true" />

      <div className="col-span-2 flex min-h-0 pt-1.5 pr-2.5 pb-2.5">
        <AppRail collapsed={sidebarCollapsed} onExpand={expandSidebar} />
        <div className="border-sidebar-border bg-background flex min-w-0 flex-1 overflow-hidden rounded-xl border">
          <SidebarPanel
            width={sidebarWidth}
            animateWidth={!dragging && !compactReview}
            onResize={setSidebarWidth}
            onDragStart={() => setDragging(true)}
            onDragEnd={() => setDragging(false)}
            onCollapse={() => {
              setDragging(false);
              setCollapsed(true);
            }}
            collapsed={sidebarCollapsed}
          />
          <div className="flex min-h-0 min-w-0 flex-1">
            <main className="flex min-h-0 min-w-0 flex-1 flex-col">
              {view === "chat" ? (
                <>
                  <ChatHeader
                    title={title}
                    composerId={composerId}
                    workingDirectory={workingDirectory}
                    projectDirectory={projectDirectory}
                    reviewOpen={Boolean(visibleGitReview && !visibleReference)}
                  />
                  <ChatView
                    workingDirectory={workingDirectory}
                    projectDirectory={projectDirectory}
                  />
                </>
              ) : (
                <SettingsView />
              )}
            </main>
            {visibleReference ? (
              <WorkspaceReferencePanel reference={visibleReference} />
            ) : visibleGitReview ? (
              <GitChangesPanel key={visibleGitReview} composerId={visibleGitReview} />
            ) : (
              visibleReview && <FileChangesPanel review={visibleReview} />
            )}
          </div>
        </div>
      </div>

      <CommandPalette />
    </div>
  );
}
