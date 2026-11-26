// @env browser
import { EllipsisIcon } from "lucide-react";
import { useRef, useState, type JSX } from "react";

import { InstructionSourcesDialog } from "@renderer/components/ai/instruction-sources";
import { ProjectConfigDialog } from "@renderer/components/ai/project-config-details";
import { ProjectBranch, ProjectChip, ReviewToggle } from "@renderer/components/ai/project-controls";
import {
  SessionPersonaDialog,
  SessionRenameDialog,
} from "@renderer/components/ai/session-edit-dialogs";
import { Button } from "@renderer/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@renderer/components/ui/dropdown-menu";
import { useProjectGitHead } from "@renderer/hooks/use-project-git-head";
import { t, useLocale } from "@renderer/lib/i18n";
import { selectActiveSession, selectProjectDirectory, useAgentStore } from "@renderer/stores/agent";
import type { SessionMeta, VerificationStatus } from "@shared/contract";

const TITLE_CLASS = "min-w-0 truncate text-[13px] font-medium";

function SessionTitle({
  title,
  session,
}: {
  title: string;
  session: SessionMeta | null;
}): JSX.Element {
  const locale = useLocale();
  const [renaming, setRenaming] = useState<SessionMeta | null>(null);
  const button = useRef<HTMLButtonElement>(null);
  // 还没保存的草稿没有可改的标题。
  if (!session) {
    return (
      <span className={TITLE_CLASS} title={title}>
        {title}
      </span>
    );
  }
  return (
    <>
      <Button
        ref={button}
        variant="ghost"
        size="sm"
        title={title}
        aria-label={t("重命名聊天", locale) + " " + title}
        onClick={() => setRenaming(session)}
        className="-ml-2.5 min-w-0 shrink px-2.5 text-[13px]"
      >
        <span className="truncate">{title}</span>
      </Button>
      <SessionRenameDialog
        target={renaming}
        onClose={() => setRenaming(null)}
        finalFocus={button}
      />
    </>
  );
}

function SessionMenu({
  composerId,
  session,
}: {
  composerId: string;
  session: SessionMeta | null;
}): JSX.Element {
  const locale = useLocale();
  const setSessionArchived = useAgentStore((s) => s.setSessionArchived);
  const exportMarkdown = useAgentStore((s) => s.exportSessionMarkdown);
  const [exporting, setExporting] = useState(false);
  const [instructionsOpen, setInstructionsOpen] = useState(false);
  const [projectConfigOpen, setProjectConfigOpen] = useState(false);
  const projectDirectory = useAgentStore(selectProjectDirectory);
  const [renaming, setRenaming] = useState<SessionMeta | null>(null);
  const [persona, setPersona] = useState<SessionMeta | null>(null);
  // 对话框从菜单项打开，关闭后菜单项已不存在，焦点要明确交还给触发按钮。
  const trigger = useRef<HTMLButtonElement>(null);
  const label = t("更多操作", locale);
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger
          render={
            <Button ref={trigger} variant="ghost" size="icon-sm" aria-label={label} title={label} />
          }
        >
          <EllipsisIcon />
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          <DropdownMenuGroup>
            <DropdownMenuItem onClick={() => setInstructionsOpen(true)}>
              {t("指令来源…", locale)}
            </DropdownMenuItem>
            {projectDirectory && (
              <DropdownMenuItem onClick={() => setProjectConfigOpen(true)}>
                {t("项目配置…", locale)}
              </DropdownMenuItem>
            )}
          </DropdownMenuGroup>
          {session && (
            <>
              <DropdownMenuSeparator />
              <DropdownMenuGroup>
                <DropdownMenuItem onClick={() => setRenaming(session)}>
                  {t("重命名…", locale)}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => setPersona(session)}>
                  {t(session.personaOverride ? "会话指令（已覆盖）" : "会话指令…", locale)}
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={exporting}
                  onClick={() => {
                    setExporting(true);
                    void exportMarkdown(session.id).finally(() => setExporting(false));
                  }}
                >
                  {t(exporting ? "正在导出…" : "导出 Markdown…", locale)}
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => void setSessionArchived(session.id, true)}>
                  {t("归档", locale)}
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      <InstructionSourcesDialog
        composerId={composerId}
        open={instructionsOpen}
        onOpenChange={setInstructionsOpen}
        finalFocus={trigger}
      />
      {projectDirectory && (
        <ProjectConfigDialog
          composerId={composerId}
          open={projectConfigOpen}
          onOpenChange={setProjectConfigOpen}
          finalFocus={trigger}
        />
      )}
      <SessionRenameDialog
        target={renaming}
        onClose={() => setRenaming(null)}
        finalFocus={trigger}
      />
      <SessionPersonaDialog
        target={persona}
        onClose={() => setPersona(null)}
        finalFocus={trigger}
      />
    </>
  );
}

export function ChatHeader({
  title,
  composerId,
  workingDirectory,
  projectDirectory,
  reviewOpen,
  canReview,
  changeCount,
  verificationStatus,
}: {
  title: string;
  composerId: string | null;
  workingDirectory: string | null;
  projectDirectory: string | null;
  reviewOpen: boolean;
  canReview: boolean;
  changeCount?: number;
  verificationStatus?: VerificationStatus;
}): JSX.Element {
  const session = useAgentStore(selectActiveSession) ?? null;
  const head = useProjectGitHead(projectDirectory);

  return (
    <header className="@container flex h-10 shrink-0 items-center gap-2 border-b border-border/65 pr-2 pl-5">
      <SessionTitle key={session?.id ?? ""} title={title} session={session} />
      <ProjectChip projectDirectory={projectDirectory} workingDirectory={workingDirectory} />
      {head && <ProjectBranch head={head} />}
      {composerId && (
        <div className="ml-auto flex shrink-0 items-center gap-1">
          {canReview && (
            <ReviewToggle
              open={reviewOpen}
              count={changeCount}
              verificationStatus={verificationStatus}
            />
          )}
          <SessionMenu key={composerId} composerId={composerId} session={session} />
        </div>
      )}
    </header>
  );
}
