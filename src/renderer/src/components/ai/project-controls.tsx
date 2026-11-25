// @env browser
import { cn } from "cn";
import {
  CheckIcon,
  ChevronDownIcon,
  FileDiffIcon,
  FolderIcon,
  FolderOpenIcon,
  GitBranchIcon,
} from "lucide-react";
import type { JSX } from "react";

import { Button } from "@renderer/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@renderer/components/ui/dropdown-menu";
import { REVIEW_PANEL_ID, REVIEW_TRIGGER_ID } from "@renderer/lib/constants";
import { t, useLocale } from "@renderer/lib/i18n";
import { referenceName } from "@renderer/lib/workspace-links";
import { useAgentStore } from "@renderer/stores/agent";
import { activateReview } from "@renderer/stores/review";
import type { ProjectGitHead, VerificationStatus } from "@shared/contract";

import { ChangeCount, VerificationMark } from "./review-indicators";

export function ProjectChip({
  sessionId,
  projectDirectory,
  workingDirectory,
}: {
  sessionId: string | null;
  projectDirectory: string | null;
  workingDirectory: string | null;
}): JSX.Element {
  const locale = useLocale();
  const recentProjects = useAgentStore((s) => s.recentProjects);
  const selectProject = useAgentStore((s) => s.selectProject);
  const choosingProject = useAgentStore((s) => s.choosingProject);
  // 已保存但还没有项目的会话只能补关联；其余情况是换到另一个项目开始新聊天。
  const bindTo = projectDirectory ? undefined : (sessionId ?? undefined);
  const openFolderPicker = (): void => void selectProject({ sessionId: bindTo });
  const title =
    projectDirectory ??
    (workingDirectory
      ? t("未选择项目，当前使用默认工作目录 {0}", locale, [workingDirectory])
      : t("未选择项目", locale));
  const className = cn(
    "max-w-32 font-normal @lg:max-w-44",
    projectDirectory
      ? "text-muted-foreground"
      : "text-amber-600 hover:text-amber-600 aria-expanded:text-amber-600 dark:text-amber-400 dark:hover:text-amber-400 dark:aria-expanded:text-amber-400",
  );
  const Icon = projectDirectory ? FolderIcon : FolderOpenIcon;
  const label = (
    <>
      <Icon data-icon="inline-start" />
      <span className="truncate">
        {projectDirectory ? referenceName(projectDirectory) : t("选择项目", locale)}
      </span>
    </>
  );

  if (!recentProjects.length) {
    return (
      <Button
        size="xs"
        variant="ghost"
        title={title}
        disabled={choosingProject}
        onClick={openFolderPicker}
        className={className}
      >
        {label}
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={
          <Button
            size="xs"
            variant="ghost"
            title={title}
            disabled={choosingProject}
            className={className}
          />
        }
      >
        {label}
        <ChevronDownIcon data-icon="inline-end" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="start" className="max-w-[min(24rem,var(--available-width))]">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t("最近项目", locale)}</DropdownMenuLabel>
          {recentProjects.map((directory) => (
            <DropdownMenuItem
              key={directory}
              title={directory}
              onClick={() => {
                if (directory !== projectDirectory)
                  void selectProject({ sessionId: bindTo, directory });
              }}
              className="items-start gap-2.5 py-2"
            >
              <FolderIcon className="mt-0.5" aria-hidden="true" />
              <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="truncate leading-5">{referenceName(directory)}</span>
                <span className="truncate text-left text-xs leading-4 text-muted-foreground [direction:rtl]">
                  <bdi dir="ltr">{directory}</bdi>
                </span>
              </span>
              {directory === projectDirectory && (
                <CheckIcon className="mt-0.5" aria-hidden="true" />
              )}
            </DropdownMenuItem>
          ))}
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup>
          <DropdownMenuItem onClick={openFolderPicker}>
            <FolderOpenIcon aria-hidden="true" />
            {t("选择其他文件夹…", locale)}
          </DropdownMenuItem>
        </DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export function ProjectBranch({ head }: { head: ProjectGitHead }): JSX.Element {
  const locale = useLocale();
  const label = "branch" in head ? head.branch : t("分离 HEAD {0}", locale, [head.detachedAt]);
  const description = "branch" in head ? t("Git 分支 {0}", locale, [head.branch]) : label;
  return (
    <span
      className="hidden max-w-40 min-w-0 items-center gap-1 text-xs text-muted-foreground @lg:flex"
      title={description}
    >
      <GitBranchIcon className="size-3 shrink-0" aria-hidden="true" />
      <span className="truncate" aria-label={description}>
        {label}
      </span>
    </span>
  );
}

export function ReviewToggle({
  open,
  count,
  verificationStatus,
}: {
  open: boolean;
  count?: number;
  verificationStatus?: VerificationStatus;
}): JSX.Element {
  const locale = useLocale();
  return (
    <Button
      id={REVIEW_TRIGGER_ID}
      size="sm"
      variant={open ? "secondary" : "ghost"}
      aria-expanded={open}
      aria-controls={open ? REVIEW_PANEL_ID : undefined}
      title={t(open ? "关闭审查面板" : "打开审查面板", locale)}
      onClick={(event) => activateReview(undefined, event.currentTarget)}
    >
      <FileDiffIcon data-icon="inline-start" />
      {t("审查", locale)}
      {count !== undefined && <ChangeCount count={count} />}
      {verificationStatus && <VerificationMark status={verificationStatus} />}
    </Button>
  );
}
