// @env browser
import { GitForkIcon } from "lucide-react";
import { useEffect, useId, useRef, useState, type JSX } from "react";

import { Button } from "@renderer/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@renderer/components/ui/dialog";
import { Input } from "@renderer/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@renderer/components/ui/select";
import { localizeError, t, useLocale } from "@renderer/lib/i18n";
import { useAgentStore } from "@renderer/stores/agent";
import { GIT_BRANCH_NAME_LIMIT } from "@shared/constants";
import type {
  GitWorktreeAction,
  GitWorktreeOptions,
  GitWorktreeRemainder,
  GitWorktreeReview,
} from "@shared/contract";

function WorktreeRemainder({ report }: { report: GitWorktreeRemainder }): JSX.Element {
  const locale = useLocale();
  const { worktree, commits, changes, omittedChanges, unavailable } = report;
  return (
    <div className="grid min-w-0 gap-2">
      <p className="text-xs wrap-anywhere text-muted-foreground">
        {t("任务分支 {0} 从 {1} 创建。", locale, [worktree.branch, worktree.baseBranch])}
      </p>
      <p className="font-mono text-xs wrap-anywhere text-muted-foreground">{worktree.directory}</p>
      {unavailable ? (
        <p role="status">{t("工作树当前无法访问。请从原项目检查目录。", locale)}</p>
      ) : (
        <>
          <p>{t("{0} 项提交尚未合并到基准分支。", locale, [commits])}</p>
          {changes.length > 0 ? (
            <ul
              aria-label={t("剩余文件", locale)}
              className="grid gap-1 rounded-md border px-3 py-2"
            >
              {changes.map(({ path, status }) => (
                <li key={path} className="flex min-w-0 gap-2 text-xs">
                  <code className="shrink-0 whitespace-pre text-muted-foreground">{status}</code>
                  <span className="wrap-anywhere">{path}</span>
                </li>
              ))}
              {omittedChanges > 0 && <li>{t("另有 {0} 项文件。", locale, [omittedChanges])}</li>}
            </ul>
          ) : (
            <p className="text-xs text-muted-foreground">{t("没有剩余的本地文件改动。", locale)}</p>
          )}
        </>
      )}
    </div>
  );
}

