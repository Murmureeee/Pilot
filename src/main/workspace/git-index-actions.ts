// @env node
import type { ExecFileException } from "node:child_process";
import { access, mkdtemp, open, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import type {
  GitChange,
  GitCommitResult,
  GitPatchSelection,
  GitStageSelection,
} from "@shared/contract";

import { GIT_COMMIT_TIMEOUT_MS } from "./constants";
import { readGit, readGitBuffer } from "./git";
import { captureGitSnapshot, compareGitSnapshots } from "./git-changes";
import { displayGitPatch, readGitPatch, readGitSelection, selectedGitPatch } from "./git-patch";
import { readGitIndex } from "./git-review-files";
import type { GitCommandOptions, GitCommitPlan, GitCommitTarget, GitWorktree } from "./types";

async function readOptionalGit(root: string, args: string[]): Promise<string | null> {
  try {
    return (await readGit(root, args)).trimEnd();
  } catch (error) {
    if ((error as ExecFileException).code !== 1) throw error;
    return null;
  }
}

async function resolveIndex(root: string): Promise<string> {
  return (
    await readGit(root, ["rev-parse", "--path-format=absolute", "--git-path", "index"])
  ).replace(/\r?\n$/, "");
}

async function indexContents(index: string): Promise<Buffer | undefined> {
  try {
    return await readFile(index);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    return undefined;
  }
}

async function withTemporaryIndex<T>(
  action: (options: GitCommandOptions & { index: string }, directory: string) => Promise<T>,
): Promise<T> {
  const directory = await mkdtemp(join(tmpdir(), "pilot-git-index-"));
  try {
    return await action({ index: join(directory, "index") }, directory);
  } finally {
    await rm(directory, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
}

async function withLockedIndex(index: string, action: () => Promise<Buffer | void>): Promise<void> {
  const lockPath = index + ".lock";
  const lock = await open(lockPath, "wx").catch((error: NodeJS.ErrnoException) => {
    if (error.code === "EEXIST") throw new Error("Git 暂存区正被其他操作使用，请稍后重试。");
    throw error;
  });
  let installed = false;
  try {
    const replacement = await action();
    if (replacement) {
      await lock.writeFile(replacement);
      await lock.sync();
      await lock.close();
      await rename(lockPath, index);
      installed = true;
    }
  } finally {
    await lock.close();
    if (!installed) await rm(lockPath, { force: true });
  }
}

function findChange(snapshot: GitWorktree, area: GitChange["area"], path: string): GitChange {
  const change = compareGitSnapshots(undefined, snapshot, "workspace")?.changes?.find(
    (entry) => entry.area === area && entry.path === path,
  );
  if (!change) throw new Error("Git 变更已更新，请重新查看差异。");
  return change;
}

async function applyPatch(root: string, patch: Buffer, options: GitCommandOptions): Promise<void> {
  await readGit(
    root,
    ["-c", "apply.ignoreWhitespace=no", "apply", "--cached", "--whitespace=nowarn", "-"],
    { ...options, input: patch },
  );
}

export async function stageGitSelection(
  directory: string,
  snapshot: GitWorktree,
  selection: GitStageSelection,
  checkSession: () => void,
): Promise<void> {
  const { root } = snapshot;
  const index = await resolveIndex(root);
  const before = await indexContents(index);
  const change = findChange(snapshot, selection.area, selection.path);
  await withTemporaryIndex(async (options) => {
    if (before) await writeFile(options.index, before);
    const review = await readGitSelection(directory, snapshot, change, options);
    const patch = selectedGitPatch(review, selection);
    if (selection.hunks) {
      await applyPatch(root, patch, options);
    } else {
      // A Git pathspec can also match descendants when a file has become a directory.
      const original = await readGitIndex(root, undefined, options);
      await readGit(root, ["--literal-pathspecs", "add", "-A", "--", ...review.paths], options);
      const staged = await readGitIndex(root, undefined, options);
      const changed = [...new Set([...original.keys(), ...staged.keys()])].filter(
        (path) => original.get(path) !== staged.get(path),
      );
      if (!changed.length) throw new Error("没有可暂存的内容。");
      if (changed.some((path) => !review.paths.includes(path)))
        throw new Error("Git 变更已更新，请重新查看差异。");
    }
    const replacement = await readFile(options.index);
    const current = await captureGitSnapshot(directory);
    if (!current || !("root" in current) || current.root !== root || current.head !== snapshot.head)
      throw new Error("Git 变更已更新，请重新查看差异。");
    const currentChange = findChange(current, selection.area, selection.path);
    selectedGitPatch(await readGitSelection(directory, current, currentChange), selection);
    await withLockedIndex(index, async () => {
      const live = await indexContents(index);
      if (!(before ? live?.equals(before) : live === undefined))
        throw new Error("Git 变更已更新，请重新查看差异。");
      checkSession();
      return replacement;
    });
  });
}

async function readTarget(root: string): Promise<GitCommitTarget> {
  const [ref, head] = await Promise.all([
    readOptionalGit(root, ["symbolic-ref", "--quiet", "HEAD"]),
    readOptionalGit(root, ["rev-parse", "--verify", "--quiet", "HEAD^{commit}"]),
  ]);
  if ((!ref && !head) || (ref && !ref.startsWith("refs/heads/")))
    throw new Error("无法读取当前 Git 分支。");
  return { ref, head };
}

function branchOf({ ref }: GitCommitTarget): string | null {
  return ref?.slice("refs/heads/".length) ?? null;
}

async function checkOrdinaryCommit(index: string): Promise<void> {
  const markers = [
    "MERGE_HEAD",
    "CHERRY_PICK_HEAD",
    "REVERT_HEAD",
    "rebase-merge",
    "rebase-apply",
    "sequencer",
  ];
  const gitDirectory = dirname(index);
  const pending = await Promise.all(
    markers.map((marker) =>
      access(join(gitDirectory, marker)).then(
        () => true,
        (error: NodeJS.ErrnoException) => {
          if (error.code === "ENOENT") return false;
          throw error;
        },
      ),
    ),
  );
  if (pending.some(Boolean)) throw new Error("请先完成进行中的合并、变基或其他 Git 操作。");
}

async function writeTree(root: string, options: GitCommandOptions): Promise<string> {
  return (await readGit(root, ["write-tree"], options)).trim();
}

async function readTree(
  root: string,
  tree: string | null,
  options: GitCommandOptions,
): Promise<void> {
  await readGit(root, ["read-tree", tree ?? "--empty"], options);
}

export async function previewGitCommit(
  directory: string,
  snapshot: GitWorktree,
  selections: GitPatchSelection[],
): Promise<{ plan: GitCommitPlan; branch: string | null; patch: string }> {
  const { root } = snapshot;
  const [target, indexPath] = await Promise.all([readTarget(root), resolveIndex(root)]);
  await checkOrdinaryCommit(indexPath);
  const index = await indexContents(indexPath);
  if (!index || (target.head ?? "(initial)") !== snapshot.head)
    throw new Error("Git 变更已更新，请重新查看差异。");

  return withTemporaryIndex(async (options, temp) => {
    await writeFile(options.index, index);
    const indexTree = await writeTree(root, options);
    const whole = new Set<string>();
    const paths = new Set<string>();
    const partial: Buffer[] = [];
    const changes = compareGitSnapshots(undefined, snapshot, "workspace")?.changes ?? [];
    const staged = new Map(
      changes.filter((change) => change.area === "staged").map((change) => [change.path, change]),
    );
    for (const selection of selections) {
      const change = staged.get(selection.path);
      if (!change) throw new Error("Git 变更已更新，请重新查看差异。");
      const review = await readGitSelection(directory, snapshot, change, options);
      const patch = selectedGitPatch(review, selection);
      for (const path of review.paths) {
        if (paths.has(path)) throw new Error("存在重复的 Git 提交选项。");
        paths.add(path);
        if (!selection.hunks) whole.add(path);
      }
      if (selection.hunks) partial.push(patch);
    }

    const commitIndex = { index: join(temp, "commit-index") };
    await readTree(root, target.head, commitIndex);
    const base = await writeTree(root, commitIndex);
    if (whole.size) {
      const entries = await readGitIndex(root, undefined, options);
      const zero = "0".repeat(base.length);
      const removals = [...whole].map((path) => "0 " + zero + "\t" + path + "\0");
      const replacements = [...whole].flatMap((path) =>
        (entries.get(path) ?? "")
          .split("\n")
          .filter(Boolean)
          .map((entry) => entry + "\t" + path + "\0"),
      );
      await readGit(root, ["update-index", "-z", "--index-info"], {
        ...commitIndex,
        input: Buffer.from([...removals, ...replacements].join("")),
      });
    }
    if (partial.length) await applyPatch(root, Buffer.concat(partial), commitIndex);
    const tree = await writeTree(root, commitIndex);
    if (base === tree) throw new Error("没有可提交的差异。");
    const changed = await readGit(root, [
      "diff-tree",
      "-r",
      "--no-renames",
      "--name-only",
      "-z",
      base,
      tree,
    ]);
    if (changed.split("\0").some((path) => path && !paths.has(path)))
      throw new Error("所选文件与其他暂存路径冲突。");
    const patch = await readGitPatch(root, ["--find-renames", base, tree, "--"]);
    if (!patch.length) throw new Error("没有可提交的差异。");
    return {
      plan: { root, indexPath, indexTree, tree, ...target },
      branch: branchOf(target),
      patch: displayGitPatch(patch),
    };
  });
}

async function checkCommitPlan(
  plan: GitCommitPlan,
  options: GitCommandOptions & { index: string },
): Promise<void> {
  const [target, indexPath] = await Promise.all([readTarget(plan.root), resolveIndex(plan.root)]);
  await checkOrdinaryCommit(indexPath);
  const index = await indexContents(indexPath);
  if (
    indexPath !== plan.indexPath ||
    target.ref !== plan.ref ||
    target.head !== plan.head ||
    !index
  )
    throw new Error("Git 分支或暂存区已变更，请重新预览提交。");
  await writeFile(options.index, index);
  if ((await writeTree(plan.root, options)) !== plan.indexTree)
    throw new Error("Git 分支或暂存区已变更，请重新预览提交。");
}

async function runCommitHook(
  root: string,
  hook: string,
  options: GitCommandOptions,
  args: string[] = [],
): Promise<void> {
  await readGit(root, ["hook", "run", "--ignore-missing", hook, "--", ...args], {
    ...options,
    timeout: GIT_COMMIT_TIMEOUT_MS,
  });
}

export async function applyGitCommit(
  plan: GitCommitPlan,
  message: string,
  checkSession: () => void,
): Promise<GitCommitResult> {
  const { root, tree, head, ref } = plan;
  return withTemporaryIndex(async (options, temp) => {
    const liveIndex = { index: join(temp, "live-index") };
    await checkCommitPlan(plan, liveIndex);
    checkSession();
    await readTree(root, tree, options);
    await runCommitHook(root, "pre-commit", options);
    const messagePath = join(temp, "COMMIT_EDITMSG");
    await writeFile(messagePath, message.replaceAll("\r\n", "\n"));
    await runCommitHook(root, "prepare-commit-msg", options, [messagePath, "message"]);
    await runCommitHook(root, "commit-msg", options, [messagePath]);
    if ((await writeTree(root, options)) !== tree)
      throw new Error("Git 钩子修改了预览中的暂存内容，请重新审查。");

    const input = await readGitBuffer(root, ["stripspace"], { input: await readFile(messagePath) });
    if (!input.length) throw new Error("请输入提交信息。");
    const sign = await readOptionalGit(root, ["config", "--type=bool", "--get", "commit.gpgsign"]);
    const commit = (
      await readGit(
        root,
        ["commit-tree", tree, ...(head ? ["-p", head] : []), ...(sign === "true" ? ["-S"] : [])],
        { input, timeout: GIT_COMMIT_TIMEOUT_MS },
      )
    ).trim();

    await withLockedIndex(plan.indexPath, async () => {
      await checkCommitPlan(plan, liveIndex);
      checkSession();
      const subject = input.toString("utf8").split("\n", 1)[0];
      // Pin the branch and its old tip. Only the reviewed tree becomes reachable, and the real index is untouched.
      try {
        await readGit(
          root,
          [
            "update-ref",
            ...(ref ? [] : ["--no-deref"]),
            "-m",
            "commit: " + subject,
            ref ?? "HEAD",
            commit,
            head ?? "0".repeat(commit.length),
          ],
          { timeout: GIT_COMMIT_TIMEOUT_MS },
        );
      } catch (error) {
        // A reference-transaction hook can time out after Git has installed the commit.
        if (
          (await readOptionalGit(root, ["rev-parse", "--verify", "--quiet", ref ?? "HEAD"])) !==
          commit
        )
          throw error;
      }
    });
    // Git ignores the post-commit exit status since the commit is already published locally.
    await runCommitHook(root, "post-commit", options).catch(() => {});
    return { commit, branch: branchOf(plan) };
  });
}

export function gitActionError(error: unknown): Error {
  const failure = error as ExecFileException & { stderr?: Buffer; stdout?: Buffer };
  if (failure.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER")
    return new Error("Git 差异过大，无法完整预览。");
  if (failure.killed) return new Error("Git 操作超时，请重试。");
  const detail = failure.stderr?.toString().trim() || failure.stdout?.toString().trim();
  return detail
    ? new Error(detail.slice(0, 2000))
    : error instanceof Error
      ? error
      : new Error(String(error));
}
