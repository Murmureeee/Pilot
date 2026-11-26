// @env node
import { randomUUID } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";

import type {
  ExternalImportKind,
  ExternalImportPreview,
  ImportedPluginInfo,
  ImportReport,
} from "@shared/imports";

import { encryptSecret } from "../settings/secrets";
import type { McpServerConfig, Settings } from "../settings/types";
import { collectImportCatalog } from "./catalog";
import { copyImportedDirectory } from "./files";
import type { ImportLocations, ServerImport, SkillImport } from "./types";

export function importedPlugins(settings: Settings, skillsDir: string): ImportedPluginInfo[] {
  const enabledSkills = new Set(settings.skillsEnabled);
  const servers = new Map(settings.mcpServers?.map((server) => [server.id, server]));
  return (settings.importedPlugins ?? []).flatMap(({ skillIds, serverIds, managed, ...plugin }) => {
    const skills = skillIds.filter((id) => existsSync(join(skillsDir, id, "SKILL.md")));
    const members = serverIds.flatMap((id) => servers.get(id) ?? []);
    const templates = managed?.templates.length ?? 0;
    if (!managed && skills.length === 0 && members.length === 0) return [];
    const enabled =
      skills.filter((id) => enabledSkills.has(id)).length +
      members.filter((server) => server.enabled).length +
      (managed?.enabled ? templates : 0);
    return [
      {
        ...plugin,
        skills: skills.length,
        servers: members.length,
        ...(managed
          ? { templates, packageSource: managed.source, revision: managed.revision }
          : {}),
        enabled:
          enabled === 0
            ? "none"
            : enabled === skills.length + members.length + templates
              ? "all"
              : "some",
      },
    ];
  });
}

export function toggleImportedPlugin(settings: Settings, id: string, enabled: boolean): Settings {
  const plugin = settings.importedPlugins?.find((value) => value.id === id);
  if (!plugin) return settings;
  const skills = new Set(settings.skillsEnabled);
  for (const skill of plugin.skillIds) {
    if (enabled) skills.add(skill);
    else skills.delete(skill);
  }
  const members = new Set(plugin.serverIds);
  return {
    ...settings,
    skillsEnabled: [...skills],
    importedPlugins: settings.importedPlugins?.map((entry) =>
      entry === plugin && entry.managed
        ? { ...entry, managed: { ...entry.managed, enabled } }
        : entry,
    ),
    mcpServers: settings.mcpServers?.map((server) =>
      members.has(server.id) ? { ...server, enabled } : server,
    ),
  };
}

export function previewExternalImport(
  kind: ExternalImportKind,
  settings: Settings,
  locations: ImportLocations,
): ExternalImportPreview {
  return {
    groups: collectImportCatalog(kind, settings, locations).map(
      ({ source, candidates, issues }) => ({
        source,
        items: candidates.map(({ item }) => item),
        issues,
      }),
    ),
  };
}

export function importExternal(
  kind: ExternalImportKind,
  selectedIds: readonly string[],
  settings: Settings,
  locations: ImportLocations,
): { settings: Settings; report: ImportReport } {
  if (!selectedIds.length) throw new Error("请至少选择一个要导入的项目。");
  const catalog = collectImportCatalog(kind, settings, locations);
  const byId = new Map(
    catalog.flatMap(({ candidates }) =>
      candidates.map((candidate) => [candidate.item.id, candidate] as const),
    ),
  );
  const selected = [...new Set(selectedIds)].map((id) => {
    const candidate = byId.get(id);
    if (!candidate) throw new Error("导入列表已变化，请重新扫描后选择。");
    return candidate;
  });
  const report: ImportReport = {
    skills: 0,
    plugins: 0,
    servers: 0,
    existing: 0,
    issues: [],
    installedPlugins: [],
  };
  const servers = [...(settings.mcpServers ?? [])];
  const existingServers = new Map(servers.map((server) => [server.importKey, server.id]));
  const plugins = new Map(settings.importedPlugins?.map((plugin) => [plugin.id, plugin]));

  const addSkill = ({ item, storageId, root, configFiles }: SkillImport): string | undefined => {
    const destination = join(locations.skillsDir, storageId);
    try {
      if (existsSync(join(destination, "SKILL.md"))) {
        report.existing++;
      } else {
        copyImportedDirectory(root, destination, configFiles);
        report.skills++;
      }
      return storageId;
    } catch {
      report.issues.push({ name: item.name, reason: "copy" });
      return undefined;
    }
  };

  const addServer = ({
    item,
    storageKey,
    connection,
    assets,
    requiresOriginalApp,
  }: ServerImport): string | undefined => {
    const name = item.plugin ? `${item.plugin} / ${item.name}` : item.name;
    const existing = existingServers.get(storageKey);
    if (existing) {
      report.existing++;
      return existing;
    }
    let encryptedImport: string;
    try {
      encryptedImport = encryptSecret(JSON.stringify(connection));
    } catch {
      report.issues.push({ name, reason: "encryption" });
      return undefined;
    }
    if (assets) {
      try {
        if (!existsSync(assets.installed))
          copyImportedDirectory(assets.original, assets.installed, assets.configFiles);
        if (assets.data) mkdirSync(assets.data, { recursive: true });
      } catch {
        report.issues.push({ name, reason: "copy" });
        return undefined;
      }
    }
    const server: McpServerConfig = {
      id: randomUUID(),
      name,
      enabled: false,
      policy: "confirm",
      transport:
        connection.transport.type === "stdio"
          ? { type: "stdio", command: "", args: [] }
          : { type: "http", url: "" },
      importKey: storageKey,
      encryptedImport,
    };
    if (requiresOriginalApp) report.issues.push({ name, reason: "native" });
    servers.push(server);
    existingServers.set(storageKey, server.id);
    report.servers++;
    return server.id;
  };

  for (const candidate of selected) {
    if (candidate.kind === "skill") {
      addSkill(candidate);
      continue;
    }
    if (candidate.kind === "mcp") {
      addServer(candidate);
      continue;
    }
    const {
      item,
      storageId,
      source,
      version,
      partial,
      skills,
      servers: bundledServers,
    } = candidate;
    const issueCount = report.issues.length;
    const skillIds = [...new Set(skills.flatMap((skill) => addSkill(skill) ?? []))];
    const serverIds = [...new Set(bundledServers.flatMap((server) => addServer(server) ?? []))];
    if (!skillIds.length && !serverIds.length) continue;
    const previous = plugins.get(storageId);
    if (previous) report.existing++;
    else report.plugins++;
    plugins.set(storageId, {
      id: storageId,
      source,
      name: item.name,
      version,
      skillIds,
      serverIds,
      partial: partial || report.issues.length !== issueCount || Boolean(previous?.partial),
    });
  }

  const updated: Settings = {
    ...settings,
    mcpServers: servers,
    importedPlugins: [...plugins.values()],
  };
  report.installedPlugins = importedPlugins(updated, locations.skillsDir);
  return { settings: updated, report };
}
