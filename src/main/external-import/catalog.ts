// @env node
import { randomUUID } from "node:crypto";
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import type { Settings } from "@shared/contract";
import type { ExternalImportKind, ImportIssue, ImportSource } from "@shared/imports";
import { parseSkillMarkdown } from "../agent-host/skills";
import { directory, fingerprint } from "./files";
import { normalizeImportedMcp } from "./mcp";
import { discoverImport, object } from "./sources";
import type {
  ImportCandidate,
  ImportCatalogGroup,
  ImportLocations,
  ImportMcpContext,
  PluginAssets,
  ServerImport,
  SkillImport,
} from "./types";

// Selection IDs bind a checked row to the current configuration without exposing its secrets.
const reviewKey = randomUUID();

function scanSource(
  source: ImportSource,
  kind: ExternalImportKind,
  settings: Settings,
  locations: ImportLocations,
): ImportCatalogGroup {
  const discovered = discoverImport(source, locations);
  const issues: ImportIssue[] = [...discovered.issues];
  const candidates: ImportCandidate[] = [];
  const registeredPlugins = new Set(settings.importedPlugins?.map(({ id }) => id));
  const registeredServers = new Set(settings.mcpServers?.map(({ importKey }) => importKey));

  const skillItem = (
    path: string,
    bundle?: { id: string; name: string; files: ReadonlySet<string> },
  ): SkillImport | undefined => {
    try {
      const root = directory(path);
      if (!root || !lstatSync(join(root, "SKILL.md")).isFile()) throw new Error("Unreadable skill");
      const folderName = basename(root);
      const slug =
        folderName
          .replace(/[^\p{L}\p{N}_.-]+/gu, "-")
          .replace(/^\.+/, "")
          .slice(0, 55) || "skill";
      const storageId = `${slug}-${fingerprint(bundle?.id ?? "", root)}`;
      const raw = readFileSync(join(root, "SKILL.md"), "utf8");
      const { name, description } = parseSkillMarkdown(folderName, raw);
      return {
        kind: "skill",
        item: {
          id: fingerprint(reviewKey, source, "skill", storageId, raw),
          name,
          description,
          plugin: bundle?.name,
          imported: existsSync(join(locations.skillsDir, storageId, "SKILL.md")),
        },
        storageId,
        root,
        configFiles: bundle?.files,
      };
    } catch {
      issues.push({ name: basename(path), reason: "read" });
      return undefined;
    }
  };

  const serverItem = (
    name: string,
    definition: unknown,
    scope: string,
    context: ImportMcpContext,
    bundle?: { name: string; assets: PluginAssets },
  ): ServerImport | undefined => {
    const storedName = bundle ? `${bundle.name} / ${name}` : name;
    const storageKey = fingerprint(source, scope, storedName);
    const connection = normalizeImportedMcp(definition, context);
    if (typeof connection === "string") {
      issues.push({ name: storedName, reason: connection });
      return undefined;
    }
    const { headersHelper, oauth, auth } = object(definition);
    const requiresOriginalApp = Boolean(headersHelper || oauth || auth === "chatgpt");
    if (requiresOriginalApp) issues.push({ name: storedName, reason: "native" });
    return {
      kind: "mcp",
      item: {
        id: fingerprint(reviewKey, source, "mcp", storageKey, JSON.stringify(connection)),
        name,
        plugin: bundle?.name,
        transport: connection.transport.type,
        imported: registeredServers.has(storageKey),
      },
      storageKey,
      connection,
      assets: bundle?.assets,
      requiresOriginalApp,
    };
  };

  if (kind === "skill") {
    candidates.push(...discovered.skills.flatMap((path) => skillItem(path) ?? []));
  }
  if (kind === "mcp") {
    for (const [name, { definition, workspace }] of discovered.servers) {
      const candidate = serverItem(name, definition, workspace ?? "", { source, workspace });
      if (candidate) candidates.push(candidate);
    }
  }

  for (const plugin of discovered.plugins) {
    const storageId = fingerprint(source, plugin.key, plugin.directory, plugin.version ?? "");
    const previousIssueCount = issues.length;
    const assets: PluginAssets = {
      original: plugin.directory,
      installed: join(locations.settingsDir, "imported-plugins", storageId),
      data:
        source === "claude-code"
          ? join(locations.settingsDir, "imported-plugin-data", storageId)
          : undefined,
      configFiles: plugin.configFiles,
    };
    const skills =
      kind === "mcp"
        ? []
        : plugin.skills.flatMap(
            (path) =>
              skillItem(path, { id: storageId, name: plugin.name, files: plugin.configFiles }) ??
              [],
          );
    const servers =
      kind === "skill"
        ? []
        : Object.entries(plugin.servers).flatMap(
            ([name, definition]) =>
              serverItem(
                name,
                definition,
                storageId,
                { source, workspace: plugin.workspace, plugin: assets },
                { name: plugin.name, assets },
              ) ?? [],
          );
    if (kind === "skill" || kind === "mcp") {
      candidates.push(...skills, ...servers);
      continue;
    }
    const members = [...skills, ...servers];
    const partial = plugin.partial || previousIssueCount !== issues.length;
    if (plugin.partial || (!members.length && previousIssueCount === issues.length)) {
      issues.push({ name: plugin.name, reason: "native" });
    }
    if (!members.length) continue;
    candidates.push({
      kind: "plugin",
      item: {
        id: fingerprint(
          reviewKey,
          source,
          "plugin",
          storageId,
          plugin.name,
          ...members.map(({ item }) => item.id).sort(),
        ),
        name: plugin.name,
        imported: registeredPlugins.has(storageId) && members.every(({ item }) => item.imported),
        contents: {
          skills: skills.map(({ item }) => item.name),
          servers: servers.map(({ item }) => item.name),
          partial,
        },
      },
      storageId,
      source,
      version: plugin.version,
      skills,
      servers,
      partial,
    });
  }

  const unique = [
    ...new Map(candidates.map((candidate) => [candidate.item.id, candidate])).values(),
  ];
  return {
    source,
    candidates: unique.sort((a, b) => a.item.name.localeCompare(b.item.name)),
    issues,
  };
}

export function collectImportCatalog(
  kind: ExternalImportKind,
  settings: Settings,
  locations: ImportLocations,
): ImportCatalogGroup[] {
  return (["codex", "claude-code"] as const).map((source) =>
    scanSource(source, kind, settings, locations),
  );
}
