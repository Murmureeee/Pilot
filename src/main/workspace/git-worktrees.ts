// @env node
import type { ExecFileException } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync, lstatSync, mkdirSync, realpathSync } from "node:fs";
import { join, relative } from "node:path";

import type {
  GitWorktreeAction,
  GitWorktreeCreate,
  GitWorktreeOptions,
  GitWorktreeRemainder,
  ManagedWorktree,
} from "@shared/contract";

import {
  GIT_BRANCH_REF_PREFIX,
  GIT_OBJECT_ID,
  GIT_PUBLISH_TIMEOUT_MS,
  MAX_DIRECTORY_PREVIEW_ENTRIES,
  WORKTREE_PATCH_PREVIEW_LIMIT,
  WORKTREE_UNAVAILABLE,
} from "./constants";
import { readGit, readOptionalGit, resolveGitDirectory } from "./git";
import { readGitBranchState, validateGitBranch } from "./git-branch-actions";
import { captureGitSnapshot } from "./git-changes";
import { displayGitPatch, readGitPatch } from "./git-patch";
import { workspacesOverlap } from "./paths";
import type { GitWorktreeInspection } from "./types";

const refOf = (name: string): string => GIT_BRANCH_REF_PREFIX + name;

async function tip(root: string, branch: string): Promise<string | null> {
  const commit = await readOptionalGit(root, [
    "rev-parse",
    "--verify",
    "--quiet",
    "--end-of-options",
    refOf(branch) + "^{commit}",
  ]);
  return commit && GIT_OBJECT_ID.test(commit) ? commit : null;
}

function uncommitted(root: string, ignored = false): Promise<string> {
  return readGit(root, [
    "status",
    "--porcelain=v1",
    "-z",
    "--untracked-files=all",
    "--ignore-submodules=none",
    ...(ignored ? ["--ignored=matching"] : []),
  ]);
}

function changedPaths(status: string): GitWorktreeRemainder["changes"] {
  const fields = status.split("\0");
  const result: GitWorktreeRemainder["changes"] = [];
  for (let index = 0; index < fields.length; index++) {
    const field = fields[index];
    if (!field) continue;
    const code = field.slice(0, 2);
    result.push({ path: field.slice(3), status: code });
    if (/[RC]/.test(code)) index++;
  }
  return result;
}

async function operationInProgress(root: string): Promise<boolean> {
  const gitDir = (await readGit(root, ["rev-parse", "--absolute-git-dir"])).trimEnd();
  return [
    "MERGE_HEAD",
    "CHERRY_PICK_HEAD",
    "REVERT_HEAD",
    "rebase-apply",
    "rebase-merge",
    "sequencer",
  ].some((name) => existsSync(join(gitDir, name)));
}

export async function readWorktreeOptions(
  projectDirectory: string,
  worktrees: ManagedWorktree[],
): Promise<GitWorktreeOptions> {
  const [head, refs] = await Promise.all([
    readGitBranchState(projectDirectory),
    readGit(projectDirectory, [
      "for-each-ref",
      "--format=%(refname:short)%09%(objectname)",
      "refs/heads",
    ]),
  ]);
  return {
    projectDirectory,
    currentBranch: head.ref?.slice(GIT_BRANCH_REF_PREFIX.length) ?? null,
    defaultBranchName: "codex/" + randomUUID().slice(0, 8),
    branches: refs
      .trimEnd()
      .split("\n")
      .flatMap((line) => {
        const [name, commit] = line.split("\t");
        return name && GIT_OBJECT_ID.test(commit ?? "") ? [{ name, commit }] : [];
      }),
    worktrees,
  };
}

export async function gitWorktreeProject(directory: string): Promise<string> {
  const { root } = await readGitBranchState(directory);
  return resolveGitDirectory(root);
}

