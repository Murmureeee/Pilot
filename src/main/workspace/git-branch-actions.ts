// @env node
import type { ExecFileException } from "node:child_process";
import { createHash } from "node:crypto";

import type {
  GitBranchOptions,
  GitBranchRequest,
  GitPushPreview,
  GitPushResult,
} from "@shared/contract";

import { GIT_BRANCH_NAME_LIMIT } from "../../shared/constants";
import {
  GIT_BRANCH_REF_PREFIX,
  GIT_OBJECT_ID,
  GIT_PUBLISH_TIMEOUT_MS,
  GIT_REMOTE_READ_TIMEOUT_MS,
} from "./constants";
import { readGit, readOptionalGit, resolveGitDirectory } from "./git";
import type { GitBranchState, GitPushPlan, GitPushTarget } from "./types";

const STALE_PUSH = "本地分支或远端已变更，请重新预览推送。";

export async function readGitBranchState(directory: string): Promise<GitBranchState> {
  const root = (
    await readGit(resolveGitDirectory(directory), ["rev-parse", "--show-toplevel"])
  ).trimEnd();
  const [ref, commit] = await Promise.all([
    readOptionalGit(root, ["symbolic-ref", "--quiet", "HEAD"]),
    readOptionalGit(root, ["rev-parse", "--verify", "--quiet", "HEAD"]),
  ]);
  return { root, ref: ref?.startsWith(GIT_BRANCH_REF_PREFIX) ? ref : null, commit };
}

export async function validateGitBranch(root: string, branch: string): Promise<void> {
  if (
    !branch ||
    branch.length > GIT_BRANCH_NAME_LIMIT ||
    branch.startsWith("-") ||
    /[\0\r\n]/.test(branch)
  )
    throw new Error("分支名称无效。请检查名称后重试。");
  try {
    const result = (await readGit(root, ["check-ref-format", "--branch", branch])).trimEnd();
    if (result === branch) return;
  } catch {
    // A typed name must be a literal branch, including when Git accepts a checkout shorthand.
  }
  throw new Error("分支名称无效。请检查名称后重试。");
}

export async function readGitBranches(
  directory: string,
): Promise<{ plan: GitBranchState; options: Omit<GitBranchOptions, "token"> }> {
  const plan = await readGitBranchState(directory);
  const output = await readGit(plan.root, ["for-each-ref", "--format=%(refname)", "refs/heads"]);
  return {
    plan,
    options: {
      head: plan.ref
        ? { branch: plan.ref.slice(GIT_BRANCH_REF_PREFIX.length) }
        : plan.commit
          ? { detachedAt: plan.commit.slice(0, 12) }
          : null,
      branches: output
        .trimEnd()
        .split("\n")
        .filter((ref) => ref.startsWith(GIT_BRANCH_REF_PREFIX))
        .map((ref) => ref.slice(GIT_BRANCH_REF_PREFIX.length)),
    },
  };
}

export async function switchGitBranch(
  directory: string,
  plan: GitBranchState,
  request: GitBranchRequest,
  assertCurrent: () => void,
): Promise<void> {
  await validateGitBranch(plan.root, request.branch);
  const current = await readGitBranchState(directory);
  if (current.root !== plan.root || current.ref !== plan.ref || current.commit !== plan.commit)
    throw new Error("当前分支已变更，请重新加载分支列表。");
  assertCurrent();
  await readGit(
    plan.root,
    [
      "switch",
      "--no-guess",
      ...(request.kind === "create"
        ? ["--create", request.branch, "--", ...(plan.commit ? [plan.commit] : [])]
        : ["--", request.branch]),
    ],
    { timeout: GIT_PUBLISH_TIMEOUT_MS },
  );
}

