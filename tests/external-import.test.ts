// @env node
import { existsSync, mkdirSync, mkdtempDisposableSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import { McpManager } from "../src/main/agent-host/mcp";
import { decryptSecret, mergeSettingsInput } from "../src/main/agent-host/settings";
import { scanSkills } from "../src/main/agent-host/skills";
import {
  importExternal,
  importedPlugins,
  previewExternalImport,
  toggleImportedPlugin,
} from "../src/main/external-import";
import { resolveImportedMcp } from "../src/main/external-import/mcp";
import type { ImportedMcpConnection, ImportLocations } from "../src/main/external-import/types";
import type { Settings } from "../src/shared/contract";
import type { ExternalImportItem, ExternalImportKind, ImportSource } from "../src/shared/imports";

vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    encryptString: (value: string) => Buffer.from(value, "utf8"),
    decryptString: (value: Buffer) => value.toString("utf8"),
  },
}));

function locations(root: string): ImportLocations {
  const home = join(root, "home");
  const settingsDir = join(root, "pi");
  return {
    home,
    codexHome: join(home, "codex-custom"),
    claudeHome: join(home, "claude-custom"),
    claudeConfig: join(home, "claude-custom", ".claude.json"),
    workspace: join(root, "project"),
    settingsDir,
    skillsDir: join(settingsDir, "skills"),
  };
}

function write(path: string, text: string | object): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, typeof text === "string" ? text : JSON.stringify(text), "utf8");
}

const empty: Settings = { providers: [], activeProviderId: "" };

function options(
  kind: ExternalImportKind,
  source: ImportSource,
  settings: Settings,
  paths: ImportLocations,
): ExternalImportItem[] {
  return (
    previewExternalImport(kind, settings, paths).groups.find((group) => group.source === source)
      ?.items ?? []
  );
}

function importedConnection(settings: Settings, serverName: string): ImportedMcpConnection {
  const server = settings.mcpServers?.find((item) => item.name === serverName);
  const value = decryptSecret(server?.encryptedImport);
  if (!value) throw new Error("Missing test server");
  return JSON.parse(value) as ImportedMcpConnection;
}

