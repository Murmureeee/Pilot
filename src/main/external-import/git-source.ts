// @env node
import { execFile } from "node:child_process";
import { mkdtempSync, realpathSync } from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import type { GitPluginSource } from "@shared/imports";

import { directory } from "./files";
import { PACKAGE_GIT_TIMEOUT, PACKAGE_UNREADABLE } from "./package-constants";

const git = promisify(execFile);
const githubRepo = /^[\w.-]+\/[\w.-]+$/;

export function githubRepository(value: string): string | undefined {
  return githubRepo.test(value) && value.split("/").every((part) => part !== "." && part !== "..")
    ? "https://github.com/" + value.replace(/\.git$/i, "") + ".git"
    : undefined;
}

export function normalizeGitLocation(input: string): string {
  const value = input.trim();
  if (isAbsolute(value)) {
    const root = directory(value);
    if (root) return pathToFileURL(root).href;
  }
  if (
    /^[\w.-]+@[\w.-]+:.+$/.test(value) &&
    Array.from(value).every((char) => char.charCodeAt(0) > 32)
  )
    return value;
  const url = URL.parse(value);
  if (!url || url.hash || url.search || url.password) throw new Error(PACKAGE_UNREADABLE);
  if (url.protocol === "ssh:" || url.protocol === "file:") return url.href;
  if (["https:", "http:"].includes(url.protocol) && !url.username) return url.href;
  throw new Error(PACKAGE_UNREADABLE);
}

export async function withPluginTemporaryDirectory<T>(
  visit: (directory: string) => T | Promise<T>,
): Promise<T> {
  const parent = realpathSync.native(tmpdir());
  const temp = mkdtempSync(join(parent, "pilot-plugin-"));
  try {
    return await visit(temp);
  } finally {
    await rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
}

export async function openPluginGit(
  temp: string,
  source: GitPluginSource,
  metadataOnly = false,
): Promise<{ revision: string; read(args: string[]): Promise<string> }> {
  const repo = join(temp, "repository");
  const options = {
    cwd: temp,
    timeout: PACKAGE_GIT_TIMEOUT,
    windowsHide: true,
    env: {
      ...process.env,
      GIT_TERMINAL_PROMPT: "0",
      GIT_ALLOW_PROTOCOL: "file:http:https:ssh",
      GCM_INTERACTIVE: "never",
    },
  };
  const run = async (args: string[]): Promise<string> => (await git("git", args, options)).stdout;
  const read = (args: string[]): Promise<string> => run(["-C", repo, ...args]);
  const pin = source.sha ?? source.ref;
  if (pin) {
    await run(["init", "--quiet", "--template=", repo]);
    await read([
      "fetch",
      "--no-tags",
      "--no-recurse-submodules",
      "--depth=1",
      "--",
      source.location,
      pin,
    ]);
  } else {
    const filter =
      (metadataOnly || source.path) && /^https?:\/\//.test(source.location)
        ? ["--filter=blob:none"]
        : [];
    await run([
      "clone",
      "--no-checkout",
      "--no-recurse-submodules",
      "--no-tags",
      "--depth=1",
      "--template=",
      ...filter,
      "--",
      source.location,
      repo,
    ]);
  }
  const revision = (
    await read(["rev-parse", "--verify", pin ? "FETCH_HEAD^{commit}" : "HEAD^{commit}"])
  ).trim();
  if (source.sha && source.sha !== revision) throw new Error(PACKAGE_UNREADABLE);
  return { revision, read };
}
