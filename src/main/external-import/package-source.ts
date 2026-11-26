// @env node
import { execFile } from "node:child_process";
import { once } from "node:events";
import {
  cpSync,
  createWriteStream,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  realpathSync,
  statSync,
} from "node:fs";
import { rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, isAbsolute, join, relative } from "node:path";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { openPromise } from "yauzl";

import type { PluginPackageSource } from "@shared/imports";

import { directory } from "./files";
import {
  PACKAGE_BAD_PATH,
  PACKAGE_ENTRY_LIMIT,
  PACKAGE_GIT_TIMEOUT,
  PACKAGE_IGNORED,
  PACKAGE_SIZE_LIMIT,
  PACKAGE_TOO_LARGE,
  PACKAGE_UNREADABLE,
} from "./package-constants";

const git = promisify(execFile);
const BAD_SEGMENT = /[<>:"\\|?*]|[. ]$|^(?:con|prn|aux|nul|com[0-9¹²³]|lpt[0-9¹²³])(?:\.|$)/i;

function checkedParts(path: string): string[] {
  const parts = path.split("/");
  if (
    parts.some(
      (part) =>
        !part || BAD_SEGMENT.test(part) || Array.from(part).some((char) => char.charCodeAt(0) < 32),
    )
  )
    throw new Error(PACKAGE_BAD_PATH);
  return parts;
}

function checkSize(bytes: number, entries: number): void {
  if (bytes > PACKAGE_SIZE_LIMIT || entries > PACKAGE_ENTRY_LIMIT)
    throw new Error(PACKAGE_TOO_LARGE);
}

function snapshotDirectory(source: string, destination: string): void {
  let total = 0;
  let entries = 0;
  cpSync(source, destination, {
    recursive: true,
    filter: (path) => {
      if (path === source) return true;
      if (PACKAGE_IGNORED.test(basename(path))) return false;
      checkedParts(
        relative(source, path)
          .split(process.platform === "win32" ? "\\" : "/")
          .join("/"),
      );
      const stat = lstatSync(path);
      if (!stat.isDirectory() && !stat.isFile()) throw new Error(PACKAGE_BAD_PATH);
      if (stat.isFile()) total += stat.size;
      checkSize(total, ++entries);
      return true;
    },
  });
}

async function extractZip(path: string, destination: string): Promise<void> {
  checkSize(statSync(path).size, 0);
  const zip = await openPromise(path, {
    lazyEntries: true,
    autoClose: false,
    strictFileNames: true,
    validateEntrySizes: true,
  });
  let total = 0;
  const names = new Set<string>();
  try {
    checkSize(0, zip.entryCount);
    for await (const entry of zip.eachEntry()) {
      const isDirectory = entry.fileName.endsWith("/");
      const name = isDirectory ? entry.fileName.slice(0, -1) : entry.fileName;
      const parts = checkedParts(name);
      if (parts.some((part) => PACKAGE_IGNORED.test(part))) continue;
      const attributes = entry.externalFileAttributes >>> 16;
      const mode = attributes & 0o170000;
      if (mode && mode !== (isDirectory ? 0o040000 : 0o100000)) throw new Error(PACKAGE_BAD_PATH);
      if (names.has(name.toLowerCase())) throw new Error(PACKAGE_BAD_PATH);
      names.add(name.toLowerCase());
      total += entry.uncompressedSize;
      checkSize(total, names.size);
      const target = join(destination, ...parts);
      if (isDirectory) mkdirSync(target, { recursive: true });
      else {
        mkdirSync(dirname(target), { recursive: true });
        await pipeline(
          await zip.openReadStreamPromise(entry),
          createWriteStream(target, { flags: "wx", mode: attributes & 0o111 ? 0o755 : 0o644 }),
        );
      }
    }
  } finally {
    const closed = once(zip, "close");
    zip.close();
    await closed;
  }
}

function gitLocation(input: string): string {
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

async function archiveGit(location: string, temp: string, archive: string): Promise<string> {
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
  await git(
    "git",
    [
      "clone",
      "--no-checkout",
      "--no-recurse-submodules",
      "--no-tags",
      "--depth=1",
      "--template=",
      "--",
      location,
      repo,
    ],
    options,
  );
  const { stdout } = await git("git", ["-C", repo, "rev-parse", "HEAD"], options);
  await git("git", ["-C", repo, "archive", "--format=zip", "--output=" + archive, "HEAD"], options);
  return stdout.trim();
}

export async function withPluginSource<T>(
  source: PluginPackageSource,
  visit: (root: string, origin: PluginPackageSource, revision?: string) => T | Promise<T>,
): Promise<T> {
  const tempRoot = realpathSync.native(tmpdir());
  const temp = mkdtempSync(join(tempRoot, "pilot-plugin-"));
  try {
    const root = join(temp, "package");
    let location: string;
    let revision: string | undefined;
    try {
      if (source.kind === "directory") {
        if (!isAbsolute(source.location)) throw new Error(PACKAGE_UNREADABLE);
        const original = directory(source.location);
        if (!original) throw new Error(PACKAGE_UNREADABLE);
        location = original;
        snapshotDirectory(original, root);
      } else {
        mkdirSync(root);
        if (source.kind === "git") {
          location = gitLocation(source.location);
          const archive = join(temp, "source.zip");
          revision = await archiveGit(location, temp, archive);
          await extractZip(archive, root);
        } else {
          if (!isAbsolute(source.location) || !/\.zip$/i.test(source.location))
            throw new Error(PACKAGE_UNREADABLE);
          location = realpathSync.native(source.location);
          if (!statSync(location).isFile()) throw new Error(PACKAGE_UNREADABLE);
          await extractZip(location, root);
        }
      }
    } catch (error) {
      if (
        error instanceof Error &&
        [PACKAGE_BAD_PATH, PACKAGE_TOO_LARGE, PACKAGE_UNREADABLE].includes(error.message)
      )
        throw error;
      throw new Error(PACKAGE_UNREADABLE, { cause: error });
    }
    return await visit(root, { kind: source.kind, location }, revision);
  } finally {
    await rm(temp, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
}
