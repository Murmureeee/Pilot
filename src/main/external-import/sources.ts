// @env node
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, isAbsolute, join } from "node:path";
import { parse } from "smol-toml";
import type { ImportIssue, ImportSource } from "@shared/imports";
import { childDirectories, directory, localPluginPath, within } from "./files";
import type { ConfigObject, DiscoveredImport, ImportLocations, SourcePlugin } from "./types";

export function object(value: unknown): ConfigObject {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as ConfigObject) : {};
}

function readConfig(
  path: string,
  issues: ImportIssue[],
  parseConfig: (text: string) => unknown = JSON.parse,
): ConfigObject {
  if (!existsSync(path)) return {};
  try {
    return object(parseConfig(readFileSync(path, "utf8").replace(/^\ufeff/, "")));
  } catch {
    issues.push({ name: basename(path), reason: "read" });
    return {};
  }
}

function projectDirectories(workspace?: string): string[] {
  if (!workspace) return [];
  const roots = [workspace];
  while (!existsSync(join(roots[0], ".git"))) {
    const parent = dirname(roots[0]);
    if (parent === roots[0]) return [workspace];
    roots.unshift(parent);
  }
  return roots;
}

function skillDirectories(root: string): string[] {
  if (existsSync(join(root, "SKILL.md"))) return [root];
  return childDirectories(root).filter((path) => existsSync(join(path, "SKILL.md")));
}

function takePreferredVersion(root: string): string | undefined {
  return childDirectories(root).sort((a, b) =>
    basename(b).localeCompare(basename(a), undefined, { numeric: true }),
  )[0];
}

function asEntries(value: unknown): unknown[] {
  return Array.isArray(value) ? value : value === undefined ? [] : [value];
}

function readPlugin(
  source: ImportSource,
  root: string,
  key: string,
  locations: ImportLocations,
  issues: ImportIssue[],
  overrides?: ConfigObject,
): SourcePlugin {
  const configFiles = new Set<string>();
  const read = (candidate: string): ConfigObject => {
    const path = localPluginPath(root, candidate);
    if (!path || path === root) return {};
    configFiles.add(path);
    return readConfig(path, issues);
  };
  const portable = source === "codex" ? read("plugin.json") : {};
  const hasPortableManifest = typeof portable.name === "string";
  const overlay = object(object(portable.extensions)["com.openai"]);
  const legacy =
    source === "claude-code" || !hasPortableManifest || !Object.keys(overlay).length
      ? read(source === "codex" ? ".codex-plugin/plugin.json" : ".claude-plugin/plugin.json")
      : {};
  const manifest = hasPortableManifest ? { ...legacy, ...portable, ...overlay } : legacy;
  const pluginName = key.split("@")[0];
  const displayName = object(manifest.interface).displayName;
  const name =
    typeof displayName === "string"
      ? displayName
      : typeof manifest.name === "string"
        ? manifest.name
        : pluginName;
  const version = typeof manifest.version === "string" ? manifest.version : undefined;
  const skills = new Set<string>();
  for (const value of ["skills", ...asEntries(manifest.skills)]) {
    const folder = typeof value === "string" && localPluginPath(root, value);
    if (folder) {
      for (const candidate of skillDirectories(folder)) {
        const target = directory(candidate);
        if (target && within(root, target)) skills.add(target);
      }
    }
  }
  if (!skills.size && source === "claude-code" && existsSync(join(root, "SKILL.md")))
    skills.add(root);

  const standardMcp = read(hasPortableManifest ? "mcp.json" : ".mcp.json");
  const servers: ConfigObject = Object.assign(
    Object.create(null),
    object(standardMcp.mcpServers ?? standardMcp),
  );
  for (const value of asEntries(manifest.mcpServers)) {
    if (typeof value === "string" && value.toLowerCase().endsWith(".json")) {
      if (!localPluginPath(root, value)) {
        issues.push({ name, reason: "read" });
        continue;
      }
      const declared = read(value);
      Object.assign(servers, object(declared.mcpServers ?? declared));
    } else if (value && typeof value === "object") {
      const declared = object(value);
      Object.assign(servers, object(declared.mcpServers ?? declared));
    } else {
      issues.push({ name, reason: "native" });
    }
  }
  for (const [serverName, value] of Object.entries(servers)) {
    const options = object(overrides?.[serverName]);
    const { enabled_tools, disabled_tools } = options;
    if (enabled_tools !== undefined || disabled_tools !== undefined) {
      servers[serverName] = { ...object(value), enabled_tools, disabled_tools };
    }
  }

  const partial =
    [
      "apps",
      "hooks",
      "agents",
      "commands",
      "lspServers",
      "outputStyles",
      "workflows",
      "themes",
      "monitors",
    ].some((feature) => manifest[feature] !== undefined) ||
    [
      ".app.json",
      "hooks/hooks.json",
      "commands",
      "agents",
      ".lsp.json",
      "workflows",
      "themes",
    ].some((component) => existsSync(join(root, component)));
  return {
    key,
    name,
    version,
    directory: root,
    workspace: locations.workspace,
    skills: [...skills],
    servers,
    configFiles,
    partial,
  };
}

function addServers(
  servers: DiscoveredImport["servers"],
  config: unknown,
  workspace?: string,
  inherit = false,
): void {
  for (const [name, definition] of Object.entries(object(config))) {
    const old = servers.get(name);
    const overrides = object(definition);
    const effective =
      inherit && old && !Object.hasOwn(overrides, "command") && !Object.hasOwn(overrides, "url")
        ? { ...object(old.definition), ...overrides }
        : definition;
    servers.set(name, { definition: effective, workspace });
  }
}

