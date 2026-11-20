// @env browser
import { useEffect, useState, type JSX } from "react";
import { ChevronDownIcon, FolderIcon, FolderOpenIcon, GitBranchIcon } from "lucide-react";
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
import { t, useLocale } from "@renderer/lib/i18n";
import { referenceName } from "@renderer/lib/workspace-links";
import { useAgentStore } from "@renderer/stores/agent";
import type { ProjectGitHead } from "@shared/contract";

export function ProjectChooser({ sessionId }: { sessionId: string | null }): JSX.Element {
  const locale = useLocale();
  const recentProjects = useAgentStore((s) => s.recentProjects);
  const selectProject = useAgentStore((s) => s.selectProject);
  const choosingProject = useAgentStore((s) => s.choosingProject);
  const label = t(sessionId ? "关联项目…" : "打开项目…", locale);
  const openFolderPicker = (): void => void selectProject({ sessionId: sessionId ?? undefined });

  if (!sessionId || !recentProjects.length) {
    return (
      <Button size="sm" variant="outline" disabled={choosingProject} onClick={openFolderPicker}>
        <FolderOpenIcon data-icon="inline-start" />
        {label}
      </Button>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        render={<Button size="sm" variant="outline" disabled={choosingProject} />}
      >
        <FolderOpenIcon data-icon="inline-start" />
        {label}
        <ChevronDownIcon data-icon="inline-end" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-w-[min(24rem,var(--available-width))]">
        <DropdownMenuGroup>
          <DropdownMenuLabel>{t("最近项目", locale)}</DropdownMenuLabel>
          {recentProjects.map((directory) => (
            <DropdownMenuItem
              key={directory}
              title={directory}
              onClick={() => void selectProject({ sessionId, directory })}
              className="items-start gap-2.5 py-2"
            >
              <FolderIcon className="mt-0.5" aria-hidden="true" />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="truncate leading-5">{referenceName(directory)}</span>
                <span className="text-muted-foreground truncate text-xs leading-4 [direction:rtl] text-left">
                  <bdi dir="ltr">{directory}</bdi>
                </span>
              </span>
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

export function ProjectBranch({ directory }: { directory: string }): JSX.Element | null {
  const locale = useLocale();
  const idle = useAgentStore((s) => s.status === "idle");
  const [head, setHead] = useState<ProjectGitHead | null>(null);

  useEffect(() => {
    if (!idle) return;
    let request = 0;
    const refresh = (): void => {
      const current = ++request;
      void window.pi.sessionGitHead(directory).then(
        (value) => {
          if (current === request) setHead(value);
        },
        () => {
          if (current === request) setHead(null);
        },
      );
    };
    refresh();
    window.addEventListener("focus", refresh);
    return () => {
      request++;
      window.removeEventListener("focus", refresh);
    };
  }, [directory, idle]);

  if (!head) return null;
  const label = "branch" in head ? head.branch : t("分离 HEAD {0}", locale, [head.detachedAt]);
  const description = "branch" in head ? t("Git 分支 {0}", locale, [head.branch]) : label;
  return (
    <span
      className="text-muted-foreground ms-2 flex max-w-[45%] shrink-0 items-center gap-1 text-xs"
      title={description}
    >
      <GitBranchIcon className="size-3 shrink-0" aria-hidden="true" />
      <span className="truncate" aria-label={description}>
        {label}
      </span>
    </span>
  );
}
