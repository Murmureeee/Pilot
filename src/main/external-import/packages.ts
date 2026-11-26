// @env node
import { randomUUID } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
} from "node:fs";
import { basename, dirname, isAbsolute, join, relative, sep } from "node:path";

import type {
  PluginPackageChange,
  PluginPackagePreview,
  PluginPackageSource,
} from "@shared/imports";

import { parseSkillMarkdown } from "../agent-host/skills";
import { encryptSecret } from "../settings/secrets";
import type { ImportedPlugin, McpServerConfig, Settings } from "../settings/types";
import { copyImportedDirectory, fingerprint, within } from "./files";
import { normalizeImportedMcp } from "./mcp";
import {
  PACKAGE_BAD_PATH,
  PACKAGE_CHANGED,
  PACKAGE_CONTENT_ID,
  PACKAGE_EMPTY,
  PACKAGE_EXCERPT_BYTES,
  PACKAGE_EXCERPT_LIMIT,
  PACKAGE_NOT_FOUND,
  PACKAGE_OLD_FILES_BUSY,
  PACKAGE_SAVE_FAILED,
  PACKAGE_SCRIPT,
} from "./package-constants";
import { readPackageManifest } from "./package-manifest";
import { withPluginSource } from "./package-source";
import { object } from "./sources";
import type {
  ImportLocations,
  PackageManifest,
  PackageServer,
  WithPluginServersClosed,
} from "./types";

const reviewSecret = randomUUID();

function packageId(origin: PluginPackageSource): string {
  const location =
    process.platform === "win32" && origin.kind !== "git"
      ? origin.location.toLowerCase()
      : origin.location;
  return fingerprint("package", origin.kind, location);
}

function assets(locations: ImportLocations, id: string): string {
  return join(locations.settingsDir, "imported-plugins", id);
}

function data(locations: ImportLocations, id: string): string {
  return join(locations.settingsDir, "imported-plugin-data", id);
}

function excerpt(root: string, path: string): string | undefined {
  if ((!/\.md$/i.test(path) && !PACKAGE_SCRIPT.test(path)) || /\.(?:json|toml|ya?ml)$/i.test(path))
    return;
  try {
    const file = join(root, ...path.split("/"));
    if (!within(root, file) || !within(root, realpathSync(file))) return;
    const stat = lstatSync(file);
    if (!stat.isFile() || stat.size > PACKAGE_EXCERPT_BYTES) return;
    const buffer = readFileSync(file);
    if (!buffer.includes(0)) return buffer.toString("utf8");
  } catch {
    return undefined;
  }
}

function packageChanges(
  manifest: PackageManifest,
  previous: NonNullable<ImportedPlugin["managed"]>,
  locations: ImportLocations,
): PluginPackageChange[] {
  const old = new Map(previous.files.map(({ path, digest }) => [path, digest]));
  const next = new Map(manifest.files.map(({ path, digest }) => [path, digest]));
  let excerpts = 0;
  return [...new Set([...old.keys(), ...next.keys()])].sort().flatMap((path) => {
    const before = old.get(path);
    const after = next.get(path);
    if (before === after) return [];
    const row: PluginPackageChange = {
      path,
      kind: before === undefined ? "added" : after === undefined ? "removed" : "modified",
    };
    if (excerpts < PACKAGE_EXCERPT_LIMIT && PACKAGE_CONTENT_ID.test(previous.contentId)) {
      row.before =
        before === undefined ? undefined : excerpt(assets(locations, previous.contentId), path);
      row.after = after === undefined ? undefined : excerpt(manifest.root, path);
      if (row.before !== undefined || row.after !== undefined) excerpts++;
    }
    return [row];
  });
}