function discoverCodex(locations: ImportLocations, found: DiscoveredImport): void {
  const roots = projectDirectories(locations.workspace);
  found.skills.push(
    ...skillDirectories(join(locations.home, ".agents", "skills")),
    ...skillDirectories(join(locations.codexHome, "skills")),
  );
  const pluginConfig = new Map<string, unknown>();
  for (const root of [locations.codexHome, ...roots.map((path) => join(path, ".codex"))]) {
    const workspace = root === locations.codexHome ? undefined : dirname(root);
    const config = readConfig(join(root, "config.toml"), found.issues, parse);
    addServers(found.servers, config.mcp_servers, workspace, true);
    for (const [id, entry] of Object.entries(object(config.plugins))) pluginConfig.set(id, entry);
    if (workspace) {
      found.skills.push(
        ...skillDirectories(join(workspace, ".agents", "skills")),
        ...skillDirectories(join(root, "skills")),
      );
    }
  }
  const cache = join(locations.codexHome, "plugins", "cache");
  for (const market of childDirectories(cache)) {
    for (const plugin of childDirectories(market)) {
      const key = `${basename(plugin)}@${basename(market)}`;
      if (pluginConfig.size && !pluginConfig.has(key)) continue;
      const version = takePreferredVersion(plugin);
      const target = version && directory(version);
      if (
        target &&
        (existsSync(join(target, "plugin.json")) ||
          existsSync(join(target, ".codex-plugin", "plugin.json")))
      ) {
        const overrides = object(object(pluginConfig.get(key)).mcp_servers);
        found.plugins.push(readPlugin("codex", target, key, locations, found.issues, overrides));
      }
    }
  }
}

function claudePluginRoot(
  locations: ImportLocations,
  key: string,
  installRecord: ConfigObject,
  marketplaces: ConfigObject,
  issues: ImportIssue[],
): string | undefined {
  const installPath = installRecord.installPath;
  const installed =
    typeof installPath === "string" && isAbsolute(installPath) && directory(installPath);
  if (installed) return installed;

  const [plugin, marketplace] = key.split("@");
  if (
    !plugin ||
    !marketplace ||
    ![plugin, marketplace].every((part) => /^[\w.-]+$/.test(part) && !part.startsWith("."))
  )
    return undefined;
  const known = object(marketplaces[marketplace]);
  const source = object(known.source);
  const local =
    source.source === "directory" && typeof source.path === "string" && isAbsolute(source.path)
      ? directory(source.path)
      : undefined;
  if (local) {
    const catalog = readConfig(join(local, ".claude-plugin", "marketplace.json"), issues);
    const entry = asEntries(catalog.plugins)
      .map(object)
      .find((item) => item.name === plugin);
    if (typeof entry?.source === "string") {
      const path = localPluginPath(local, entry.source);
      if (path) return directory(path);
    }
  }
  const cache = takePreferredVersion(
    join(locations.claudeHome, "plugins", "cache", marketplace, plugin),
  );
  return cache ? directory(cache) : undefined;
}

function discoverClaude(locations: ImportLocations, found: DiscoveredImport): void {
  const roots = projectDirectories(locations.workspace);
  found.skills.push(...skillDirectories(join(locations.claudeHome, "skills")));
  const config = readConfig(locations.claudeConfig, found.issues);
  addServers(found.servers, config.mcpServers);
  const projectConfigs = Object.entries(object(config.projects));
  for (const root of roots) {
    found.skills.push(...skillDirectories(join(root, ".claude", "skills")));
    addServers(found.servers, readConfig(join(root, ".mcp.json"), found.issues).mcpServers, root);
    const match = projectConfigs.find(([path]) => isAbsolute(path) && directory(path) === root);
    addServers(found.servers, object(match?.[1]).mcpServers, root);
  }
  const pluginsDir = join(locations.claudeHome, "plugins");
  const registry = readConfig(join(pluginsDir, "installed_plugins.json"), found.issues);
  const marketplaces = readConfig(join(pluginsDir, "known_marketplaces.json"), found.issues);
  const installed = new Map(Object.entries(object(registry.plugins)));
  for (const path of [
    join(locations.claudeHome, "settings.json"),
    ...roots.flatMap((root) => [
      join(root, ".claude", "settings.json"),
      join(root, ".claude", "settings.local.json"),
    ]),
  ]) {
    const preferences = readConfig(path, found.issues);
    for (const key of Object.keys(object(preferences.enabledPlugins))) {
      if (!installed.has(key)) installed.set(key, {});
    }
  }
  for (const [key, entries] of installed) {
    const scopes = asEntries(entries)
      .map(object)
      .filter((entry) => {
        if (entry.scope !== "local" && entry.scope !== "project") return true;
        return (
          typeof entry.projectPath === "string" &&
          isAbsolute(entry.projectPath) &&
          roots.includes(directory(entry.projectPath) ?? "")
        );
      });
    if (!scopes.length) continue;
    const install =
      scopes.find((entry) => entry.scope === "local") ??
      scopes.find((entry) => entry.scope === "project") ??
      scopes[0];
    const root = claudePluginRoot(locations, key, install, marketplaces, found.issues);
    if (root) found.plugins.push(readPlugin("claude-code", root, key, locations, found.issues));
    else found.issues.push({ name: key, reason: "read" });
  }
}

export function discoverImport(source: ImportSource, locations: ImportLocations): DiscoveredImport {
  const found: DiscoveredImport = { skills: [], servers: new Map(), plugins: [], issues: [] };
  if (source === "codex") discoverCodex(locations, found);
  else discoverClaude(locations, found);
  return found;
}