export async function planNewWorktree(
  projectDirectory: string,
  worktreesDir: string,
  request: GitWorktreeCreate,
): Promise<ManagedWorktree> {
  const { branch, baseBranch, baseCommit } = request;
  await Promise.all([
    validateGitBranch(projectDirectory, branch),
    validateGitBranch(projectDirectory, baseBranch),
  ]);
  const commit = await tip(projectDirectory, baseBranch);
  if (!commit || commit !== baseCommit) throw new Error("基准分支已变更。请刷新分支列表后重试。");
  mkdirSync(worktreesDir, { recursive: true });
  const canonical = realpathSync.native(worktreesDir);
  if (workspacesOverlap(projectDirectory, canonical))
    throw new Error("工作树存放目录与当前仓库重叠。请使用独立的应用数据目录。");
  const id = randomUUID();
  return { id, projectDirectory, directory: join(canonical, id), branch, baseBranch, baseCommit };
}

export async function createGitWorktree(worktree: ManagedWorktree): Promise<void> {
  const { projectDirectory, branch, directory, baseBranch, baseCommit } = worktree;
  if ((await tip(projectDirectory, baseBranch)) !== baseCommit)
    throw new Error("基准分支已变更。请刷新分支列表后重试。");
  await readGit(projectDirectory, ["worktree", "add", "-b", branch, "--", directory, baseCommit], {
    timeout: GIT_PUBLISH_TIMEOUT_MS,
  });
}

export async function verifyLinkedWorktree(worktree: ManagedWorktree): Promise<boolean> {
  const { directory, projectDirectory, removed } = worktree;
  if (
    removed ||
    !existsSync(directory) ||
    relative(directory, realpathSync.native(directory)) !== ""
  )
    throw new Error(WORKTREE_UNAVAILABLE);
  const fields = (await readGit(projectDirectory, ["worktree", "list", "--porcelain", "-z"]))
    .split("\0\0")
    .map((entry) => entry.split("\0"));
  const registration = fields
    .slice(1)
    .find(([line]) => line.startsWith("worktree ") && relative(directory, line.slice(9)) === "");
  if (!registration || !lstatSync(join(directory, ".git"), { throwIfNoEntry: false })?.isFile())
    throw new Error(WORKTREE_UNAVAILABLE);
  const [worktreeCommon, projectCommon] = await Promise.all(
    [directory, projectDirectory].map(async (root) =>
      realpathSync.native(
        (
          await readGit(root, ["rev-parse", "--path-format=absolute", "--git-common-dir"])
        ).trimEnd(),
      ),
    ),
  );
  if (relative(worktreeCommon, projectCommon) !== "") throw new Error(WORKTREE_UNAVAILABLE);
  return registration.some((line) => line === "locked" || line.startsWith("locked "));
}

