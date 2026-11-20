// @env browser
import { useState, type JSX } from "react";
import { ChevronDownIcon, FileDiffIcon, Undo2Icon } from "lucide-react";
import { Button } from "@renderer/components/ui/button";
import { summarizeChanges } from "@renderer/lib/file-changes";
import { t, useLocale } from "@renderer/lib/i18n";
import { useFileChangesStore } from "@renderer/stores/file-changes";
import { useWorkspaceReferenceStore } from "@renderer/stores/workspace-reference";
import type { FileChangeSummary } from "@shared/contract";
import { DiffStats } from "./diff-stats";

export function FileChangesCard({
  changes,
  sessionId,
  replyId,
  busy,
}: {
  changes: readonly FileChangeSummary[];
  sessionId: string | null;
  replyId: string;
  busy: boolean;
}): JSX.Element {
  const locale = useLocale();
  const open = useFileChangesStore((state) => state.open);
  const [expanded, setExpanded] = useState(false);
  const visible = expanded ? changes : changes.slice(0, 3);
  const { count, stats } = summarizeChanges(changes);
  const show = (changeId?: string, confirmUndo = false): void => {
    if (!sessionId) return;
    useWorkspaceReferenceStore.getState().close();
    open({ sessionId, replyId, changeId, confirmUndo });
  };

  return (
    <section
      data-file-changes
      className="border-border/80 bg-card min-w-0 overflow-hidden rounded-xl border"
    >
      <div className="bg-muted/45 flex flex-wrap items-center gap-2.5 px-3 py-2.5">
        <span className="bg-secondary text-secondary-foreground grid size-8 shrink-0 place-items-center rounded-lg">
          <FileDiffIcon aria-hidden="true" className="size-4" />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="text-sm font-medium">{t("变更了 {0} 个文件", locale, [count])}</h3>
          {stats && <DiffStats stats={stats} />}
        </div>
        <Button
          variant="outline"
          size="sm"
          disabled={!sessionId}
          data-review-overview={replyId}
          onClick={() => show(changes.length === 1 ? changes[0]?.id : undefined)}
        >
          {t("查看更改", locale)}
        </Button>
      </div>
      <ul className="divide-border/65 border-border/65 divide-y border-t">
        {visible.map((change) => (
          <li key={change.id} className="flex min-w-0 items-center gap-2 px-3 py-1.5">
            <button
              type="button"
              title={change.path}
              data-review-file={change.id}
              disabled={!sessionId}
              onClick={() => show(change.id)}
              className="hover:text-primary focus-visible:ring-ring/50 min-h-6 min-w-0 flex-1 truncate rounded-sm text-left font-mono text-xs outline-none hover:underline focus-visible:ring-2"
            >
              {change.path}
            </button>
            {change.reverted ? (
              <span className="text-muted-foreground shrink-0 text-xs">{t("已撤销", locale)}</span>
            ) : (
              change.stats && <DiffStats stats={change.stats} />
            )}
            {!change.reverted && change.stats && (
              <Button
                variant="ghost"
                size="icon-xs"
                disabled={!sessionId || busy}
                aria-label={t("撤销 {0} 的变更", locale, [change.path])}
                title={t("撤销", locale)}
                onClick={() => show(change.id, true)}
              >
                <Undo2Icon aria-hidden="true" />
              </Button>
            )}
          </li>
        ))}
      </ul>
      {changes.length > 3 && (
        <Button
          variant="ghost"
          size="xs"
          className="m-1.5"
          aria-expanded={expanded}
          onClick={() => setExpanded((value) => !value)}
        >
          {expanded
            ? t("收起列表", locale)
            : t("显示其余 {0} 项变更", locale, [changes.length - 3])}
          <ChevronDownIcon aria-hidden="true" className={expanded ? "rotate-180" : undefined} />
        </Button>
      )}
    </section>
  );
}