describe("external import selection", () => {
  it("lists plugin bundles only while they have a skill or MCP configuration", () => {
    using fixture = mkdtempDisposableSync(join(tmpdir(), "pi-import-components-"));
    const { skillsDir } = locations(fixture.path);
    write(join(skillsDir, "fixture-skill", "SKILL.md"), "Test skill");
    const settings: Settings = {
      ...empty,
      skillsEnabled: ["fixture-skill"],
      importedPlugins: [
        {
          id: "empty",
          source: "codex",
          name: "Empty plugin",
          skillIds: [],
          serverIds: [],
          partial: true,
        },
        {
          id: "removed",
          source: "claude-code",
          name: "Removed components",
          skillIds: ["missing"],
          serverIds: ["missing"],
          partial: false,
        },
        {
          id: "with-skill",
          source: "codex",
          name: "Skill bundle",
          skillIds: ["fixture-skill"],
          serverIds: ["missing"],
          partial: true,
        },
        {
          id: "with-server",
          source: "claude-code",
          name: "MCP bundle",
          skillIds: [],
          serverIds: ["local"],
          partial: true,
        },
      ],
      mcpServers: [
        {
          id: "local",
          name: "Local server",
          enabled: false,
          policy: "confirm",
          transport: { type: "stdio", command: "node", args: [] },
        },
      ],
    };
    expect(importedPlugins(settings, skillsDir)).toMatchObject([
      { id: "with-skill", skills: 1, servers: 0, enabled: "all" },
      { id: "with-server", skills: 0, servers: 1, enabled: "none" },
    ]);
    expect(settings.importedPlugins).toHaveLength(4);
  });

  it("previews both tools without writes and imports only the checked MCP server", () => {
    using fixture = mkdtempDisposableSync(join(tmpdir(), "pi-import-selection-"));
    const paths = locations(fixture.path);
    write(
      join(paths.codexHome, "config.toml"),
      [
        "[mcp_servers.chosen]",
        'command = "node"',
        'args = ["fixture-private-arg"]',
        "[mcp_servers.unchecked]",
        'command = "node"',
      ].join("\n"),
    );
    write(paths.claudeConfig, { mcpServers: { other_source: { command: "node" } } });
    write(join(paths.codexHome, "skills/unrelated/SKILL.md"), "Test skill");
    const preview = previewExternalImport("mcp", empty, paths);
    expect(
      preview.groups.map(({ source, items }) => [source, items.map(({ name }) => name)]),
    ).toEqual([
      ["codex", ["chosen", "unchecked"]],
      ["claude-code", ["other_source"]],
    ]);
    expect(JSON.stringify(preview)).not.toContain("fixture-private-arg");
    expect(existsSync(paths.settingsDir)).toBe(false);

    const selected = preview.groups[0].items[0].id;
    const { settings, report } = importExternal("mcp", [selected], empty, paths);
    expect(report).toMatchObject({ skills: 0, plugins: 0, servers: 1, existing: 0, issues: [] });
    expect(settings.mcpServers?.map(({ name, enabled }) => [name, enabled])).toEqual([
      ["chosen", false],
    ]);
    expect(existsSync(paths.skillsDir)).toBe(false);
    expect(options("mcp", "codex", settings, paths)[0]).toMatchObject({
      name: "chosen",
      imported: true,
    });
  });

  it("rejects an empty or stale selection before copying any of its items", () => {
    using fixture = mkdtempDisposableSync(join(tmpdir(), "pi-import-selection-"));
    const paths = locations(fixture.path);
    const file = join(paths.codexHome, "config.toml");
    write(file, '[mcp_servers.current]\ncommand = "node"\n[mcp_servers.stale]\ncommand = "node"');
    const [current, stale] = options("mcp", "codex", empty, paths);
    write(
      file,
      '[mcp_servers.current]\ncommand = "node"\n[mcp_servers.stale]\ncommand = "updated"',
    );
    expect(() => importExternal("mcp", [], empty, paths)).toThrow(/至少选择一个/);
    expect(() => importExternal("mcp", [current.id, stale.id], empty, paths)).toThrow(/重新扫描/);
    expect(existsSync(paths.settingsDir)).toBe(false);
    expect(empty.mcpServers).toBeUndefined();
  });

  it("copies Codex user and project skills, plugins and MCP settings without installing duplicates", async () => {
    using fixture = mkdtempDisposableSync(join(tmpdir(), "pi-codex-import-"));
    const paths = locations(fixture.path);
    const project = paths.workspace!;
    write(join(paths.home, ".agents/skills/personal/SKILL.md"), "Personal");
    write(join(paths.codexHome, "skills/legacy/SKILL.md"), "Legacy skill");
    write(join(paths.codexHome, "skills/.system/internal/SKILL.md"), "Bundled system skill");
    write(join(project, ".agents/skills/project-skill/SKILL.md"), "Project skill");
    write(
      join(paths.codexHome, "config.toml"),
      [
        '[plugins."samples@test"]',
        "enabled = true",
        '[plugins."samples@test".mcp_servers.remote]',
        'enabled_tools = ["safe_tool"]',
        "[mcp_servers.private_stdio]",
        'command = "node"',
        'args = ["--api-key", "fixture-inline-key"]',
        "[mcp_servers.private_stdio.env]",
        'MCP_SECRET = "fixture-local-secret"',
      ].join("\n"),
    );
    write(
      join(project, ".codex/config.toml"),
      '[mcp_servers.project]\ncommand = "node"\nargs = ["local.js"]',
    );
    const plugin = join(paths.codexHome, "plugins/cache/test/samples/1.2.0");
    write(join(plugin, "plugin.json"), { name: "portable-samples", version: "1.2.0" });
    write(join(plugin, "mcp.json"), {
      mcpServers: {
        remote: {
          type: "streamable-http",
          url: "https://example.test/mcp",
          headers: { Authorization: "Bearer fixture-http-secret" },
        },
      },
    });
    write(join(plugin, "skills/packaged/SKILL.md"), "Packaged skill");
    write(join(plugin, "skills/packaged/references/guide.md"), "Reference");

    const personal = options("skill", "codex", empty, paths)
      .filter(({ plugin: owner }) => !owner)
      .map(({ id }) => id);
    const first = importExternal("skill", personal, empty, paths);
    expect(first.report).toMatchObject({ skills: 3, plugins: 0, servers: 0 });
    const serviceIds = options("mcp", "codex", first.settings, paths).map(({ id }) => id);
    const second = importExternal("mcp", serviceIds, first.settings, paths);
    expect(second.report).toMatchObject({ skills: 0, plugins: 0, servers: 3 });
    const [bundle] = options("plugin", "codex", second.settings, paths);
    expect(bundle).toMatchObject({
      imported: false,
      contents: { skills: ["packaged"], servers: ["remote"] },
    });
    const { report, settings } = importExternal("plugin", [bundle.id], second.settings, paths);
    expect(report).toMatchObject({ skills: 1, plugins: 1, servers: 0, existing: 1, issues: [] });
    expect(scanSkills(paths.skillsDir, [])).toHaveLength(4);
    expect(settings.skillsEnabled).toBeUndefined();
    expect(
      settings.mcpServers?.every(({ enabled, policy }) => !enabled && policy === "confirm"),
    ).toBe(true);
    const manager = new McpManager(() => settings, "0.0.0");
    const views = await manager.list();
    expect(views.find(({ name }) => name === "private_stdio")).toMatchObject({
      transport: { type: "stdio", command: "", args: [] },
      imported: true,
    });
    for (const secret of ["fixture-inline-key", "fixture-local-secret", "fixture-http-secret"]) {
      expect(JSON.stringify([report, settings, views])).not.toContain(secret);
    }
    expect(importedConnection(settings, "private_stdio").transport).toEqual({
      type: "stdio",
      command: "node",
      args: ["--api-key", "fixture-inline-key"],
    });
    const remote = importedConnection(settings, "portable-samples / remote");
    expect(remote.includeTools).toEqual(["safe_tool"]);
    expect(resolveImportedMcp(remote).headers).toEqual({
      authorization: "Bearer fixture-http-secret",
    });
    const imported = settings.importedPlugins![0];
    const assetRoot = join(paths.settingsDir, "imported-plugins", imported.id);
    expect(existsSync(join(assetRoot, "mcp.json"))).toBe(false);
    expect(
      readFileSync(join(paths.skillsDir, imported.skillIds[0], "references/guide.md"), "utf8"),
    ).toBe("Reference");
    const enabled = toggleImportedPlugin(settings, imported.id, true);
    expect(importedPlugins(enabled, paths.skillsDir)[0].enabled).toBe("all");
    expect(
      importedPlugins(toggleImportedPlugin(enabled, imported.id, false), paths.skillsDir)[0]
        .enabled,
    ).toBe("none");
    const saved = mergeSettingsInput(enabled, {
      providers: [],
      activeProviderId: "",
      persona: "test",
    });
    expect(importedPlugins(saved, paths.skillsDir)[0].enabled).toBe("all");
    expect(importExternal("plugin", [bundle.id], saved, paths).report).toMatchObject({
      skills: 0,
      plugins: 0,
      servers: 0,
      existing: 3,
    });
  });

  it("applies Claude Code project precedence and resolves a bundled stdio server from the copied plugin", () => {
    using fixture = mkdtempDisposableSync(join(tmpdir(), "pi-claude-import-"));
    const paths = locations(fixture.path);
    const project = paths.workspace!;
    const plugin = join(paths.claudeHome, "plugins/cache/official/sample/3.0.0");
    write(join(paths.claudeHome, "skills/global/SKILL.md"), "Global");
    write(join(project, ".claude/skills/workspace/SKILL.md"), "Workspace");
    write(paths.claudeConfig, {
      mcpServers: {
        selected: { command: "old" },
        old_sse: { type: "sse", url: "https://example.test/events" },
      },
      projects: {
        [project.replaceAll("\\", "/")]: {
          mcpServers: { selected: { command: "node", args: ["local.js"] } },
        },
      },
    });
    write(join(project, ".mcp.json"), { mcpServers: { selected: { command: "overridden" } } });
    write(join(paths.claudeHome, "plugins/installed_plugins.json"), {
      version: 2,
      plugins: {
        "sample@official": [{ scope: "project", projectPath: project, installPath: plugin }],
        "ignored@official": [{ scope: "project", projectPath: fixture.path, installPath: plugin }],
      },
    });
    write(join(plugin, ".claude-plugin/plugin.json"), {
      name: "sample",
      version: "3.0.0",
      skills: ["./extra"],
      mcpServers: ["./connections/tool.json"],
    });
    write(join(plugin, "extra/action/SKILL.md"), "Bundled action");
    write(join(plugin, "hooks/hooks.json"), {});
    write(join(plugin, "server.mjs"), "export {}");
    write(join(plugin, "connections/tool.json"), {
      echo: {
        command: "node",
        args: ["${CLAUDE_PLUGIN_ROOT}/server.mjs"],
        env: { TEST_NAME: "${PI_IMPORT_UNSET:-fallback}" },
      },
    });

    const skills = options("skill", "claude-code", empty, paths)
      .filter(({ plugin: owner }) => !owner)
      .map(({ id }) => id);
    const first = importExternal("skill", skills, empty, paths);
    expect(first.report.skills).toBe(2);
    const services = previewExternalImport("mcp", first.settings, paths).groups.find(
      ({ source }) => source === "claude-code",
    )!;
    expect(services.issues).toContainEqual({ name: "old_sse", reason: "transport" });
    const selected = services.items.find(({ name }) => name === "selected")!;
    const second = importExternal("mcp", [selected.id], first.settings, paths);
    const [bundle] = options("plugin", "claude-code", second.settings, paths);
    const { report, settings } = importExternal("plugin", [bundle.id], second.settings, paths);
    expect(report).toMatchObject({ skills: 1, plugins: 1, servers: 1, existing: 0 });
    expect(report.installedPlugins[0]).toMatchObject({
      name: "sample",
      partial: true,
      enabled: "none",
    });
    expect(resolveImportedMcp(importedConnection(settings, "selected"))).toMatchObject({
      cwd: project,
      transport: { command: "node", args: ["local.js"] },
    });
    const copied = join(paths.settingsDir, "imported-plugins", report.installedPlugins[0].id);
    const resolved = resolveImportedMcp(importedConnection(settings, "sample / echo"));
    expect(resolved).toMatchObject({
      cwd: copied,
      transport: { type: "stdio", args: [copied + "/server.mjs"] },
      env: { TEST_NAME: "fallback" },
    });
    expect(existsSync(join(copied, "server.mjs"))).toBe(true);
    expect(existsSync(join(copied, "connections/tool.json"))).toBe(false);
    expect(options("plugin", "claude-code", empty, { ...paths, workspace: undefined })).toEqual([]);
  });
});
