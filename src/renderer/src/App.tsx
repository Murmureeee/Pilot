// @env browser
import { useCallback, useEffect, useRef, useState, type JSX } from "react";
import { FolderIcon, MessageSquareIcon } from "lucide-react";
import { CommandPalette } from "@renderer/components/ai/command-palette";
import { FileChangesPanel } from "@renderer/components/ai/file-changes-panel";
import { ProjectBranch, ProjectChooser } from "@renderer/components/ai/project-controls";
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
import type { ComposerDraft } from "@renderer/lib/types";
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
  const workingDirectory = useAgentStore(selectWorkingDirectory);
  const projectDirectory = useAgentStore(selectProjectDirectory);
  const locale = useLocale();
  const setPaletteOpen = useAgentStore((s) => s.setPaletteOpen);
  const [sidebarWidth, setSidebarWidth] = useState(262);
  const [collapsed, setCollapsed] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [windowWidth, setWindowWidth] = useState(() => window.innerWidth);
  const composerDrafts = useRef(new Map<string | null, ComposerDraft>());
  const review = useFileChangesStore((state) => state.review);
  const closeReview = useFileChangesStore((state) => state.close);
  const visibleReview = view === "chat" && review?.sessionId === sessionId ? review : null;
  const reference = useWorkspaceReferenceStore((state) => state.reference);
  const visibleReference = view === "chat" && reference?.sessionId === sessionId ? reference : null;
  const reviewMinWidth =
    visibleReview && !visibleReference
      ? FILE_CHANGES_MIN_WINDOW_WIDTH
      : FILE_REVIEW_MIN_WINDOW_WIDTH;
  const compactReview =
    !!(visibleReview || visibleReference) && windowWidth < reviewMinWidth + sidebarWidth;
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
            dragging={dragging}
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
                  <header className="border-border/65 flex h-12 shrink-0 items-center gap-2.5 border-b px-5">
                    <MessageSquareIcon
                      className="text-muted-foreground size-3.5 shrink-0"
                      aria-hidden="true"
                    />
                    <div className="flex min-w-0 flex-1 flex-col justify-center">
                      <span className="truncate text-[13px] font-medium" title={title}>
                        {title}
                      </span>
                      {workingDirectory && (
                        <div
                          className="text-muted-foreground flex min-w-0 items-center gap-1 text-xs"
                          title={workingDirectory}
                        >
                          <FolderIcon className="size-3 shrink-0" aria-hidden="true" />
                          {!projectDirectory && (
                            <span className="shrink-0">{t("默认工作目录", locale)}</span>
                          )}
                          <span className="truncate [direction:rtl]">
                            <bdi dir="ltr">{workingDirectory}</bdi>
                          </span>
                        </div>
                      )}
                    </div>
                    {projectDirectory ? (
                      <ProjectBranch key={projectDirectory} directory={projectDirectory} />
                    ) : (
                      <ProjectChooser sessionId={sessionId} />
                    )}
                  </header>
                  <ChatView composerDrafts={composerDrafts} workingDirectory={workingDirectory} />
                </>
              ) : (
                <SettingsView />
              )}
            </main>
            {visibleReference ? (
              <WorkspaceReferencePanel reference={visibleReference} />
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