export async function inspectGitWorktree(
  worktree: ManagedWorktree,
): Promise<GitWorktreeInspection> {
  const { projectDirectory, directory, baseBranch, baseCommit, branch } = worktree;
  const locked = await verifyLinkedWorktree(worktree);
  const [source, target, baseTip, status, targetStatus, sourceOperation, targetOperation] =
    await Promise.all([
      readGitBranchState(directory),
      readGitBranchState(projectDirectory),
      tip(projectDirectory, baseBranch),
      uncommitted(directory, true),
      uncommitted(projectDirectory),
      operationInProgress(directory),
      operationInProgress(projectDirectory),
    ]);
  if (!source.commit) throw new Error(WORKTREE_UNAVAILABLE);
  const head = source.commit;
  const base = baseTip ?? baseCommit;
  const [ancestor, commitCount] = (
    await Promise.all([
      readGit(projectDirectory, ["merge-base", base, head]),
      readGit(projectDirectory, ["rev-list", "--count", base + ".." + head]),
    ])
  ).map((line) => line.trimEnd());
  const changes = changedPaths(status);
  const dirty = changes.some(({ status: code }) => code !== "!!");
  const snapshot = dirty ? await captureGitSnapshot(directory) : null;
  const missingFingerprint = dirty && (!snapshot || !("entries" in snapshot));
  const removeBlock = locked
    ? "此工作树已锁定。请先用 Git 解锁。"
    : sourceOperation
      ? "工作树中还有 Git 操作。请先完成或取消该操作。"
      : source.ref !== refOf(branch)
        ? "工作树的分支已切换。请切回任务分支后重试。"
        : missingFingerprint
          ? "无法核对工作树改动。请在终端审查后重试。"
          : undefined;
  let mergeBlock: string | undefined;
  if (source.ref !== refOf(branch)) mergeBlock = "工作树的分支已切换。请切回任务分支后重试。";
  else if (dirty || sourceOperation) mergeBlock = "请先提交工作树中的改动并结束 Git 操作。";
  else if (!baseTip) mergeBlock = "找不到基准分支。请恢复该分支后重试。";
  else if (target.ref !== refOf(baseBranch) || target.commit !== baseTip)
    mergeBlock = "请在原项目中检出基准分支后重试。";
  else if (targetStatus || targetOperation)
    mergeBlock = "请先处理原项目的未提交改动或正在进行的 Git 操作。";
  else if (commitCount === "0") mergeBlock = "任务提交已在基准分支中。";
  const signature = createHash("sha256")
    .update(
      JSON.stringify({
        source,
        target,
        baseTip,
        status,
        targetStatus,
        snapshot,
        removeBlock,
        mergeBlock,
      }),
    )
    .digest("hex");
  return {
    signature,
    ancestor,
    target: baseTip,
    remainder: {
      worktree,
      head,
      commits: Number(commitCount),
      changes: changes.slice(0, MAX_DIRECTORY_PREVIEW_ENTRIES),
      omittedChanges: Math.max(0, changes.length - MAX_DIRECTORY_PREVIEW_ENTRIES),
    },
    removeBlock,
    mergeBlock,
  };
}

export async function worktreePatch(
  inspection: GitWorktreeInspection,
): Promise<{ patch: string; patchTruncated: boolean }> {
  const { ancestor, remainder } = inspection;
  try {
    const patch = displayGitPatch(
      await readGitPatch(remainder.worktree.projectDirectory, [ancestor, remainder.head, "--"]),
    );
    return {
      patch: patch.slice(0, WORKTREE_PATCH_PREVIEW_LIMIT),
      patchTruncated: patch.length > WORKTREE_PATCH_PREVIEW_LIMIT,
    };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER")
      return { patch: "", patchTruncated: true };
    throw error;
  }
}

export async function applyWorktreeAction(
  inspection: GitWorktreeInspection,
  action: GitWorktreeAction,
  assertCurrent: () => void,
): Promise<void> {
  const { remainder, target, mergeBlock, removeBlock } = inspection;
  const { worktree, head, changes, omittedChanges } = remainder;
  if (action === "remove") {
    if (removeBlock) throw new Error(removeBlock);
    assertCurrent();
    await readGit(
      worktree.projectDirectory,
      [
        "worktree",
        "remove",
        ...(changes.length || omittedChanges ? ["--force"] : []),
        "--",
        worktree.directory,
      ],
      { timeout: GIT_PUBLISH_TIMEOUT_MS },
    );
    return;
  }
  if (mergeBlock || !target) throw new Error(mergeBlock ?? "找不到基准分支。请恢复该分支后重试。");
  if (target !== inspection.ancestor) {
    try {
      await readGit(worktree.projectDirectory, ["merge-tree", "--write-tree", target, head], {
        timeout: GIT_PUBLISH_TIMEOUT_MS,
      });
    } catch (error) {
      if ((error as ExecFileException).code === 1)
        throw new Error("发现合并冲突。请在任务分支解决冲突后重新预览。", { cause: error });
      throw error;
    }
  }
  if ((await inspectGitWorktree(worktree)).signature !== inspection.signature)
    throw new Error("工作树或基准分支已变更。请重新预览。");
  assertCurrent();
  await readGit(
    worktree.projectDirectory,
    ["merge", "--commit", "--no-edit", "--no-overwrite-ignore", "--no-autostash", "--", head],
    { timeout: GIT_PUBLISH_TIMEOUT_MS },
  );
}
