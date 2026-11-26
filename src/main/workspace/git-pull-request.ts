// @env node
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { GitPullRequestDraft, GitPullRequestPreview } from "@shared/contract";

import { GIT_PR_TITLE_LIMIT } from "../../shared/constants";
import { GIT_BRANCH_REF_PREFIX, GIT_OBJECT_ID } from "./constants";
import { runGitHubCli } from "./gh";
import { readGit, readOptionalGit } from "./git";
import {
  readGitBranchState,
  resolveGitPushTarget,
  sameGitPushTarget,
  validateGitBranch,
} from "./git-branch-actions";
import type { GitPullRequestPlan } from "./types";

const REPOSITORY_NAME = /^[\w.-]+\/[\w.-]+$/;
const GITHUB_HOST = "github.com";
const STALE_PR = "本地分支或 PR 来源已变更，请重新加载确认范围。";

function githubRepository(url: string): string {
  const scp = /^(?:[^@/]+@)?github\.com:(.+)$/i.exec(url);
  if (scp?.[1]) {
    const name = scp[1].replace(/\.git$/, "");
    if (REPOSITORY_NAME.test(name)) return name;
  } else if (URL.canParse(url)) {
    const parsed = new URL(url);
    if (
      (parsed.hostname === GITHUB_HOST &&
        (parsed.protocol === "https:" || parsed.protocol === "ssh:")) ||
      (parsed.hostname === "ssh.github.com" && parsed.protocol === "ssh:")
    ) {
      const name = parsed.pathname
        .replace(/^\//, "")
        .replace(/\/$/, "")
        .replace(/\.git$/, "");
      if (REPOSITORY_NAME.test(name)) return name;
    }
  }
  throw new Error("当前推送地址无法对应到 GitHub.com 仓库。请检查 Git 远端配置。");
}

async function readRepository(
  root: string,
  name: string,
): Promise<{ name: string; base: string; parent?: string }> {
  const output = await runGitHubCli(
    root,
    ["repo", "view", GITHUB_HOST + "/" + name, "--json", "nameWithOwner,defaultBranchRef,parent"],
    "无法读取 GitHub 仓库。请检查 gh 登录状态和仓库权限。",
  );
  const data = JSON.parse(output) as {
    nameWithOwner?: string;
    defaultBranchRef?: { name?: string };
    parent?: { nameWithOwner?: string };
  };
  const base = data.defaultBranchRef?.name;
  const parent = data.parent?.nameWithOwner;
  if (
    data.nameWithOwner?.toLowerCase() !== name.toLowerCase() ||
    !base ||
    (parent && !REPOSITORY_NAME.test(parent))
  )
    throw new Error("无法识别 GitHub 仓库或默认分支。请核对远端地址。");
  return { name: data.nameWithOwner, base, parent };
}

async function readPublishedHead(root: string, repo: string, branch: string): Promise<string> {
  const ref = branch.split("/").map(encodeURIComponent).join("/");
  const hash = await runGitHubCli(
    root,
    [
      "api",
      "--hostname",
      GITHUB_HOST,
      "repos/" + repo + "/git/ref/heads/" + ref,
      "--jq",
      ".object.sha",
    ],
    "无法读取 GitHub 分支。请确认分支已推送，并检查 gh 登录状态。",
  );
  if (!GIT_OBJECT_ID.test(hash)) throw new Error("无法确认 GitHub 分支的提交。请重新加载。");
  return hash;
}

async function pullRequestText(
  root: string,
  head: string,
  base: string,
  branch: string,
  task?: string,
): Promise<{ title: string; body: string }> {
  const localBase = await readOptionalGit(root, [
    "rev-parse",
    "--verify",
    "--quiet",
    base + "^{commit}",
  ]);
  const args = localBase ? ["--max-count=20", localBase + ".." + head] : ["-1", head];
  const output = await readGit(root, ["log", "--no-show-signature", "--format=%s", ...args, "--"]);
  const commits = output.trim().split("\n").filter(Boolean);
  const summary = task?.replaceAll("\0", "").trim();
  const title = (summary?.split(/\r?\n/, 1)[0] || commits[0] || branch)
    .slice(0, GIT_PR_TITLE_LIMIT)
    .trim();
  const body = [summary?.slice(0, 3000), commits.map((commit) => "- " + commit).join("\n")]
    .filter(Boolean)
    .join("\n\n");
  return { title, body };
}

export async function previewGitPullRequest(
  directory: string,
  task?: string,
): Promise<{ plan: GitPullRequestPlan; preview: Omit<GitPullRequestPreview, "token"> }> {
  const state = await readGitBranchState(directory);
  const { root } = state;
  const target = await resolveGitPushTarget(state);
  const source = await readRepository(root, githubRepository(target.url));
  const branch = target.ref.slice(GIT_BRANCH_REF_PREFIX.length);
  const [published, destination] = await Promise.all([
    readPublishedHead(root, source.name, branch),
    source.parent ? readRepository(root, source.parent) : Promise.resolve(source),
  ]);
  if (published !== target.head) throw new Error("GitHub 分支与本地提交不同。请先推送当前分支。");
  const head = destination.name === source.name ? branch : source.name.split("/")[0] + ":" + branch;
  const baseHash = await readPublishedHead(root, destination.name, destination.base);
  const text = await pullRequestText(root, target.head, baseHash, branch, task);
  return {
    plan: { root, target, sourceRepository: source.name, repository: destination.name, head },
    preview: { ...text, repository: destination.name, head, base: destination.base },
  };
}

export async function createGitPullRequest(
  directory: string,
  plan: GitPullRequestPlan,
  draft: GitPullRequestDraft,
  assertCurrent: () => void,
): Promise<string> {
  const { root, target, sourceRepository, repository, head } = plan;
  const state = await readGitBranchState(directory);
  if (
    root !== state.root ||
    state.ref !== GIT_BRANCH_REF_PREFIX + target.branch ||
    state.commit !== target.head
  )
    throw new Error(STALE_PR);
  if (!sameGitPushTarget(target, await resolveGitPushTarget(state))) throw new Error(STALE_PR);
  await validateGitBranch(root, draft.base);
  const sourceBranch = target.ref.slice(GIT_BRANCH_REF_PREFIX.length);
  if (sourceRepository === repository && sourceBranch === draft.base)
    throw new Error("PR 的基准分支必须不同于来源分支。请选择其他分支。");
  const [published] = await Promise.all([
    readPublishedHead(root, sourceRepository, sourceBranch),
    readPublishedHead(root, repository, draft.base),
  ]);
  if (published !== target.head) throw new Error(STALE_PR);

  const temp = await mkdtemp(join(tmpdir(), "pilot-git-pr-"));
  try {
    const body = join(temp, "body.md");
    await writeFile(body, draft.body, { mode: 0o600 });
    assertCurrent();
    // --head keeps gh from offering to push or fork as part of creating the request.
    const output = await runGitHubCli(
      root,
      [
        "pr",
        "create",
        "--repo",
        GITHUB_HOST + "/" + repository,
        "--head",
        head,
        "--base",
        draft.base,
        "--title",
        draft.title.trim(),
        "--body-file",
        body,
      ],
      "PR 创建未确认成功。请检查 GitHub 上的 PR 和 gh 登录状态。",
    );
    const url = output.split(/\r?\n/).at(-1) ?? "";
    const parsed = URL.canParse(url) ? new URL(url) : null;
    if (
      !parsed ||
      parsed.origin !== "https://" + GITHUB_HOST ||
      !parsed.pathname.toLowerCase().startsWith("/" + repository.toLowerCase() + "/pull/") ||
      !/\/pull\/\d+$/.test(parsed.pathname)
    )
      throw new Error("未收到 PR 链接。请在 GitHub 上核对创建结果。");
    return parsed.href;
  } finally {
    await rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
}
