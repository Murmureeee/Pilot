// @env browser
import { FolderOpenIcon, SquarePenIcon } from "lucide-react";
import { useMemo, useRef, useState, type JSX } from "react";

import { SessionDeleteDialog } from "@renderer/components/ai/session-delete-dialog";
import {
  SessionPersonaDialog,
  SessionRenameDialog,
} from "@renderer/components/ai/session-edit-dialogs";
import { Button } from "@renderer/components/ui/button";
import { t, useLocale } from "@renderer/lib/i18n";
import { loadCollapsedProjects, saveCollapsedProjects } from "@renderer/lib/preferences";
import { projectParents, sessionRowStatus } from "@renderer/lib/sidebar";
import { referenceName } from "@renderer/lib/workspace-links";
import { selectProjectGroup, useAgentStore } from "@renderer/stores/agent";
import type { SessionMeta } from "@shared/contract";

import { ProjectRow } from "./ProjectRow";
import { SessionRow } from "./SessionRow";

const ACTION_CLASS =
  "w-full justify-start gap-2.5 rounded-lg text-[13px] font-normal text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground";

export function SidebarChatList(): JSX.Element {
  const locale = useLocale();
  const sessions = useAgentStore((s) => s.sessions);
  const sessionId = useAgentStore((s) => s.sessionId);
  const recentProjects = useAgentStore((s) => s.recentProjects);
  const projectDirectory = useAgentStore(selectProjectGroup);
  const choosingProject = useAgentStore((s) => s.choosingProject);
  const activeRuns = useAgentStore((s) => s.activeRuns);
  const interruptedRun = useAgentStore((s) => s.interruptedRun);
  const failedRun = useAgentStore((s) => s.failedRun);
  const [renameTarget, setRenameTarget] = useState<SessionMeta | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<SessionMeta | null>(null);
  const [personaTarget, setPersonaTarget] = useState<SessionMeta | null>(null);
  const [collapsed, setCollapsed] = useState(loadCollapsedProjects);
  const nav = useRef<HTMLElement>(null);
  const openProject = useRef<HTMLButtonElement>(null);

  const { active, archived, otherProjects, parents } = useMemo(() => {
    const regular = sessions.filter((session) => !session.archived);
    const sessionsByProject = Map.groupBy(
      regular.toSorted((a, b) => Number(Boolean(b.pinned)) - Number(Boolean(a.pinned))),
      (session) => session.worktree?.projectDirectory ?? session.workingDirectory ?? null,
    );
    const recent = new Set(recentProjects);
    const remainingProjects = [
      ...new Set(
        regular.flatMap(({ workingDirectory, worktree }) => {
          const directory = worktree?.projectDirectory ?? workingDirectory;
          return directory && !recent.has(directory) ? [directory] : [];
        }),
      ),
    ];
    return {
      active: sessionsByProject,
      archived: Map.groupBy(
        sessions.filter((session) => session.archived),
        (session) => session.worktree?.projectDirectory ?? session.workingDirectory ?? null,
      ),
      otherProjects: remainingProjects,
      parents: projectParents([...recentProjects, ...remainingProjects]),
    };
  }, [recentProjects, sessions]);

  const toggleProject = (directory: string): void => {
    const next = collapsed.includes(directory)
      ? collapsed.filter((item) => item !== directory)
      : [...collapsed, directory];
    setCollapsed(next);
    saveCollapsedProjects(next);
  };

  const focusRemovedProject = (directory: string): void => {
    requestAnimationFrame(() => {
      const row = nav.current?.querySelector<HTMLButtonElement>(
        '[data-project-directory="' + CSS.escape(directory) + '"]',
      );
      (row ?? openProject.current)?.focus({ preventScroll: true });
    });
  };

  const renderSession = (session: SessionMeta, nested = false): JSX.Element => (
    <SessionRow
      key={session.id}
      session={session}
      current={session.id === sessionId}
      status={sessionRowStatus(
        session,
        activeRuns.find((run) => run.sessionId === session.id) ?? null,
        interruptedRun,
        failedRun,
      )}
      nested={nested}
      onRename={setRenameTarget}
      onDelete={setDeleteTarget}
      onPersona={setPersonaTarget}
    />
  );

  const renderProjects = (
    label: string,
    directories: string[],
    recent: boolean,
  ): JSX.Element | null => {
    if (!directories.length) return null;
    return (
      <section aria-label={label} className="flex flex-col gap-1 pb-3">
        <h3 className="px-2.5 py-1 text-xs text-sidebar-foreground/70">{label}</h3>
        {directories.map((directory) => {
          const chats = active.get(directory);
          return (
            <ProjectRow
              key={directory}
              directory={directory}
              parent={parents.get(directory)}
              recent={recent}
              current={!sessionId && projectDirectory === directory}
              expanded={Boolean(chats) && !collapsed.includes(directory)}
              hasChats={Boolean(chats)}
              choosing={choosingProject}
              onToggle={() => toggleProject(directory)}
              onNewChat={() => void useAgentStore.getState().selectProject({ directory })}
              onRemoved={() => focusRemovedProject(directory)}
            >
              {chats?.map((chat) => renderSession(chat, true))}
            </ProjectRow>
          );
        })}
      </section>
    );
  };

  const unlinked = active.get(null);

  return (
    <>
      <div className="shrink-0 px-3 pb-3">
        <Button
          ref={openProject}
          variant="ghost"
          className={ACTION_CLASS}
          disabled={choosingProject}
          onClick={() => void useAgentStore.getState().selectProject()}
        >
          <FolderOpenIcon data-icon="inline-start" strokeWidth={1.7} /> {t("打开项目…", locale)}
        </Button>
        <Button
          variant="ghost"
          className={ACTION_CLASS}
          onClick={() => void useAgentStore.getState().newSession()}
        >
          <SquarePenIcon data-icon="inline-start" strokeWidth={1.7} /> {t("新聊天", locale)}
        </Button>
      </div>
      <nav
        ref={nav}
        aria-label={t("聊天", locale)}
        className="min-h-0 flex-1 overflow-y-auto px-3 pb-3"
      >
        {renderProjects(t("最近项目", locale), recentProjects, true)}
        {renderProjects(t("其他项目", locale), otherProjects, false)}
        {unlinked && (
          <section className="pb-3" aria-label={t("未关联项目", locale)}>
            <h3 className="px-2.5 py-1 text-xs text-sidebar-foreground/70">
              {t("未关联项目", locale)}
            </h3>
            {unlinked.map((chat) => renderSession(chat))}
          </section>
        )}
        {sessions.length === 0 && recentProjects.length === 0 && (
          <output className="flex flex-col gap-0.5 px-2.5 py-1">
            <span className="text-[13px]">{t("还没有聊天", locale)}</span>
            <span className="text-xs leading-5 text-sidebar-foreground/70">
              {t("打开项目或发送第一条消息后，聊天会出现在这里。", locale)}
            </span>
          </output>
        )}
        {archived.size > 0 && (
          <section aria-label={t("已归档", locale)}>
            <h3 className="px-2.5 py-1 text-xs text-sidebar-foreground/70">
              {t("已归档", locale)}
            </h3>
            {[...archived].map(([directory, chats]) => (
              <section key={directory ?? ""}>
                <h4
                  className="truncate px-2.5 py-1 text-xs text-muted-foreground"
                  title={directory ?? undefined}
                >
                  {directory ? referenceName(directory) : t("未关联项目", locale)}
                </h4>
                {chats.map((chat) => renderSession(chat))}
              </section>
            ))}
          </section>
        )}
      </nav>
      <SessionRenameDialog target={renameTarget} onClose={() => setRenameTarget(null)} />
      <SessionDeleteDialog target={deleteTarget} onClose={() => setDeleteTarget(null)} />
      <SessionPersonaDialog target={personaTarget} onClose={() => setPersonaTarget(null)} />
    </>
  );
}
