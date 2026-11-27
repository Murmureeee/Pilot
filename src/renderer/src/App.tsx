// @env browser
import { cn } from "cn";
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState, type JSX } from "react";

import { BackupRestoreResult } from "@renderer/components/ai/backup-restore-result";
import { ChatHeader } from "@renderer/components/ai/chat-header";
import { CommandPalette } from "@renderer/components/ai/command-palette";
import { FeedbackBar } from "@renderer/components/ai/feedback-bar";
import { WorktreeArchiveDialog } from "@renderer/components/ai/git-worktree-dialog";
import { PagePreviewPanel } from "@renderer/components/ai/page-preview-panel";
import { ProjectDropTarget } from "@renderer/components/ai/project-drop-target";
import { PromptTemplateDialog } from "@renderer/components/ai/prompt-template-dialog";
import { ReviewChanges } from "@renderer/components/ai/review-changes";
import { ReviewPanel } from "@renderer/components/ai/review-panel";
import { TopBar } from "@renderer/components/ai/top-bar";
import { VerificationPanel } from "@renderer/components/ai/verification-panel";
import { WorkspaceReferencePanel } from "@renderer/components/ai/workspace-reference-panel";
import { useGitReview } from "@renderer/hooks/use-git-review";
import { useStopShortcut } from "@renderer/hooks/use-stop-shortcut";
import { useVerificationStatus } from "@renderer/hooks/use-verification-status";
import { useWorkbenchCommands } from "@renderer/hooks/use-workbench-commands";
import {
  REVIEW_PANEL_ID,
  REVIEW_THREE_COLUMN_WIDTH,
  REVIEW_TWO_COLUMN_WIDTH,
} from "@renderer/lib/constants";
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
import { promptParameters } from "@renderer/lib/prompt-templates";
import { reviewLayout } from "@renderer/lib/review-layout";
import { popupOwnsShortcut } from "@renderer/lib/shortcut-overlays";
import { applyTheme, loadTheme, watchSystemTheme } from "@renderer/lib/theme";
import type {
  ComposerAction,
  ComposerShortcut,
  ComposerShortcuts,
  PromptTemplateRequest,
  ReviewTab,
} from "@renderer/lib/types";
import { isTerminalShortcut, windowShortcutAction } from "@renderer/lib/window-shortcuts";
import {
  selectCurrentRun,
  selectPlanReview,
  selectProjectDirectory,
  selectWorkingDirectory,
  useAgentStore,
} from "@renderer/stores/agent";
import { useFileChangesStore } from "@renderer/stores/file-changes";
import { activateReview, closeReview, useReviewStore } from "@renderer/stores/review";
import { useWorkspaceReferenceStore } from "@renderer/stores/workspace-reference";
import { ChatView } from "@renderer/views/ChatView";
import { SettingsView } from "@renderer/views/SettingsView";
import { SidebarPanel } from "@renderer/views/Sidebar";
import { AppRail } from "@renderer/views/sidebar/AppRail";
import { LOCALE_DETAILS } from "@shared/constants";
import type { TranscriptLocation } from "@shared/contract";

const TerminalPanel = lazy(() => import("@renderer/components/ai/terminal-panel"));

