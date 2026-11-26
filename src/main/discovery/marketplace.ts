// @env node
import type {
  MarketplaceEntry,
  PluginMarketplace,
  PluginMarketplaceSource,
} from "@shared/discovery";
import type { GitPluginSource } from "@shared/imports";

import {
  githubRepository,
  normalizeGitLocation,
  openPluginGit,
  withPluginTemporaryDirectory,
} from "../external-import/git-source";
import { object } from "../external-import/sources";
import { gitPluginSourceSchema } from "../settings/schema";
import type { Settings } from "../settings/types";
import {
  MARKETPLACE_FILE,
  MARKETPLACE_INVALID,
  MARKETPLACE_LIMIT,
  MARKETPLACE_LIST_FULL,
  MARKETPLACE_UNAVAILABLE,
  OFFICIAL_MARKETPLACE,
} from "./constants";

function text(value: unknown, limit = 200): string | undefined {
  return typeof value === "string" ? value.trim().slice(0, limit) || undefined : undefined;
}

function relativePluginPath(value: string): string {
  return value.replace(/^\.\//, "").replace(/\/+$/, "");
}

function candidateSource(
  raw: unknown,
  marketplace: string,
  pluginRoot?: string,
): { source?: GitPluginSource; sourceType: string } {
  if (typeof raw === "string") {
    const sourceType = "市场仓库内目录";
    const path =
      raw === "." || raw === "./"
        ? undefined
        : raw.startsWith("./")
          ? relativePluginPath(raw)
          : pluginRoot && !raw.includes("/")
            ? relativePluginPath(pluginRoot) + "/" + raw
            : null;
    if (path === null) return { sourceType };
    const parsed = gitPluginSourceSchema.safeParse({ kind: "git", location: marketplace, path });
    return { source: parsed.data, sourceType };
  }
  const entry = object(raw);
  const sourceType = text(entry.source) ?? "未知来源";
  if (!["github", "url", "git-subdir"].includes(sourceType)) return { sourceType };
  const url = sourceType === "github" ? undefined : text(entry.url, 8192);
  const shorthand =
    sourceType === "github" ? text(entry.repo) : sourceType === "git-subdir" ? url : undefined;
  const address = (shorthand && githubRepository(shorthand)) || url;
  const parsedUrl = address && URL.parse(address);
  if (
    !parsedUrl ||
    parsedUrl.protocol !== "https:" ||
    parsedUrl.username ||
    parsedUrl.password ||
    parsedUrl.hash ||
    parsedUrl.search
  )
    return { sourceType };
  const path =
    sourceType === "git-subdir" && typeof entry.path === "string"
      ? relativePluginPath(entry.path)
      : undefined;
  if (sourceType === "git-subdir" && !path) return { sourceType };
  const parsed = gitPluginSourceSchema.safeParse({
    kind: "git",
    location: parsedUrl.href,
    path,
    ref: entry.ref,
    sha: entry.sha,
  });
  return { source: parsed.data, sourceType };
}

function parseMarketplace(contents: string, location: string): PluginMarketplace {
  try {
    const record = object(JSON.parse(contents.replace(/^\ufeff/, "")));
    const name = text(record.name);
    const owner = text(object(record.owner).name);
    const root = text(object(record.metadata).pluginRoot, 2048);
    if (!name || !owner || !Array.isArray(record.plugins)) throw new Error(MARKETPLACE_INVALID);
    const entries = new Map<string, MarketplaceEntry>();
    for (const value of record.plugins) {
      const plugin = object(value);
      const key = text(plugin.name);
      if (!key || entries.has(key)) continue;
      const source = candidateSource(plugin.source, location, root);
      entries.set(key, {
        key,
        name: text(plugin.displayName) ?? key,
        description: text(plugin.description, 1500),
        author: text(object(plugin.author).name) ?? owner,
        version: text(plugin.version),
        ...source,
      });
    }
    return { location, name, entries: [...entries.values()] };
  } catch (cause) {
    throw new Error(MARKETPLACE_INVALID, { cause });
  }
}

export function listPluginMarketplaces(settings: Settings): PluginMarketplaceSource[] {
  return [OFFICIAL_MARKETPLACE, ...(settings.pluginMarketplaces ?? [])];
}

export async function browsePluginMarketplace(input: string): Promise<PluginMarketplace> {
  let location: string;
  let contents: string;
  try {
    location = normalizeGitLocation(githubRepository(input) ?? input);
    if (
      location
        .replace(/\/$/, "")
        .replace(/\.git$/i, "")
        .toLowerCase() === OFFICIAL_MARKETPLACE.location.replace(/\.git$/, "")
    )
      location = OFFICIAL_MARKETPLACE.location;
    contents = await withPluginTemporaryDirectory(async (temp) => {
      const repo = await openPluginGit(temp, { kind: "git", location }, true);
      try {
        return await repo.read(["show", repo.revision + ":" + MARKETPLACE_FILE]);
      } catch (cause) {
        throw new Error(MARKETPLACE_INVALID, { cause });
      }
    });
  } catch (cause) {
    if (cause instanceof Error && cause.message === MARKETPLACE_INVALID) throw cause;
    throw new Error(MARKETPLACE_UNAVAILABLE, { cause });
  }
  return parseMarketplace(contents, location);
}

export function rememberMarketplace(
  settings: Settings,
  { location, name }: PluginMarketplace,
): Settings {
  const sources = settings.pluginMarketplaces ?? [];
  if (location === OFFICIAL_MARKETPLACE.location) return settings;
  const existing = sources.find((source) => source.location === location);
  if (existing?.name === name) return settings;
  if (!existing && sources.length >= MARKETPLACE_LIMIT) throw new Error(MARKETPLACE_LIST_FULL);
  const next = { location, name };
  return {
    ...settings,
    pluginMarketplaces: existing
      ? sources.map((source) => (source === existing ? next : source))
      : [...sources, next],
  };
}