export async function resolveGitPushTarget({
  root,
  ref,
  commit,
}: GitBranchState): Promise<GitPushTarget> {
  if (!ref) throw new Error("当前处于游离 HEAD。请先创建或切换到本地分支。");
  if (!commit) throw new Error("当前分支还没有提交。请先提交改动。");
  const branch = ref.slice(GIT_BRANCH_REF_PREFIX.length);
  const config = (key: string): Promise<string | null> =>
    readOptionalGit(root, ["config", "--get", key]);
  const [pushRemote, pushDefault, upstream, merge, remotesOutput] = await Promise.all([
    config("branch." + branch + ".pushRemote"),
    config("remote.pushDefault"),
    config("branch." + branch + ".remote"),
    config("branch." + branch + ".merge"),
    readGit(root, ["remote"]),
  ]);
  const remotes = remotesOutput.trimEnd().split("\n").filter(Boolean);
  const fallback = remotes.length === 1 ? remotes[0] : "origin";
  const remote = pushRemote || pushDefault || upstream || fallback;
  if (!remote || !remotes.includes(remote))
    throw new Error("找不到推送远端。请在终端添加远端或配置当前分支的推送远端。");
  const urls = (await readGit(root, ["remote", "get-url", "--push", "--all", "--", remote]))
    .trimEnd()
    .split("\n");
  const url = urls.length === 1 ? urls[0] : undefined;
  if (!url) throw new Error("此远端配置了多个推送地址。请在终端核对地址，再执行推送。");
  const targetRef = upstream === remote && merge?.startsWith(GIT_BRANCH_REF_PREFIX) ? merge : ref;
  return { branch, head: commit, remote, url, ref: targetRef, trackUpstream: !upstream || !merge };
}

export function sameGitPushTarget(before: GitPushTarget, after: GitPushTarget): boolean {
  return (
    before.branch === after.branch &&
    before.head === after.head &&
    before.remote === after.remote &&
    before.url === after.url &&
    before.ref === after.ref &&
    before.trackUpstream === after.trackUpstream
  );
}

function destinationLabel(url: string): string {
  if (/^[\w+.-]+:\/\//.test(url)) {
    try {
      const parsed = new URL(url);
      return parsed.protocol + "//" + parsed.host + parsed.pathname;
    } catch {
      return url.split(":", 1)[0] + "://…";
    }
  }
  return url.replace(/^[^@/\\:]+@(?=[^/\\]+:)/, "");
}