export default function App(): JSX.Element {
  const view = useAgentStore((s) => s.view);
  const revealRequest = useAgentStore((s) => s.revealRequest);
  const init = useAgentStore((s) => s.init);
  const sessions = useAgentStore((s) => s.sessions);
  const sessionId = useAgentStore((s) => s.sessionId);
  const composerId = useAgentStore((s) => s.composerId);
  const workingDirectory = useAgentStore(selectWorkingDirectory);
  const projectDirectory = useAgentStore(selectProjectDirectory);
  const worktreeArchiveSession = useAgentStore((state) => state.worktreeArchiveSession);
  const locale = useLocale();
  const setPaletteOpen = useAgentStore((s) => s.setPaletteOpen);
  const [sidebarWidth, setSidebarWidth] = useState(loadSidebarWidth);
  const [collapsed, setCollapsed] = useState(loadSidebarCollapsed);
  const [dragging, setDragging] = useState(false);
  const [windowWidth, setWindowWidth] = useState(() => window.innerWidth);
  const [preferredReviewWidth, setReviewWidth] = useState(loadReviewWidth);
  const [openSidebarScope, setOpenSidebarScope] = useState<string | null>(null);
  const [composerAction, setComposerAction] = useState<ComposerAction | null>(null);
  const [templateRequest, setTemplateRequest] = useState<PromptTemplateRequest | null>(null);
  const composerShortcuts = useRef<ComposerShortcuts>(null);
  const canEdit = useAgentStore((state) =>
    Boolean(
      state.composerId &&
      !state.pendingPermissions.length &&
      !state.pendingProjectTrust &&
      !selectPlanReview(state),
    ),
  );
  const canRecall = useAgentStore(
    (state) =>
      state.composerDraft.length === 0 &&
      state.draftImages.length === 0 &&
      state.messages.some(({ role }) => role === "user"),
  );
  const stoppableRunId = useAgentStore((state) =>
    state.status === "streaming" && state.pendingPermissions.length === 0
      ? (selectCurrentRun(state)?.runId ?? null)
      : null,
  );
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
  const reviewOverlay = reviewOpen && layout.overlay;
  const conversationVisible = view === "chat" && !sidebarOverlay && !reviewOverlay;
  const { showHint, press, clear } = useStopShortcut(conversationVisible ? stoppableRunId : null);
  const enabledComposerShortcuts = useMemo<Record<ComposerShortcut, boolean>>(
    () => ({
      "focus-composer": Boolean(composerId),
      "find-chat": sessionId !== null,
      "cycle-approval-mode": canEdit,
      "recall-message": canEdit && canRecall,
      "stop-run": stoppableRunId !== null,
    }),
    [composerId, canEdit, canRecall, sessionId, stoppableRunId],
  );

  const openChatFind = useCallback((query?: string, location?: TranscriptLocation): void => {
    const store = useAgentStore.getState();
    const { sessionId: activeSessionId, chatFind } = store;
    if (!activeSessionId) return;
    store.setView("chat");
    setOpenSidebarScope(null);
    if (window.innerWidth < REVIEW_TWO_COLUMN_WIDTH) useReviewStore.getState().close();
    if (query !== undefined || chatFind?.sessionId !== activeSessionId)
      store.setChatFind({ sessionId: activeSessionId, query: query ?? "", location });
    requestAnimationFrame(() => {
      if (useAgentStore.getState().sessionId !== activeSessionId) return;
      const input = document.querySelector<HTMLInputElement>("[data-chat-find-input]");
      input?.focus({ preventScroll: true });
      if (query === undefined) input?.select();
    });
  }, []);

  const editComposer = useCallback((action: ComposerAction): void => {
    useAgentStore.getState().setView("chat");
    setOpenSidebarScope(null);
    if (window.innerWidth < REVIEW_TWO_COLUMN_WIDTH) useReviewStore.getState().close();
    setComposerAction(action);
  }, []);

  const openCommandReview = (target: ReviewTab): void => {
    const agent = useAgentStore.getState();
    if (!agent.composerId) return;
    const trigger = document.activeElement;
    agent.setView("chat");
    setOpenSidebarScope(null);
    useReviewStore
      .getState()
      .show(agent.composerId, target, trigger instanceof HTMLElement ? trigger : undefined);
  };

  const runComposerShortcut = useCallback(
    (shortcut: ComposerShortcut): void => {
      if (!enabledComposerShortcuts[shortcut]) return;
      if (shortcut === "find-chat") {
        openChatFind();
        return;
      }
      const store = useAgentStore.getState();
      if (shortcut === "stop-run") {
        clear();
        const run = selectCurrentRun(store);
        if (run && run.runId === stoppableRunId) store.abort(run);
        return;
      }
      editComposer({ shortcut });
    },
    [clear, editComposer, enabledComposerShortcuts, openChatFind, stoppableRunId],
  );

  useEffect(() => {
    if (!composerAction || !conversationVisible) return;
    const frame = requestAnimationFrame(() => {
      setComposerAction(null);
      if (
        "composerId" in composerAction &&
        useAgentStore.getState().composerId !== composerAction.composerId
      )
        return;
      document
        .querySelector<HTMLElement>(
          "main :is([data-permission-card], [data-project-trust-card], [data-plan-review], [data-composer-editor])",
        )
        ?.focus();
      const editor = composerShortcuts.current;
      if ("menu" in composerAction) editor?.openMenu(composerAction.menu);
      else if ("prompt" in composerAction) editor?.appendPrompt(composerAction.prompt);
      else if ("draft" in composerAction) {
        if (
          selectWorkingDirectory(useAgentStore.getState()) === composerAction.workingDirectory &&
          editor?.appendDraft(composerAction.draft)
        )
          composerAction.onInserted();
      } else if (composerAction.shortcut === "cycle-approval-mode") editor?.cycleMode();
      else if (composerAction.shortcut === "recall-message") editor?.recallMessage();
    });
    return () => cancelAnimationFrame(frame);
  }, [composerAction, conversationVisible]);

  useEffect(() => {
    void window.pi.setConversationVisible(conversationVisible).catch(() => {});
  }, [conversationVisible]);

  useEffect(() => {
    if (!revealRequest) return;
    useReviewStore.getState().close();
    let focusFrame = 0;
    const revealFrame = requestAnimationFrame(() => {
      setOpenSidebarScope(null);
      focusFrame = requestAnimationFrame(() => {
        const main = document.querySelector("main");
        const target =
          main?.querySelector<HTMLElement>(
            "[data-permission-card], [data-project-trust-card], [data-plan-review]",
          ) ??
          main?.querySelector<HTMLElement>("[data-model-failure] button") ??
          main?.querySelector<HTMLElement>('[contenteditable="true"]') ??
          main;
        target?.focus({ preventScroll: true });
      });
    });
    return () => {
      cancelAnimationFrame(revealFrame);
      cancelAnimationFrame(focusFrame);
    };
  }, [revealRequest]);
  const git = useGitReview(canReview ? composerId : null, workingDirectory);
  const commands = useWorkbenchCommands({
    canEdit,
    canReview,
    hasGit: Boolean(git.view),
    shortcuts: enabledComposerShortcuts,
    runShortcut: runComposerShortcut,
    editComposer,
    openReview: openCommandReview,
    requestTemplate: (template, insert) => {
      if (promptParameters(template.text).length) setTemplateRequest({ template, insert });
      else insert(template.text);
    },
  });
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

  useEffect(() => {
    const onKey = (event: KeyboardEvent): void => {
      const store = useAgentStore.getState();
      if (event.key !== "Escape" || event.defaultPrevented) clear();
      if (event.defaultPrevented || event.isComposing) return;
      if (event.key === "Escape") {
        if (event.repeat) return;
        if (
          event.altKey ||
          event.ctrlKey ||
          event.metaKey ||
          event.shiftKey ||
          store.view !== "chat" ||
          store.paletteOpen ||
          popupOwnsShortcut(event)
        ) {
          clear();
          return;
        }
        if (sidebarOverlay) {
          event.preventDefault();
          clear();
          setOpenSidebarScope(null);
          document.getElementById("sidebar-toggle")?.focus();
        } else if (reviewOverlay) {
          event.preventDefault();
          clear();
          closeReview();
        } else if (store.chatFind?.sessionId === store.sessionId) {
          event.preventDefault();
          clear();
          store.setChatFind(null);
        } else if (store.pendingPermissions.length || store.pendingProjectTrust) {
          event.preventDefault();
          clear();
          document
            .querySelector<HTMLButtonElement>(
              '[data-permission-card] button[aria-keyshortcuts="Escape"], [data-project-trust-card] button[aria-keyshortcuts="Escape"]',
            )
            ?.click();
        } else {
          const run = selectCurrentRun(store);
          if (run && run.runId === stoppableRunId) {
            event.preventDefault();
            press(run);
          }
        }
        return;
      }
      const windowAction = windowShortcutAction(event);
      if (windowAction) {
        event.preventDefault();
        void store.menuAction(windowAction);
        return;
      }
      if (event.altKey || !(event.ctrlKey || event.metaKey)) return;
      const key = event.key.toLowerCase();
      if (key === "l" && !event.shiftKey) {
        if (event.repeat || store.paletteOpen || popupOwnsShortcut(event)) return;
        event.preventDefault();
        runComposerShortcut("focus-composer");
      } else if (key === "f" && !event.shiftKey && store.view === "chat" && store.sessionId) {
        if (event.repeat || store.paletteOpen || popupOwnsShortcut(event)) return;
        event.preventDefault();
        runComposerShortcut("find-chat");
      } else if (key === "k") {
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
      } else if (isTerminalShortcut(event) && store.view === "chat" && canReview) {
        if (event.repeat || store.paletteOpen || popupOwnsShortcut(event)) return;
        event.preventDefault();
        const trigger = document.activeElement;
        activateReview(
          "terminal",
          trigger instanceof HTMLElement &&
            !document.getElementById(REVIEW_PANEL_ID)?.contains(trigger)
            ? trigger
            : undefined,
        );
      } else if (
        event.shiftKey &&
        (key === "d" || key === "t") &&
        store.view === "chat" &&
        canReview
      ) {
        if (event.repeat || store.paletteOpen || popupOwnsShortcut(event)) return;
        event.preventDefault();
        activateReview(key === "d" ? "changes" : "verification");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [
    canReview,
    clear,
    press,
    reviewOverlay,
    runComposerShortcut,
    setPaletteOpen,
    sidebarOverlay,
    stoppableRunId,
    togglePanel,
  ]);

  const title = sessions.find((s) => s.id === sessionId)?.title ?? t("新会话", locale);

  return (
    <div className="grid h-screen grid-cols-[max-content_minmax(0,1fr)] grid-rows-[var(--app-titlebar-height)_minmax(0,1fr)] overflow-hidden bg-window-frame text-foreground">
      <div className="app-drag flex items-center pr-3 pl-[calc(env(titlebar-area-x,0px)_+_0.75rem)]">
        <TopBar
          collapsed={sidebarCollapsed}
          onToggleSidebar={togglePanel}
          reviewOpen={reviewOpen}
          canReview={view === "chat" && canReview}
          composerShortcuts={enabledComposerShortcuts}
          onComposerShortcut={runComposerShortcut}
        />
      </div>
      <div className="app-drag" aria-hidden="true" />

      <div className="col-span-2 flex min-h-0 pt-1.5 pr-2.5 pb-2.5">
        <AppRail collapsed={sidebarCollapsed} onExpand={expandSidebar} />
        <ProjectDropTarget>
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
              feedback={sidebarOverlay && <FeedbackBar />}
            />
          </div>
          <div className="relative flex min-h-0 min-w-0 flex-1">
            <main
              inert={sidebarOverlay || reviewOverlay}
              tabIndex={-1}
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
                  {!sidebarOverlay && !reviewOverlay && <FeedbackBar />}
                  <ChatView
                    workingDirectory={workingDirectory}
                    projectDirectory={projectDirectory}
                    shortcutRef={composerShortcuts}
                    showStopHint={showHint}
                    commands={commands}
                  />
                </>
              ) : (
                <>
                  {!sidebarOverlay && <FeedbackBar />}
                  <SettingsView />
                </>
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
                feedback={reviewOverlay && !sidebarOverlay && <FeedbackBar />}
                changes={
                  <ReviewChanges
                    composerId={composerId}
                    sessionId={sessionId}
                    workingDirectory={workingDirectory}
                    active={reviewOpen && tab === "changes"}
                    latestReply={latestReply}
                    git={git}
                    onAppendAnnotations={
                      workingDirectory && canEdit
                        ? (draft, onInserted) =>
                            editComposer({ draft, composerId, workingDirectory, onInserted })
                        : undefined
                    }
                  />
                }
                files={
                  reference ? (
                    <WorkspaceReferencePanel
                      composerId={composerId}
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
                    onRepairStarted={() => {
                      if (useAgentStore.getState().composerId === composerId)
                        editComposer({ shortcut: "focus-composer" });
                    }}
                  />
                }
                terminal={
                  <Suspense
                    fallback={
                      <p className="px-3 py-4 text-xs text-muted-foreground">
                        {t("正在加载终端…", locale)}
                      </p>
                    }
                  >
                    <TerminalPanel composerId={composerId} workingDirectory={workingDirectory} />
                  </Suspense>
                }
                preview={
                  <PagePreviewPanel
                    key={workingDirectory}
                    composerId={composerId}
                    canEdit={canEdit}
                    onAppend={(prompt) => editComposer({ prompt, composerId })}
                  />
                }
              />
            )}
          </div>
        </ProjectDropTarget>
      </div>

      <BackupRestoreResult />
      <CommandPalette commands={commands} onOpenChatFind={openChatFind} />
      {worktreeArchiveSession && (
        <WorktreeArchiveDialog key={worktreeArchiveSession} sessionId={worktreeArchiveSession} />
      )}
      {templateRequest && (
        <PromptTemplateDialog request={templateRequest} onClose={() => setTemplateRequest(null)} />
      )}
    </div>
  );
}
