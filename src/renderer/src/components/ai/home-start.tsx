// @env browser
import type { JSX } from "react";
import { FolderIcon, FolderOpenIcon } from "lucide-react";
import { Button } from "@renderer/components/ui/button";
import { HOME_RECENT_PROJECT_LIMIT, STARTER_TASKS } from "@renderer/lib/constants";
import { t, useLocale } from "@renderer/lib/i18n";
import { referenceName } from "@renderer/lib/workspace-links";
import { useAgentStore } from "@renderer/stores/agent";

function StarterTasks({ onPick }: { onPick: (prompt: string) => void }): JSX.Element {
  const locale = useLocale();
  return (
    <ul aria-label={t("起步任务", locale)} className="flex flex-wrap justify-center gap-2">
      {STARTER_TASKS.map((task) => (
        <li key={task.label}>
          <Button
            size="sm"
            variant="outline"
            title={t(task.prompt, locale)}
            onClick={() => onPick(t(task.prompt, locale))}
            className="text-muted-foreground rounded-full font-normal"
          >
            {t(task.label, locale)}
          </Button>
        </li>
      ))}
    </ul>
  );
}

function ProjectEntry({
  sessionId,
  workingDirectory,
  primary,
}: {
  sessionId: string | null;
  workingDirectory: string | null;
  primary: boolean;
}): JSX.Element {
  const locale = useLocale();
  const recentProjects = useAgentStore((s) => s.recentProjects);
  const selectProject = useAgentStore((s) => s.selectProject);
  const choosingProject = useAgentStore((s) => s.choosingProject);
  const bindTo = sessionId ?? undefined;
  const recent = recentProjects.slice(0, HOME_RECENT_PROJECT_LIMIT);

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3 px-1">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-sm text-amber-600 dark:text-amber-400">
            <FolderOpenIcon className="size-4 shrink-0" aria-hidden="true" />
            {t("未选择项目", locale)}
          </p>
          <p
            className="text-muted-foreground mt-0.5 truncate text-xs"
            title={workingDirectory ?? undefined}
          >
            {workingDirectory
              ? t("任务会在默认工作目录 {0} 运行。", locale, [workingDirectory])
              : t("打开项目后，Agent 才能读取和修改其中的文件。", locale)}
          </p>
        </div>
        <Button
          size="sm"
          variant={primary ? "default" : "outline"}
          disabled={choosingProject}
          onClick={() => void selectProject({ sessionId: bindTo })}
        >
          {t("打开项目…", locale)}
        </Button>
      </div>
      {recent.length > 0 && (
        <div className="flex flex-col gap-1">
          <h2 className="text-muted-foreground px-1 text-xs">{t("最近项目", locale)}</h2>
          <ul className="flex flex-col">
            {recent.map((directory) => (
              <li key={directory}>
                <button
                  type="button"
                  title={directory}
                  disabled={choosingProject}
                  onClick={() => void selectProject({ sessionId: bindTo, directory })}
                  className="hover:bg-accent focus-visible:ring-ring flex w-full items-start gap-2.5 rounded-lg px-2.5 py-1.5 text-left outline-none focus-visible:ring-2 focus-visible:ring-inset disabled:opacity-50"
                >
                  <FolderIcon
                    className="text-muted-foreground mt-0.5 size-4 shrink-0"
                    aria-hidden="true"
                  />
                  <span className="flex min-w-0 flex-1 flex-col gap-0.5">
                    <span className="truncate text-sm leading-5">{referenceName(directory)}</span>
                    <span className="text-muted-foreground truncate text-left text-xs leading-4 [direction:rtl]">
                      <bdi dir="ltr">{directory}</bdi>
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </section>
  );
}

/** 空会话输入框下方的入口：有项目给起步任务，没有项目先引导打开项目。 */
export function HomeStart({
  sessionId,
  projectDirectory,
  workingDirectory,
  needsSetup,
  onPick,
}: {
  sessionId: string | null;
  projectDirectory: string | null;
  workingDirectory: string | null;
  needsSetup: boolean;
  onPick: (prompt: string) => void;
}): JSX.Element {
  if (projectDirectory) return <StarterTasks onPick={onPick} />;
  return (
    <ProjectEntry sessionId={sessionId} workingDirectory={workingDirectory} primary={!needsSetup} />
  );
}