export function GitWorktreeDialog({
  composerId,
  onChanged,
}: {
  composerId: string;
  onChanged(): void;
}): JSX.Element {
  const locale = useLocale();
  const labelId = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const close = useRef<HTMLButtonElement>(null);
  const heading = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [options, setOptions] = useState<GitWorktreeOptions>();
  const [review, setReview] = useState<GitWorktreeReview>();
  const [selected, setSelected] = useState<string>();
  const [branch, setBranch] = useState("");
  const [base, setBase] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [feedback, setFeedback] = useState("");

  const perform = async (action: () => Promise<void>): Promise<void> => {
    if (pending) return;
    setPending(true);
    setError("");
    try {
      await action();
    } catch (reason) {
      setError(String(reason));
    } finally {
      setPending(false);
    }
  };

  const load = async (): Promise<void> => {
    const next = await window.pi.sessionGitWorktrees(composerId);
    setOptions(next);
    setBase((value) =>
      next.branches.some(({ name }) => name === value)
        ? value
        : (next.currentBranch ?? next.branches[0]?.name ?? null),
    );
    setBranch((value) => value || next.defaultBranchName);
  };

  const preview = (id: string): void => {
    setSelected(id);
    setReview(undefined);
    setFeedback("");
    void perform(async () => {
      setReview(await window.pi.sessionPreviewGitWorktree(composerId, id));
    });
  };

  const changeOpen = (next: boolean): void => {
    if (pending) return;
    setOpen(next);
    if (next) {
      setOptions(undefined);
      setSelected(undefined);
      setReview(undefined);
      setFeedback("");
      setBase(null);
      setBranch("");
      void perform(load);
    }
  };

  useEffect(() => {
    if (review) heading.current?.focus({ preventScroll: true });
  }, [review]);
  useEffect(() => {
    if (feedback && !pending) close.current?.focus({ preventScroll: true });
  }, [feedback, pending]);

  const baseCommit = options?.branches.find(({ name }) => name === base)?.commit;
  const create = (): void => {
    if (!base || !baseCommit) return;
    void perform(async () => {
      await window.pi.sessionCreateGitWorktree(composerId, {
        baseBranch: base,
        baseCommit,
        branch: branch.trim(),
      });
      setOpen(false);
    });
  };
  const openWorktree = (id: string): void => {
    void perform(async () => {
      await window.pi.sessionOpenGitWorktree(composerId, id);
      setOpen(false);
    });
  };
  const apply = (action: GitWorktreeAction): void => {
    if (!review) return;
    void perform(async () => {
      await window.pi.sessionApplyGitWorktree(composerId, review.token, action);
      onChanged();
      setReview(undefined);
      setSelected(undefined);
      try {
        await load();
      } finally {
        setFeedback(action === "merge" ? "任务分支已合并。" : "工作树已移除。");
      }
    });
  };
  return (
    <>
      <Dialog open={open} onOpenChange={changeOpen}>
        <DialogTrigger render={<Button ref={trigger} size="xs" variant="outline" />}>
          <GitForkIcon data-icon="inline-start" aria-hidden="true" />
          {t("工作树…", locale)}
        </DialogTrigger>
        <DialogContent
          data-worktree-dialog
          showCloseButton={false}
          initialFocus={close}
          finalFocus={trigger}
          className="flex max-h-[calc(100dvh-2rem)] min-w-0 flex-col gap-3 p-4 sm:max-w-xl"
        >
          <DialogHeader>
            <DialogTitle>{t("并行工作树", locale)}</DialogTitle>
            <DialogDescription className="wrap-anywhere">
              {options?.projectDirectory}
            </DialogDescription>
          </DialogHeader>
          <div className="grid min-h-0 min-w-0 gap-3 overflow-y-auto overscroll-contain py-1">
            {feedback && <p role="status">{t(feedback, locale)}</p>}
            {error && (
              <p
                role="alert"
                className="text-sm wrap-anywhere whitespace-pre-wrap text-destructive"
              >
                {localizeError(error, locale)}
              </p>
            )}
            {pending && (
              <p role="status" className="text-xs text-muted-foreground">
                {t("正在处理工作树…", locale)}
              </p>
            )}
            {selected
              ? review && (
                  <>
                    <div
                      ref={heading}
                      tabIndex={-1}
                      className="min-w-0 ring-ring focus-visible:ring-2"
                    >
                      <h3 className="font-medium wrap-anywhere">{review.worktree.branch}</h3>
                    </div>
                    <WorktreeRemainder report={review} />
                    {review.patch && (
                      <details open className="min-w-0 rounded-md border p-2">
                        <summary className="cursor-pointer ring-ring focus-visible:ring-2">
                          {t("已提交差异", locale)}
                        </summary>
                        <pre
                          tabIndex={0}
                          className="mt-2 max-h-56 overflow-auto rounded bg-muted p-2 text-xs ring-ring focus-visible:ring-2"
                        >
                          {review.patch}
                        </pre>
                      </details>
                    )}
                    {review.patchTruncated && (
                      <p className="text-xs text-muted-foreground">
                        {t("差异超过预览上限。可在工作树中查看完整差异。", locale)}
                      </p>
                    )}
                    {review.mergeBlock && (
                      <p className="text-xs text-muted-foreground">
                        {t(review.mergeBlock, locale)}
                      </p>
                    )}
                    {review.removeBlock && review.removeBlock !== review.mergeBlock && (
                      <p role="status" className="text-xs text-muted-foreground">
                        {t(review.removeBlock, locale)}
                      </p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      {t(
                        "移除会删除工作树目录及其中的本地文件。任务分支和聊天记录会保留。",
                        locale,
                      )}
                    </p>
                  </>
                )
              : options && (
                  <>
                    {options.worktrees.length > 0 && (
                      <ul
                        aria-label={t("项目工作树", locale)}
                        className="divide-y rounded-md border"
                      >
                        {options.worktrees.map((worktree) => (
                          <li
                            key={worktree.id}
                            className="flex flex-wrap items-center justify-between gap-2 p-2.5"
                          >
                            <div className="min-w-0 wrap-anywhere">
                              <p>{worktree.branch}</p>
                              <p className="text-xs text-muted-foreground">
                                {t("基准分支 {0}", locale, [worktree.baseBranch])}
                              </p>
                            </div>
                            <div className="flex flex-wrap gap-1">
                              <Button
                                size="xs"
                                variant="outline"
                                disabled={pending}
                                onClick={() => openWorktree(worktree.id)}
                              >
                                {t("打开聊天", locale)}
                              </Button>
                              <Button
                                size="xs"
                                variant="outline"
                                disabled={pending}
                                onClick={() => preview(worktree.id)}
                              >
                                {t("审查工作树…", locale)}
                              </Button>
                            </div>
                          </li>
                        ))}
                      </ul>
                    )}
                    {options.branches.length ? (
                      <div className="grid min-w-0 gap-2 sm:grid-cols-2">
                        <div className="grid min-w-0 gap-1">
                          <label id={labelId}>{t("基准分支", locale)}</label>
                          <Select value={base} onValueChange={setBase} disabled={pending}>
                            <SelectTrigger aria-labelledby={labelId} className="w-full min-w-0">
                              <SelectValue />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectGroup>
                                {options.branches.map(({ name }) => (
                                  <SelectItem key={name} value={name}>
                                    {name}
                                  </SelectItem>
                                ))}
                              </SelectGroup>
                            </SelectContent>
                          </Select>
                          {baseCommit && (
                            <span className="font-mono text-xs text-muted-foreground">
                              {baseCommit.slice(0, 12)}
                            </span>
                          )}
                        </div>
                        <label className="grid min-w-0 content-start gap-1">
                          {t("任务分支名称", locale)}
                          <Input
                            value={branch}
                            maxLength={GIT_BRANCH_NAME_LIMIT}
                            disabled={pending}
                            onChange={(event) => setBranch(event.target.value)}
                          />
                        </label>
                      </div>
                    ) : (
                      <p>{t("请先在原项目创建一次提交。", locale)}</p>
                    )}
                  </>
                )}
          </div>
          <DialogFooter className="flex-row flex-wrap justify-end gap-2">
            <Button
              ref={close}
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => changeOpen(false)}
            >
              {t("关闭", locale)}
            </Button>
            {selected && (
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => {
                  setSelected(undefined);
                  setReview(undefined);
                  setError("");
                }}
              >
                {t("返回工作树", locale)}
              </Button>
            )}
            {error && (
              <Button
                size="sm"
                variant="outline"
                disabled={pending}
                onClick={() => {
                  if (selected) preview(selected);
                  else void perform(load);
                }}
              >
                {t("重新预览", locale)}
              </Button>
            )}
            {selected && review && (
              <>
                <Button
                  size="sm"
                  variant="destructive"
                  disabled={pending || Boolean(error || review.removeBlock)}
                  onClick={() => apply("remove")}
                >
                  {t(
                    review.changes.length || review.omittedChanges
                      ? "丢弃改动并移除"
                      : "移除工作树",
                    locale,
                  )}
                </Button>
                <Button
                  size="sm"
                  disabled={pending || Boolean(error || review.mergeBlock)}
                  onClick={() => apply("merge")}
                >
                  {t("合并到 {0}", locale, [review.worktree.baseBranch])}
                </Button>
              </>
            )}
            {!selected && options && (
              <Button
                size="sm"
                disabled={pending || !baseCommit || !branch.trim()}
                onClick={create}
              >
                {t("创建工作树", locale)}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function WorktreeArchiveDialog({ sessionId }: { sessionId: string }): JSX.Element {
  const locale = useLocale();
  const title = useAgentStore((state) => state.sessions.find(({ id }) => id === sessionId)?.title);
  const close = useAgentStore((state) => state.dismissWorktreeArchive);
  const [report, setReport] = useState<GitWorktreeRemainder>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [request, setRequest] = useState(0);
  const cancel = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    let active = true;
    void window.pi.sessionPreviewWorktreeArchive(sessionId).then(
      (next) => {
        if (active) setReport(next);
      },
      (cause: unknown) => {
        if (active) setError(String(cause));
      },
    );
    return () => {
      active = false;
    };
  }, [sessionId, request]);
  const confirm = async (): Promise<void> => {
    setBusy(true);
    try {
      await window.pi.sessionArchive(sessionId, true);
      close();
    } catch (cause) {
      setError(String(cause));
      setBusy(false);
    }
  };
  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) close();
      }}
    >
      <DialogContent
        data-worktree-archive
        showCloseButton={false}
        initialFocus={cancel}
        finalFocus={() =>
          document.querySelector<HTMLElement>(
            '[data-session-id="' + CSS.escape(sessionId) + '"]',
          ) ?? document.querySelector<HTMLElement>("[data-composer-editor]")
        }
        className="flex max-h-[calc(100dvh-2rem)] flex-col gap-3 p-4 sm:max-w-lg"
      >
        <DialogHeader>
          <DialogTitle>{t("归档工作树聊天", locale)}</DialogTitle>
          <DialogDescription>
            {t("归档「{0}」后，工作树中的文件和分支仍保留。", locale, [
              title ?? t("新会话", locale),
            ])}
          </DialogDescription>
        </DialogHeader>
        <div className="min-h-0 min-w-0 overflow-y-auto overscroll-contain">
          {error ? (
            <p role="alert" className="text-sm wrap-anywhere text-destructive">
              {localizeError(error, locale)}
            </p>
          ) : report ? (
            <WorktreeRemainder report={report} />
          ) : (
            <p role="status" className="text-xs text-muted-foreground">
              {t("加载中…", locale)}
            </p>
          )}
        </div>
        <DialogFooter className="flex-row flex-wrap justify-end">
          <Button ref={cancel} size="sm" variant="outline" disabled={busy} onClick={close}>
            {t("取消", locale)}
          </Button>
          {error && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                setError("");
                setReport(undefined);
                setRequest((value) => value + 1);
              }}
            >
              {t("重试", locale)}
            </Button>
          )}
          <Button
            size="sm"
            disabled={busy || !report || Boolean(error)}
            onClick={() => void confirm()}
          >
            {t("确认归档", locale)}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
