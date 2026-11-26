// @env browser
import { CheckIcon, GitBranchIcon, GitPullRequestIcon, UploadIcon } from "lucide-react";
import { useId, useRef, useState, type JSX } from "react";

import { Button } from "@renderer/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@renderer/components/ui/dialog";
import { Input } from "@renderer/components/ui/input";
import { Textarea } from "@renderer/components/ui/textarea";
import { GIT_BRANCH_DIALOG } from "@renderer/lib/constants";
import { localizeError, t, useLocale } from "@renderer/lib/i18n";
import type {
  GitBranchDialogMode,
  GitBranchDialogPreview,
  GitBranchFeedback,
} from "@renderer/lib/types";
import { GIT_BRANCH_NAME_LIMIT, GIT_PR_BODY_LIMIT, GIT_PR_TITLE_LIMIT } from "@shared/constants";
import type { GitBranchRequest, GitPullRequestDraft } from "@shared/contract";

export function GitBranchActions({
  composerId,
  disabled,
  onBranchChanged,
}: {
  composerId: string;
  disabled: boolean;
  onBranchChanged(): void;
}): JSX.Element {
  const locale = useLocale();
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const cancel = useRef<HTMLButtonElement>(null);
  const request = useRef(0);
  const [mode, setMode] = useState<GitBranchDialogMode>("branch");
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<GitBranchDialogPreview>();
  const [loading, setLoading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState("");
  const [newBranch, setNewBranch] = useState("");
  const [draft, setDraft] = useState<GitPullRequestDraft>();
  const [feedback, setFeedback] = useState<GitBranchFeedback>();

  const load = async (kind: GitBranchDialogMode, keepEdits = false): Promise<void> => {
    const sequence = ++request.current;
    setPreview(undefined);
    setError("");
    setLoading(true);
    try {
      let result: GitBranchDialogPreview;
      switch (kind) {
        case "branch":
          result = { kind, data: await window.pi.sessionGitBranches(composerId) };
          break;
        case "push":
          result = { kind, data: await window.pi.sessionPreviewGitPush(composerId) };
          break;
        case "pull-request":
          result = { kind, data: await window.pi.sessionPreviewGitPullRequest(composerId) };
          break;
      }
      if (sequence !== request.current) return;
      if (result.kind === "pull-request") {
        const { base, title, body } = result.data;
        setDraft((current) => (keepEdits && current ? current : { base, title, body }));
      }
      setPreview(result);
    } catch (reason) {
      if (sequence === request.current) setError(String(reason));
    } finally {
      if (sequence === request.current) setLoading(false);
    }
  };

  const show = (kind: GitBranchDialogMode, button: HTMLButtonElement): void => {
    trigger.current = button;
    setMode(kind);
    setNewBranch("");
    setDraft(undefined);
    setOpen(true);
    void load(kind);
  };

  const close = (): void => {
    if (applying) return;
    request.current++;
    setOpen(false);
  };

  const apply = async (branchRequest?: GitBranchRequest): Promise<void> => {
    if (!preview || applying || disabled || error) return;
    setApplying(true);
    try {
      if (preview.kind === "branch" && branchRequest) {
        await window.pi.sessionSwitchGitBranch(composerId, preview.data.token, branchRequest);
        setFeedback({ kind: "branch", branch: branchRequest.branch });
        onBranchChanged();
      }
      if (preview.kind === "push") {
        const result = await window.pi.sessionPushGit(composerId, preview.data.token);
        const { remote, targetBranch } = preview.data;
        setFeedback({
          kind: "push",
          destination: remote + "/" + targetBranch,
          trackingFailed: result.trackingFailed,
        });
      }
      if (preview.kind === "pull-request" && draft) {
        const url = await window.pi.sessionCreateGitPullRequest(composerId, preview.data.token, {
          ...draft,
          base: draft.base.trim(),
          title: draft.title.trim(),
        });
        setFeedback({ kind: "pull-request", url });
      }
      setOpen(false);
    } catch (reason) {
      setError(String(reason));
    } finally {
      setApplying(false);
    }
  };

  const currentHead = preview?.kind === "branch" ? preview.data.head : null;
  const push = preview?.kind === "push" ? preview.data : undefined;
  const pullRequest = preview?.kind === "pull-request" ? preview.data : undefined;
  const nothingToPush = push && !push.newBranch && !push.commits.length;
  const primaryDisabled =
    disabled ||
    applying ||
    !preview ||
    Boolean(error) ||
    (mode === "branch" && !newBranch.trim()) ||
    (mode === "push" && nothingToPush) ||
    (mode === "pull-request" && (!draft?.title.trim() || !draft.base.trim()));
  const [errorSummary, ...errorDetails] = error.split("\n");

  return (
    <>
      <div data-git-branch-actions className="flex flex-wrap items-center gap-1.5">
        <Button
          size="xs"
          variant="outline"
          disabled={disabled}
          onClick={(event) => show("branch", event.currentTarget)}
        >
          <GitBranchIcon data-icon="inline-start" aria-hidden="true" />
          {t("管理分支…", locale)}
        </Button>
        <Button
          size="xs"
          variant="outline"
          disabled={disabled}
          onClick={(event) => show("push", event.currentTarget)}
        >
          <UploadIcon data-icon="inline-start" aria-hidden="true" />
          {t("推送…", locale)}
        </Button>
        <Button
          size="xs"
          variant="outline"
          disabled={disabled}
          onClick={(event) => show("pull-request", event.currentTarget)}
        >
          <GitPullRequestIcon data-icon="inline-start" aria-hidden="true" />
          {t("创建 PR…", locale)}
        </Button>
      </div>
      {feedback && (
        <div
          role="status"
          className="flex w-full min-w-0 items-start gap-1.5 text-xs text-emerald-700 dark:text-emerald-400"
        >
          <CheckIcon aria-hidden="true" className="mt-0.5 size-3 shrink-0" />
          <div className="min-w-0 wrap-anywhere">
            {feedback.kind === "branch" && t("当前分支已切换到 {0}", locale, [feedback.branch])}
            {feedback.kind === "push" && (
              <>
                {t("已推送到 {0}", locale, [feedback.destination])}
                {feedback.trackingFailed && (
                  <p className="text-muted-foreground">
                    {t("可在终端为这个分支设置上游。", locale)}
                  </p>
                )}
              </>
            )}
            {feedback.kind === "pull-request" && (
              <a
                className="text-brand underline underline-offset-2 focus-visible:outline-brand"
                href={feedback.url}
                target="_blank"
                rel="noreferrer"
              >
                {t("查看已创建的 PR", locale)}
              </a>
            )}
          </div>
        </div>
      )}
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) close();
        }}
      >
        <DialogContent
          showCloseButton={false}
          initialFocus={cancel}
          finalFocus={() => trigger.current}
          className="max-h-[calc(100dvh-2rem)] min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-3 sm:max-w-lg"
        >
          <DialogHeader>
            <DialogTitle>{t(GIT_BRANCH_DIALOG[mode].title, locale)}</DialogTitle>
            <DialogDescription>{t(GIT_BRANCH_DIALOG[mode].description, locale)}</DialogDescription>
          </DialogHeader>
          <form
            className="flex min-h-0 min-w-0 flex-col gap-3"
            onSubmit={(event) => {
              event.preventDefault();
              if (!primaryDisabled)
                void apply(
                  mode === "branch" ? { kind: "create", branch: newBranch.trim() } : undefined,
                );
            }}
          >
            <div
              className="flex min-h-0 min-w-0 flex-col gap-3 overflow-y-auto overscroll-contain p-1"
              tabIndex={push?.commits.length ? 0 : undefined}
              aria-label={push?.commits.length ? t("本次推送的提交", locale) : undefined}
              role={push?.commits.length ? "region" : undefined}
            >
              {loading && (
                <p role="status" className="text-xs text-muted-foreground">
                  {t("加载中…", locale)}
                </p>
              )}
              {preview?.kind === "branch" && (
                <>
                  {currentHead && (
                    <p className="text-xs wrap-anywhere text-muted-foreground">
                      {"branch" in currentHead
                        ? t("当前分支 {0}", locale, [currentHead.branch])
                        : t("游离 HEAD {0}", locale, [currentHead.detachedAt])}
                    </p>
                  )}
                  {preview.data.branches.length > 0 && (
                    <ul
                      aria-label={t("本地分支", locale)}
                      className="max-h-44 overflow-y-auto rounded-lg border"
                    >
                      {preview.data.branches.map((branch) => {
                        const current =
                          currentHead && "branch" in currentHead && currentHead.branch === branch;
                        return (
                          <li key={branch} className="border-b last:border-b-0">
                            {current ? (
                              <div
                                aria-current="true"
                                className="flex min-w-0 items-start justify-between gap-2 px-2 py-1.5 text-sm"
                              >
                                <span dir="auto" className="font-mono wrap-anywhere">
                                  {branch}
                                </span>
                                <CheckIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                              </div>
                            ) : (
                              <Button
                                type="button"
                                variant="ghost"
                                className="h-auto min-h-7 w-full justify-start text-left font-normal whitespace-normal"
                                aria-label={t("切换到 {0}", locale, [branch])}
                                disabled={disabled || applying || Boolean(error)}
                                onClick={() => void apply({ kind: "switch", branch })}
                              >
                                <span dir="auto" className="min-w-0 font-mono wrap-anywhere">
                                  {branch}
                                </span>
                              </Button>
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  )}
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor={id + "-new-branch"} className="font-medium">
                      {t("新分支名称", locale)}
                    </label>
                    <Input
                      id={id + "-new-branch"}
                      value={newBranch}
                      disabled={applying}
                      maxLength={GIT_BRANCH_NAME_LIMIT}
                      onChange={(event) => setNewBranch(event.currentTarget.value)}
                    />
                  </div>
                </>
              )}
              {push && (
                <>
                  <dl className="flex min-w-0 flex-col gap-2 text-xs">
                    <div>
                      <dt className="text-muted-foreground">{t("本地分支", locale)}</dt>
                      <dd dir="auto" className="font-mono wrap-anywhere">
                        {push.branch}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">{t("推送目标", locale)}</dt>
                      <dd dir="auto" className="font-mono wrap-anywhere">
                        {push.remote}/{push.targetBranch}
                      </dd>
                      <dd dir="auto" className="font-mono wrap-anywhere text-muted-foreground">
                        {push.destination}
                      </dd>
                    </div>
                  </dl>
                  {push.newBranch && (
                    <p className="text-xs text-muted-foreground">
                      {t("确认后将创建远端分支。", locale)}
                    </p>
                  )}
                  {push.commits.length ? (
                    <div className="flex flex-col gap-1.5">
                      <h3 className="text-sm font-medium">
                        {t("本次推送的提交（{0}）", locale, [push.commits.length])}
                      </h3>
                      <ol className="overflow-hidden rounded-lg border">
                        {push.commits.map(({ hash, subject }) => (
                          <li
                            key={hash}
                            className="flex flex-col gap-0.5 border-b px-2 py-1.5 last:border-b-0"
                          >
                            <span dir="auto" className="wrap-anywhere">
                              {subject || t("无提交说明", locale)}
                            </span>
                            <code title={hash} className="text-xs text-muted-foreground">
                              {hash.slice(0, 12)}
                            </code>
                          </li>
                        ))}
                      </ol>
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      {t(nothingToPush ? "远端分支已是最新。" : "远端已包含这些提交。", locale)}
                    </p>
                  )}
                </>
              )}
              {pullRequest && draft && (
                <>
                  <dl className="flex flex-col gap-2 text-xs">
                    <div>
                      <dt className="text-muted-foreground">{t("目标仓库", locale)}</dt>
                      <dd dir="auto" className="font-mono wrap-anywhere">
                        {pullRequest.repository}
                      </dd>
                    </div>
                    <div>
                      <dt className="text-muted-foreground">{t("来源分支", locale)}</dt>
                      <dd dir="auto" className="font-mono wrap-anywhere">
                        {pullRequest.head}
                      </dd>
                    </div>
                  </dl>
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor={id + "-base"} className="font-medium">
                      {t("基准分支", locale)}
                    </label>
                    <Input
                      id={id + "-base"}
                      value={draft.base}
                      maxLength={GIT_BRANCH_NAME_LIMIT}
                      required
                      disabled={applying}
                      onChange={(event) => setDraft({ ...draft, base: event.currentTarget.value })}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor={id + "-title"} className="font-medium">
                      {t("PR 标题", locale)}
                    </label>
                    <Input
                      id={id + "-title"}
                      value={draft.title}
                      maxLength={GIT_PR_TITLE_LIMIT}
                      required
                      disabled={applying}
                      onChange={(event) => setDraft({ ...draft, title: event.currentTarget.value })}
                    />
                  </div>
                  <div className="flex flex-col gap-1.5">
                    <label htmlFor={id + "-body"} className="font-medium">
                      {t("PR 说明", locale)}
                    </label>
                    <Textarea
                      id={id + "-body"}
                      rows={4}
                      value={draft.body}
                      maxLength={GIT_PR_BODY_LIMIT}
                      disabled={applying}
                      onChange={(event) => setDraft({ ...draft, body: event.currentTarget.value })}
                    />
                  </div>
                </>
              )}
              {error && (
                <div className="flex flex-col items-start gap-2">
                  <div
                    role="alert"
                    className="text-xs wrap-anywhere whitespace-pre-wrap text-destructive"
                  >
                    {[localizeError(errorSummary ?? "", locale), ...errorDetails].join("\n")}
                  </div>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={disabled}
                    onClick={() => void load(mode, true)}
                  >
                    {t("重新加载", locale)}
                  </Button>
                </div>
              )}
            </div>
            <DialogFooter className="shrink-0">
              <Button
                ref={cancel}
                type="button"
                variant="outline"
                disabled={applying}
                onClick={close}
              >
                {t(nothingToPush ? "关闭" : "取消", locale)}
              </Button>
              {!nothingToPush && (
                <Button type="submit" disabled={primaryDisabled}>
                  {t(
                    applying ? GIT_BRANCH_DIALOG[mode].pending : GIT_BRANCH_DIALOG[mode].submit,
                    locale,
                  )}
                </Button>
              )}
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