function planServers(
  manifest: PackageManifest,
  id: string,
  contentId: string,
  locations: ImportLocations,
): { servers: PackageServer[]; preview: PluginPackagePreview["servers"]; unsupported: string[] } {
  const servers: PackageServer[] = [];
  const preview: PluginPackagePreview["servers"] = [];
  const unsupported: string[] = [];
  for (const [name, definition] of Object.entries(manifest.servers)) {
    const raw = object(definition);
    const connection = normalizeImportedMcp(definition, {
      source: manifest.format === "claude-code" ? "claude-code" : "codex",
      plugin: {
        original: manifest.root,
        installed: assets(locations, contentId),
        data: data(locations, id),
      },
    });
    if (
      typeof connection === "string" ||
      raw.headersHelper ||
      raw.oauth ||
      raw.auth === "chatgpt"
    ) {
      unsupported.push("MCP " + name);
      continue;
    }
    const { transport } = connection;
    if (transport.type === "stdio") {
      const command = String(raw.command);
      const declaredArgs = Array.isArray(raw.args) ? raw.args.map(String) : [];
      if ([command, ...declaredArgs].some((argument) => argument.includes("\0"))) {
        unsupported.push("MCP " + name);
        continue;
      }
      const secrets = (connection.env ?? []).map(([, value]) => value).filter(Boolean);
      const hide = (argument: string): string =>
        secrets.reduce(
          (text, value) =>
            value.length > 3 || text === value ? text.replaceAll(value, "••••") : text,
          argument,
        );
      const credential =
        /^--?(?:api[-_]?key|(?:access[-_]?)?token|password|secret|authorization)(?:=|$)/i;
      const args = declaredArgs.map((argument, index) => {
        if (
          index > 0 &&
          credential.test(declaredArgs[index - 1]) &&
          !declaredArgs[index - 1].includes("=")
        )
          return "••••";
        if (credential.test(argument) && argument.includes("="))
          return argument.split("=")[0] + "=••••";
        if (URL.parse(argument)?.password) return "••••";
        return hide(argument);
      });
      preview.push({ name, command: hide(command), args });
    } else {
      preview.push({ name, command: URL.parse(transport.url)?.origin ?? "HTTP", args: [] });
    }
    servers.push({ name, connection });
  }
  return { servers, preview, unsupported };
}

function prepare(
  root: string,
  source: PluginPackageSource,
  revision: string | undefined,
  settings: Settings,
  locations: ImportLocations,
  replacing?: string,
): {
  manifest: PackageManifest;
  servers: PackageServer[];
  preview: PluginPackagePreview;
  id: string;
  contentId: string;
  previous?: ImportedPlugin;
} {
  const label =
    source.location.replaceAll("\\", "/").replace(/\/$/, "").split(/[/:]/).at(-1) ?? "plugin";
  const manifest = readPackageManifest(root, label.replace(/\.(git|zip)$/i, ""), {
    ...locations,
    workspace: undefined,
  });
  const id = packageId(source);
  if (replacing && replacing !== id) throw new Error(PACKAGE_CHANGED);
  const previous = settings.importedPlugins?.find((entry) => entry.id === id);
  if (replacing && !previous?.managed) throw new Error(PACKAGE_NOT_FOUND);
  const contentId = fingerprint(id, revision ?? "", JSON.stringify(manifest.files));
  const {
    servers,
    preview: commands,
    unsupported,
  } = planServers(manifest, id, contentId, locations);
  const current = previous?.managed?.contentId === contentId;
  return {
    id,
    manifest,
    contentId,
    previous,
    servers,
    preview: {
      token: fingerprint(reviewSecret, id, contentId, previous?.managed?.contentId ?? ""),
      name: manifest.name,
      version: manifest.version,
      format: manifest.format,
      source,
      revision,
      skills: manifest.skillPaths.map(
        (path) =>
          parseSkillMarkdown(basename(path), readFileSync(join(path, "SKILL.md"), "utf8")).name,
      ),
      templates: manifest.templates,
      scripts: manifest.scripts,
      servers: commands,
      unsupported: [...manifest.unsupported, ...unsupported],
      previous: previous?.managed && {
        version: previous.version,
        revision: previous.managed.revision,
        changes: current ? [] : packageChanges(manifest, previous.managed, locations),
      },
      current,
    },
  };
}

