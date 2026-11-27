// @env browser
import { ArrowLeftIcon } from "lucide-react";
import { useEffect, type JSX } from "react";

import { Button } from "@renderer/components/ui/button";
import { REVIEW_PANEL_ID } from "@renderer/lib/constants";
import { localizeError, t, useLocale } from "@renderer/lib/i18n";
import type { AppendGitAnnotations, GitReview } from "@renderer/lib/types";
import { useAgentStore } from "@renderer/stores/agent";
import { useFileChangesStore } from "@renderer/stores/file-changes";

import { FileChangesPanel } from "./file-changes-panel";
import { GitChangesPanel } from "./git-changes-panel";
import { GitWorktreeDialog } from "./git-worktree-dialog";

export function ReviewChanges({
  composerId,
  sessionId,
  workingDirectory,
  active,
  git,
  latestReply,
  onAppendAnnotations,
}: {
  composerId: string;
  sessionId: string | null;
  workingDirectory: string | null;
  active: boolean;
  git: GitReview;
  latestReply?: string;
  onAppendAnnotations?: AppendGitAnnotations;
}): JSX.Element {
  const locale = useLocale();
  const review = useFileChangesStore((state) =>
    state.review?.sessionId === sessionId ? state.review : null,
  );
  const gitAvailable = Boolean(git.view);
  const currentWorktree = useAgentStore((state) => state.worktree);
  const loading = workingDirectory && git.view === undefined && !git.error;
  const showFileChanges = !gitAvailable || Boolean(review);

  useEffect(() => {
    if (active && !review && sessionId && latestReply && git.view === null)
      useFileChangesStore.getState().open({ sessionId, replyId: latestReply });
  }, [active, git.view, latestReply, review, sessionId]);

  return (
    <>
      {gitAvailable && (
        <div hidden={showFileChanges} className="flex min-h-0 flex-1 flex-col">
          <GitChangesPanel
            key={workingDirectory}
            composerId={composerId}
            workingDirectory={workingDirectory}
            liveReview={git}
            onAppendAnnotations={onAppendAnnotations}
          />
        </div>
      )}
      {showFileChanges && (
        <>
          {!gitAvailable && currentWorktree && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/65 px-3 py-2">
              <p role="status" className="text-xs text-muted-foreground">
                {t("工作树当前无法访问。请从原项目检查目录。", locale)}
              </p>
              <GitWorktreeDialog composerId={composerId} onChanged={git.refresh} />
            </div>
          )}
          {gitAvailable && (
            <div className="flex shrink-0 border-b border-border/65 px-2 py-1">
              <Button
                variant="ghost"
                size="xs"
                onClick={() => {
                  useFileChangesStore.getState().close();
                  document
                    .getElementById(REVIEW_PANEL_ID)
                    ?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
                    ?.focus({ preventScroll: true });
                }}
              >
                <ArrowLeftIcon data-icon="inline-start" />
                {t("返回 Git 变更", locale)}
              </Button>
            </div>
          )}
          {!gitAvailable && git.error && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/65 px-3 py-2">
              <p role="alert" className="text-xs wrap-anywhere text-destructive">
                {localizeError(git.error, locale)}
              </p>
              <Button size="xs" variant="outline" onClick={git.refresh}>
                {t("重试", locale)}
              </Button>
            </div>
          )}
          {review ? (
            <FileChangesPanel key={review.replyId} review={review} active={active} />
          ) : (
            <p role="status" className="px-3 py-4 text-xs text-muted-foreground">
              {t(
                loading ? "加载中…" : workingDirectory ? "暂无文件变更" : "请先选择工作目录。",
                locale,
              )}
            </p>
          )}
        </>
      )}
    </>
  );
}
