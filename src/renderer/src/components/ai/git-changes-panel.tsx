// @env browser
import { useEffect, useRef, useState, type JSX } from "react";
import { FileDiffIcon, XIcon } from "lucide-react";
import { Badge } from "@renderer/components/ui/badge";
import { Button } from "@renderer/components/ui/button";
import {
  FILE_CHANGES_PANEL_CLASS,
  GIT_CHANGE_AREAS,
  GIT_CHANGE_AREA_LABELS,
  GIT_CHANGE_KIND_LABELS,
  GIT_CHANGE_ORIGIN_LABELS,
  GIT_REVIEW_PHASE_LABELS,
} from "@renderer/lib/constants";
import { t, useLocale } from "@renderer/lib/i18n";
import { useFileChangesStore } from "@renderer/stores/file-changes";
import type { GitChange, GitChangesView } from "@shared/contract";

function GitChangeRow({ change }: { change: GitChange }): JSX.Element {
  const locale = useLocale();
  return (
    <li
      data-git-file={change.path}
      data-git-origin={change.origin}
      className="border-border/65 flex min-w-0 flex-col items-start gap-0.5 border-b px-3 py-2"
    >
      <span dir="auto" title={change.path} className="max-w-full truncate font-mono text-sm">
        {change.path}
      </span>
      {change.previousPath && (
        <span
          dir="auto"
          title={change.previousPath}
          className="text-muted-foreground max-w-full truncate text-xs"
        >
          {t("原路径 {0}", locale, [change.previousPath])}
        </span>
      )}
      <div className="text-muted-foreground flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        <span>
          {t(change.resolved ? "任务期间移出清单" : GIT_CHANGE_KIND_LABELS[change.kind], locale)}
        </span>
        <Badge variant={change.origin === "mixed" ? "outline" : "secondary"}>
          {t(GIT_CHANGE_ORIGIN_LABELS[change.origin], locale)}
        </Badge>
      </div>
    </li>
  );
}

export function GitChangesPanel({ composerId }: { composerId: string }): JSX.Element {
  const locale = useLocale();
  const heading = useRef<HTMLHeadingElement>(null);
  const [view, setView] = useState<GitChangesView | null>();

  useEffect(() => {
    heading.current?.focus();
    let disposed = false;
    let reading = false;
    let queued = false;
    const refresh = async (): Promise<void> => {
      if (reading) {
        queued = true;
        return;
      }
      reading = true;
      do {
        queued = false;
        const next = await window.pi.sessionGitChanges(composerId).catch((): GitChangesView => ({
          phase: "workspace",
          changes: null,
        }));
        if (!disposed && !queued) setView(next);
      } while (!disposed && queued);
      reading = false;
    };
    const refreshOnFocus = (): void => void refresh();
    const unsubscribe = window.pi.onAgentEvent((event) => {
      if (
        "run" in event &&
        event.run.sessionId === composerId &&
        (event.type === "run_started" ||
          event.type === "tool_end" ||
          (event.type === "status" && event.status === "idle"))
      )
        void refresh();
    });
    window.addEventListener("focus", refreshOnFocus);
    void refresh();
    return () => {
      disposed = true;
      unsubscribe();
      window.removeEventListener("focus", refreshOnFocus);
    };
  }, [composerId]);

  const close = (): void => {
    useFileChangesStore.getState().close();
    document.getElementById("git-changes-trigger")?.focus();
  };
  const changes = view?.changes;
  const emptyMessage =
    view === undefined
      ? "加载中…"
      : !view
        ? "当前目录没有 Git 工作树"
        : changes === null
          ? "无法读取 Git 变更"
          : "暂无文件变更";
  return (
    <aside
      id="git-changes-panel"
      aria-labelledby="git-changes-heading"
      className={FILE_CHANGES_PANEL_CLASS}
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.stopPropagation();
        close();
      }}
    >
      <div className="border-border/65 flex h-12 shrink-0 items-center justify-between gap-2 border-b px-3">
        <h2
          id="git-changes-heading"
          ref={heading}
          tabIndex={-1}
          className="flex min-w-0 items-center gap-2 text-[13px] font-medium outline-none"
        >
          <FileDiffIcon aria-hidden="true" className="size-3.5 shrink-0" />
          {t("Git 变更", locale)}
        </h2>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t("关闭变更标签页", locale)}
          title={t("关闭变更标签页", locale)}
          onClick={close}
        >
          <XIcon aria-hidden="true" />
        </Button>
      </div>
      {view && changes && (
        <p className="border-border/70 bg-muted/40 text-muted-foreground shrink-0 border-b px-3 py-2 text-xs">
          {t(GIT_REVIEW_PHASE_LABELS[view.phase], locale)}
        </p>
      )}
      <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain [scrollbar-color:var(--border)_transparent] [scrollbar-width:thin]">
        {changes?.length ? (
          GIT_CHANGE_AREAS.map((area) => {
            const files = changes.filter((change) => change.area === area);
            if (!files.length) return null;
            return (
              <section key={area} data-git-area={area} aria-labelledby={`git-area-${area}`}>
                <h3
                  id={`git-area-${area}`}
                  className="border-border/65 bg-muted/45 border-b px-3 py-1.5 text-xs font-medium"
                >
                  {t(GIT_CHANGE_AREA_LABELS[area], locale)}
                </h3>
                <ul>
                  {files.map((change) => (
                    <GitChangeRow key={change.path} change={change} />
                  ))}
                </ul>
              </section>
            );
          })
        ) : (
          <p role="status" className="text-muted-foreground px-3 py-4 text-xs">
            {t(emptyMessage, locale)}
          </p>
        )}
      </div>
    </aside>
  );
}
