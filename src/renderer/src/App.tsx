// @env browser
import { cn } from "cn";
import { useCallback, useEffect, useMemo, useState, type JSX } from "react";

import { ChatHeader } from "@renderer/components/ai/chat-header";
import { CommandPalette } from "@renderer/components/ai/command-palette";
import { ReviewChanges } from "@renderer/components/ai/review-changes";
import { ReviewPanel } from "@renderer/components/ai/review-panel";
import { TopBar } from "@renderer/components/ai/top-bar";
import { VerificationPanel } from "@renderer/components/ai/verification-panel";
import { WorkspaceReferencePanel } from "@renderer/components/ai/workspace-reference-panel";
import { useGitReview } from "@renderer/hooks/use-git-review";
import { useVerificationStatus } from "@renderer/hooks/use-verification-status";
import { REVIEW_THREE_COLUMN_WIDTH, REVIEW_TWO_COLUMN_WIDTH } from "@renderer/lib/constants";
import {
  changesForReply,
  latestFileChangesReply,
  summarizeChanges,
} from "@renderer/lib/file-changes";
import { t, useLocale } from "@renderer/lib/i18n";
import {
  loadReviewWidth,
  loadSidebarCollapsed,
  loadSidebarWidth,
  saveReviewWidth,
  saveSidebarCollapsed,
  saveSidebarWidth,
} from "@renderer/lib/preferences";
import { reviewLayout } from "@renderer/lib/review-layout";
import { applyTheme, loadTheme, watchSystemTheme } from "@renderer/lib/theme";
import { windowShortcutAction } from "@renderer/lib/window-shortcuts";
import {
  selectProjectDirectory,
  selectWorkingDirectory,
  useAgentStore,
} from "@renderer/stores/agent";
import { useFileChangesStore } from "@renderer/stores/file-changes";
import { activateReview, useReviewStore } from "@renderer/stores/review";
import { useWorkspaceReferenceStore } from "@renderer/stores/workspace-reference";
import { ChatView } from "@renderer/views/ChatView";
import { SettingsView } from "@renderer/views/SettingsView";
import { SidebarPanel } from "@renderer/views/Sidebar";
import { AppRail } from "@renderer/views/sidebar/AppRail";
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
  const [sidebarWidth, setSidebarWidth] = useState(loadSidebarWidth);
  const [collapsed, setCollapsed] = useState(loadSidebarCollapsed);
  const [dragging, setDragging] = useState(false);
  const [windowWidth, setWindowWidth] = useState(() => window.innerWidth);
  const [preferredReviewWidth, setReviewWidth] = useState(loadReviewWidth);
  const [openSidebarScope, setOpenSidebarScope] = useState<string | null>(null);
  const reviewAttached = useReviewStore(
    (state) => composerId !== null && state.composerId === composerId,
  );
  const requestedOpen = useReviewStore((state) => state.open);
  const tab = useReviewStore((state) => state.tab);
  const canReview = Boolean(composerId && (workingDirectory || sessionId));
  const reviewOpen = view === "chat" && canReview && reviewAttached && requestedOpen;
  const compactSidebar =
    view === "chat" &&
    (windowWidth < REVIEW_TWO_COLUMN_WIDTH ||
      (reviewOpen && windowWidth < REVIEW_THREE_COLUMN_WIDTH));
  const sidebarScope = compactSidebar ? composerId + ":" + reviewOpen : null;
  if (openSidebarScope !== null && openSidebarScope !== sidebarScope) setOpenSidebarScope(null);
  const sidebarOverlay = sidebarScope !== null && openSidebarScope === sidebarScope;
  const sidebarCollapsed = compactSidebar ? !sidebarOverlay : collapsed;
  const layout = reviewLayout(
    windowWidth,
    sidebarWidth,
    collapsed,
    reviewOpen,
    preferredReviewWidth,
  );
  const git = useGitReview(canReview ? composerId : null, workingDirectory);
  const verificationStatus = useVerificationStatus(canReview ? composerId : null);
  const messages = useAgentStore((state) => (git.view ? null : state.messages));
  const latestReply = useMemo(
    () => (messages ? latestFileChangesReply(messages) : undefined),
    [messages],
  );
  const toolReview = useFileChangesStore((state) =>
    state.review?.sessionId === sessionId ? state.review.replyId : undefined,
  );
  const reference = useWorkspaceReferenceStore((state) =>
    state.reference?.sessionId === sessionId ? state.reference : null,
  );
  const changeCount = useMemo(() => {
    if (git.view?.changes) return new Set(git.view.changes.map(({ path }) => path)).size;
    const replyId = toolReview ?? latestReply;
    return messages && replyId
      ? summarizeChanges(changesForReply(messages, replyId)).count
      : git.view === null
        ? 0
        : undefined;
  }, [git.view, messages, latestReply, toolReview]);

  const refreshGit = git.refresh;
  useEffect(() => {
    if (reviewOpen) refreshGit();
  }, [reviewOpen, refreshGit]);

  const rememberCollapsed = useCallback((value: boolean): void => {
    setCollapsed(value);
    saveSidebarCollapsed(value);
  }, []);

  const expandSidebar = useCallback((): void => {
    if (sidebarScope && useAgentStore.getState().view === "chat") setOpenSidebarScope(sidebarScope);
    else rememberCollapsed(false);
  }, [sidebarScope, rememberCollapsed]);

  const togglePanel = useCallback((): void => {
    setDragging(false);
    if (sidebarScope) setOpenSidebarScope((scope) => (scope ? null : sidebarScope));
    else rememberCollapsed(!collapsed);
  }, [collapsed, sidebarScope, rememberCollapsed]);

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
      if (
        event.key === "Escape" &&
        sidebarOverlay &&
        !event.defaultPrevented &&
        event.target instanceof Element &&
        event.target.closest("#sidebar-panel, #sidebar-toggle")
      ) {
        event.preventDefault();
        setOpenSidebarScope(null);
        document.getElementById("sidebar-toggle")?.focus();
        return;
      }
      const windowAction = windowShortcutAction(event);
      if (windowAction) {
        event.preventDefault();
        void store.menuAction(windowAction);
        return;
      }
      if (event.defaultPrevented || event.altKey || !(event.ctrlKey || event.metaKey)) return;
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
      } else if (
        event.shiftKey &&
        (key === "d" || key === "t") &&
        store.view === "chat" &&
        canReview
      ) {
        if (
          event.repeat ||
          store.paletteOpen ||
          document.querySelector('[role="dialog"][data-open]')
        )
          return;
        event.preventDefault();
        activateReview(key === "d" ? "changes" : "verification");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [canReview, setPaletteOpen, sidebarOverlay, togglePanel]);

  const title = sessions.find((s) => s.id === sessionId)?.title ?? t("新会话", locale);

  return (
    <div className="grid h-screen grid-cols-[max-content_minmax(0,1fr)] grid-rows-[var(--app-titlebar-height)_minmax(0,1fr)] overflow-hidden bg-window-frame text-foreground">
      <div className="app-drag flex items-center px-3">
        <TopBar
          collapsed={sidebarCollapsed}
          onToggleSidebar={togglePanel}
          reviewOpen={reviewOpen}
          canReview={view === "chat" && canReview}
        />
      </div>
      <div className="app-drag" aria-hidden="true" />

      <div className="col-span-2 flex min-h-0 pt-1.5 pr-2.5 pb-2.5">
        <AppRail collapsed={sidebarCollapsed} onExpand={expandSidebar} />
        <div className="relative flex min-w-0 flex-1 overflow-hidden rounded-xl border border-sidebar-border bg-background">
          {sidebarOverlay && (
            <button
              type="button"
              tabIndex={-1}
              aria-label={t("隐藏侧边栏", locale)}
              className="absolute inset-0 z-20 bg-foreground/20"
              onClick={() => setOpenSidebarScope(null)}
            />
          )}
          <div className={cn(sidebarOverlay ? "absolute inset-y-0 left-0 z-20" : "contents")}>
            <SidebarPanel
              width={layout.sidebarWidth}
              animateWidth={!dragging && !compactSidebar && !reviewOpen}
              onResize={setSidebarWidth}
              onDragStart={() => setDragging(true)}
              onDragEnd={(width) => {
                saveSidebarWidth(width);
                setDragging(false);
              }}
              onCollapse={() => {
                setDragging(false);
                if (compactSidebar) setOpenSidebarScope(null);
                else rememberCollapsed(true);
              }}
              collapsed={sidebarCollapsed}
            />
          </div>
          <div className="relative flex min-h-0 min-w-0 flex-1">
            <main
              inert={sidebarOverlay || (reviewOpen && layout.overlay)}
              className="flex min-h-0 min-w-0 flex-1 flex-col"
            >
              {view === "chat" ? (
                <>
                  <ChatHeader
                    title={title}
                    composerId={composerId}
                    workingDirectory={workingDirectory}
                    projectDirectory={projectDirectory}
                    reviewOpen={reviewOpen}
                    canReview={canReview}
                    changeCount={changeCount}
                    verificationStatus={verificationStatus}
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
            {reviewAttached && composerId && (
              <ReviewPanel
                key={composerId}
                open={reviewOpen}
                overlay={layout.overlay}
                inert={sidebarOverlay}
                width={layout.reviewWidth}
                range={layout.range}
                onResize={setReviewWidth}
                onSave={saveReviewWidth}
                count={changeCount}
                verificationStatus={verificationStatus}
                changes={
                  <ReviewChanges
                    composerId={composerId}
                    sessionId={sessionId}
                    workingDirectory={workingDirectory}
                    active={reviewOpen && tab === "changes"}
                    latestReply={latestReply}
                    git={git}
                  />
                }
                files={
                  reference ? (
                    <WorkspaceReferencePanel
                      reference={reference}
                      active={reviewOpen && tab === "files"}
                    />
                  ) : (
                    <p className="px-3 py-4 text-xs text-muted-foreground">
                      {t("选择对话中的文件链接或引用以预览。", locale)}
                    </p>
                  )
                }
                verification={
                  <VerificationPanel
                    composerId={composerId}
                    visible={reviewOpen && tab === "verification"}
                  />
                }
              />
            )}
          </div>
        </div>
      </div>

      <CommandPalette canReview={view === "chat" && canReview} />
    </div>
  );
}