function remoteError(error: unknown, url: string, summary: string): Error {
  const stderr = (error as { stderr?: Buffer }).stderr?.toString().trim() ?? "";
  const detail = stderr
    .replaceAll(url, destinationLabel(url))
    .replace(/[\w+.-]+:\/\/[^\s'"<>]+/g, destinationLabel)
    .slice(0, 1200);
  return new Error(detail ? summary + "\n" + detail : summary, { cause: error });
}

async function readRemoteHeads(root: string, target: GitPushTarget): Promise<Map<string, string>> {
  const url = target.url;
  // ls-remote uses fetch rewrites even when given the effective push URL.
  const resolved = (await readGit(root, ["ls-remote", "--get-url", "--", url])).trimEnd();
  if (url !== resolved)
    throw new Error("远端地址重写与推送地址不一致。请在终端检查 Git 地址配置。");
  try {
    const output = await readGit(root, ["ls-remote", "--heads", "--", url], {
      noPrompt: true,
      timeout: GIT_REMOTE_READ_TIMEOUT_MS,
    });
    const heads = new Map<string, string>();
    for (const line of output.trimEnd().split("\n")) {
      const [hash, ref] = line.split("\t");
      if (hash && ref?.startsWith(GIT_BRANCH_REF_PREFIX) && GIT_OBJECT_ID.test(hash))
        heads.set(ref, hash);
    }
    return heads;
  } catch (error) {
    throw remoteError(error, url, "无法读取远端分支。请检查连接和 Git 凭据后重试。");
  }
}

function remoteRevision(heads: Map<string, string>, ref: string): string {
  return (
    heads.get(ref) ??
    createHash("sha256")
      .update(JSON.stringify([...heads].sort()))
      .digest("hex")
  );
}

async function knownRemoteCommits(root: string, heads: Map<string, string>): Promise<string[]> {
  if (!heads.size) return [];
  const output = await readGit(root, ["cat-file", "--batch-check"], {
    input: Buffer.from([...new Set(heads.values())].join("\n") + "\n"),
  });
  return output
    .trimEnd()
    .split("\n")
    .flatMap((line) => {
      const [hash, type] = line.split(" ");
      return hash && type === "commit" && GIT_OBJECT_ID.test(hash) ? [hash] : [];
    });
}

export async function previewGitPush(
  directory: string,
): Promise<{ plan: GitPushPlan; preview: Omit<GitPushPreview, "token"> }> {
  const state = await readGitBranchState(directory);
  const { root } = state;
  const target = await resolveGitPushTarget(state);
  const heads = await readRemoteHeads(root, target);
  const targetHead = heads.get(target.ref);
  if (targetHead) {
    try {
      await readGit(root, ["merge-base", "--is-ancestor", targetHead, target.head]);
    } catch (error) {
      if (![1, 128].includes((error as ExecFileException).code as number)) throw error;
      throw new Error("远端分支含有当前分支没有的历史。请先提取并整合远端改动。", {
        cause: error,
      });
    }
  }
  const excluded = targetHead ? [targetHead] : await knownRemoteCommits(root, heads);
  const revisions = [target.head, ...excluded.map((hash) => "^" + hash)].join("\n") + "\n";
  const output = await readGit(
    root,
    ["log", "--no-show-signature", "-z", "--format=%H%x00%s", "--stdin", "--"],
    {
      input: Buffer.from(revisions),
    },
  );
  const fields = output.split("\0");
  const commits: GitPushPreview["commits"] = [];
  for (let index = 0; index + 1 < fields.length; index += 2) {
    const hash = fields[index]!;
    if (GIT_OBJECT_ID.test(hash)) commits.push({ hash, subject: fields[index + 1]! });
  }
  return {
    plan: { root, target, remoteRevision: remoteRevision(heads, target.ref) },
    preview: {
      branch: target.branch,
      remote: target.remote,
      destination: destinationLabel(target.url),
      targetBranch: target.ref.slice(GIT_BRANCH_REF_PREFIX.length),
      newBranch: !targetHead,
      commits,
    },
  };
}

export async function pushGitBranch(
  directory: string,
  { root, target, remoteRevision: expectedRevision }: GitPushPlan,
  assertCurrent: () => void,
): Promise<GitPushResult> {
  const state = await readGitBranchState(directory);
  if (
    root !== state.root ||
    state.ref !== GIT_BRANCH_REF_PREFIX + target.branch ||
    state.commit !== target.head
  )
    throw new Error(STALE_PUSH);
  if (!sameGitPushTarget(target, await resolveGitPushTarget(state))) throw new Error(STALE_PUSH);
  const heads = await readRemoteHeads(root, target);
  if (remoteRevision(heads, target.ref) !== expectedRevision) throw new Error(STALE_PUSH);
  assertCurrent();
  try {
    // An explicit object and refspec constrain what is sent even if HEAD changes during push.
    await readGit(
      root,
      [
        "-c",
        "remote." + target.remote + ".mirror=false",
        "push",
        "--porcelain",
        "--no-follow-tags",
        "--recurse-submodules=no",
        "--",
        target.remote,
        target.head + ":" + target.ref,
      ],
      { noPrompt: true, timeout: GIT_PUBLISH_TIMEOUT_MS },
    );
  } catch (error) {
    throw remoteError(error, target.url, "推送未确认成功。请检查远端状态后重新预览。");
  }
  if (target.trackUpstream) {
    try {
      const branch = target.ref.slice(GIT_BRANCH_REF_PREFIX.length);
      await readGit(root, [
        "branch",
        "--set-upstream-to=refs/remotes/" + target.remote + "/" + branch,
        "--",
        target.branch,
      ]);
    } catch {
      return { trackingFailed: true };
    }
  }
  return {};
}