function sourceFor(settings: Settings, source: PluginPackageSource | string): PluginPackageSource {
  if (typeof source !== "string") return source;
  const original = settings.importedPlugins?.find(({ id }) => id === source)?.managed?.source;
  if (!original) throw new Error(PACKAGE_NOT_FOUND);
  return original;
}

export function previewPluginPackage(
  source: PluginPackageSource | string,
  settings: Settings,
  locations: ImportLocations,
): Promise<PluginPackagePreview> {
  return withPluginSource(
    sourceFor(settings, source),
    (root, origin, revision) =>
      prepare(
        root,
        origin,
        revision,
        settings,
        locations,
        typeof source === "string" ? source : undefined,
      ).preview,
  );
}

function detachedSettings(settings: Settings, plugin: ImportedPlugin): Settings {
  const others = (settings.importedPlugins ?? []).filter(({ id }) => id !== plugin.id);
  const retainedSkills = new Set(others.flatMap(({ skillIds }) => skillIds));
  const retainedServers = new Set(others.flatMap(({ serverIds }) => serverIds));
  return {
    ...settings,
    importedPlugins: others,
    skillsEnabled: settings.skillsEnabled?.filter(
      (id) => !plugin.skillIds.includes(id) || retainedSkills.has(id),
    ),
    mcpServers: settings.mcpServers?.filter(
      ({ id }) => !plugin.serverIds.includes(id) || retainedServers.has(id),
    ),
  };
}

function ownedDirectory(parent: string, name: string): string | undefined {
  if (!name || isAbsolute(name) || name === "." || name === ".." || /[\\/:]/.test(name)) return;
  const target = join(parent, name);
  const stat = lstatSync(target, { throwIfNoEntry: false });
  if (!stat?.isDirectory()) return;
  if (relative(realpathSync.native(parent), dirname(realpathSync.native(target))) !== "")
    throw new Error(PACKAGE_BAD_PATH);
  return target;
}

function retiredPaths(
  plugin: ImportedPlugin,
  next: Settings,
  locations: ImportLocations,
  removing: boolean,
): string[] {
  const keepSkills = new Set(next.importedPlugins?.flatMap(({ skillIds }) => skillIds));
  const result = plugin.skillIds
    .filter((name) => !keepSkills.has(name))
    .flatMap((name) => ownedDirectory(locations.skillsDir, name) ?? []);
  const id = plugin.managed?.contentId ?? plugin.id;
  if (PACKAGE_CONTENT_ID.test(id)) {
    const parent = dirname(assets(locations, id));
    const path = ownedDirectory(parent, id);
    if (path) result.push(path);
  }
  if (removing && PACKAGE_CONTENT_ID.test(plugin.id)) {
    const path = ownedDirectory(dirname(data(locations, plugin.id)), plugin.id);
    if (path) result.push(path);
  }
  return result;
}

function writeWithRetirement(paths: string[], save: () => void): void {
  const moved: { source: string; target: string; stage: string }[] = [];
  try {
    for (const source of new Set(paths)) {
      const stage = mkdtempSync(join(dirname(source), ".retire-"));
      const target = join(stage, "package");
      try {
        renameSync(source, target);
        moved.push({ source, target, stage });
      } catch (cause) {
        rmSync(stage, { force: true, recursive: true });
        throw new Error(PACKAGE_OLD_FILES_BUSY, { cause });
      }
    }
    try {
      save();
    } catch (cause) {
      throw new Error(PACKAGE_SAVE_FAILED, { cause });
    }
  } catch (error) {
    for (const { source, target, stage } of moved.reverse()) {
      renameSync(target, source);
      rmSync(stage, { recursive: true, force: true });
    }
    throw error;
  }
  for (const { stage } of moved) {
    try {
      rmSync(stage, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      // The retired directory is no longer visible to the skill library or any MCP configuration.
    }
  }
}

export async function installPluginPackage(
  source: PluginPackageSource | string,
  token: string,
  locations: ImportLocations,
  readSettings: () => Settings,
  saveSettings: (settings: Settings) => void,
  withServersClosed: WithPluginServersClosed,
): Promise<void> {
  return withPluginSource(sourceFor(readSettings(), source), async (root, origin, revision) => {
    const replacing = typeof source === "string" ? source : undefined;
    const reviewed = prepare(root, origin, revision, readSettings(), locations, replacing);
    if (token !== reviewed.preview.token || reviewed.preview.current)
      throw new Error(PACKAGE_CHANGED);
    const commit = (): void => {
      const current = readSettings();
      const { manifest, servers, preview, id, contentId } = reviewed;
      const previous = current.importedPlugins?.find((entry) => entry.id === id);
      if (previous?.managed?.contentId !== reviewed.previous?.managed?.contentId)
        throw new Error(PACKAGE_CHANGED);
      if (!manifest.skillPaths.length && !manifest.templates.length && !servers.length)
        throw new Error(PACKAGE_EMPTY);
      const target = assets(locations, contentId);
      const connections: McpServerConfig[] = servers.map(({ name, connection }) => ({
        id: randomUUID(),
        name: manifest.name + " / " + name,
        enabled: false,
        policy: "confirm",
        transport:
          connection.transport.type === "http"
            ? { type: "http", url: "" }
            : { type: "stdio", command: "", args: [] },
        encryptedImport: encryptSecret(JSON.stringify(connection)),
        importKey: fingerprint(contentId, name),
      }));
      const skillIds = manifest.skillPaths.map((path) => {
        const name =
          basename(path)
            .replace(/[^\p{L}\p{N}_.-]+/gu, "-")
            .replace(/^\.+/, "")
            .slice(0, 35) || "skill";
        return (
          name + "-" + fingerprint(contentId, relative(manifest.root, path).split(sep).join("/"))
        );
      });
      const next = previous ? detachedSettings(current, previous) : { ...current };
      next.importedPlugins = [
        ...(next.importedPlugins ?? []),
        {
          id,
          name: manifest.name,
          source: manifest.format,
          version: manifest.version,
          partial: preview.unsupported.length > 0,
          skillIds,
          serverIds: connections.map((server) => server.id),
          managed: {
            source: origin,
            revision,
            contentId,
            files: manifest.files,
            enabled: false,
            templates: manifest.templates.map(({ name, text }) => ({ name, text })),
          },
        },
      ];
      next.mcpServers = [...(next.mcpServers ?? []), ...connections];
      const created: string[] = [];
      try {
        copyImportedDirectory(manifest.root, target, manifest.configFiles);
        created.push(target);
        for (const [index, path] of manifest.skillPaths.entries()) {
          const destination = join(locations.skillsDir, skillIds[index]);
          copyImportedDirectory(path, destination, manifest.configFiles);
          created.push(destination);
        }
        const workingData = data(locations, id);
        if (!existsSync(workingData)) {
          mkdirSync(workingData, { recursive: true });
          created.push(workingData);
        }
        writeWithRetirement(previous ? retiredPaths(previous, next, locations, false) : [], () =>
          saveSettings(next),
        );
      } catch (error) {
        for (const path of created.reverse())
          rmSync(path, { recursive: true, force: true, maxRetries: 3 });
        throw error;
      }
    };
    if (reviewed.previous) await withServersClosed(reviewed.previous.serverIds, commit);
    else commit();
  });
}

export function uninstallPluginPackage(
  id: string,
  locations: ImportLocations,
  settings: Settings,
  saveSettings: (settings: Settings) => void,
): void {
  const plugin = settings.importedPlugins?.find((entry) => entry.id === id);
  if (!plugin) throw new Error(PACKAGE_NOT_FOUND);
  const next = detachedSettings(settings, plugin);
  writeWithRetirement(retiredPaths(plugin, next, locations, true), () => saveSettings(next));
}
