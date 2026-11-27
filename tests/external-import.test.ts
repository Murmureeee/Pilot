// @env node
import { execFileSync } from "node:child_process";
import {
  existsSync,
  mkdirSync,
  mkdtempDisposableSync,
  readdirSync,
  readFileSync,
  realpathSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { McpManager } from "../src/main/agent-host/mcp";
import { scanSkills } from "../src/main/agent-host/skills";
import {
  browsePluginMarketplace,
  listPluginMarketplaces,
  rememberMarketplace,
} from "../src/main/discovery/marketplace";
import {
  importExternal,
  importedPlugins,
  previewExternalImport,
  toggleImportedPlugin,
} from "../src/main/external-import";
import { resolveImportedMcp } from "../src/main/external-import/mcp";
import {
  installPluginPackage,
  previewPluginPackage,
  uninstallPluginPackage,
} from "../src/main/external-import/packages";
import type {
  ImportedMcpConnection,
  ImportLocations,
  WithPluginServersClosed,
} from "../src/main/external-import/types";
import {
  loadSettings,
  mergeSettingsInput,
  saveSettings,
  toPublicSettings,
} from "../src/main/settings";
import { decryptSecret } from "../src/main/settings/secrets";
import type { Settings } from "../src/main/settings/types";
import type {
  ExternalImportItem,
  ExternalImportKind,
  ImportSource,
  PluginPackageSource,
} from "../src/shared/imports";

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

function gitCommit(root: string, message: string): string {
  execFileSync("git", ["-c", "core.autocrlf=false", "add", "--all"], { cwd: root });
  execFileSync(
    "git",
    [
      "-c",
      "user.name=Pilot Fixture",
      "-c",
      "user.email=fixture@example.test",
      "-c",
      "commit.gpgSign=false",
      "commit",
      "-qm",
      message,
    ],
    { cwd: root },
  );
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
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
    const views = await manager.list(undefined);
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
    using fixture = mkdtempDisposableSync(join(realpathSync(tmpdir()), "pi-claude-import-"));
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

describe("plugin package installation", () => {
  it("reviews a Git revision, installs a Claude Code plugin disabled and replaces it after reviewing changes", async () => {
    using fixture = mkdtempDisposableSync(join(realpathSync(tmpdir()), "pi-package-git-"));
    const paths = locations(fixture.path);
    const root = join(fixture.path, "local repository");
    execFileSync("git", ["init", "-q", "--template=", root]);
    const manifest = join(root, ".claude-plugin", "plugin.json");
    const script = join(root, "scripts", "server.mjs");
    write(manifest, { name: "workflow", version: "1.0.0", commands: "./commands" });
    write(
      join(root, "skills", "review", "SKILL.md"),
      "---\nname: Review fixture\n---\nReview the sample.",
    );
    write(
      join(root, "commands", "summarize.md"),
      "---\ndescription: Sample\n---\nReview $ARGUMENTS and $1.",
    );
    write(script, "export const version = 1;\n");
    write(join(root, "scripts", "old.sh"), "# previous version");
    write(join(root, "hooks", "hooks.json"), {});
    write(join(root, ".mcp.json"), {
      mcpServers: {
        echo: {
          command: "node",
          args: ["${CLAUDE_PLUGIN_ROOT}/scripts/server.mjs", "--token", "fixture-private-arg"],
        },
        chat: { url: "https://example.test/mcp", auth: "chatgpt" },
      },
    });
    const firstRevision = gitCommit(root, "Add fixture plugin");
    const source = { kind: "git", location: root } satisfies PluginPackageSource;
    const read = (): Settings => loadSettings(paths.settingsDir);
    const save = (settings: Settings): void => saveSettings(paths.settingsDir, settings);
    const close = vi.fn<WithPluginServersClosed>(async (_ids, change) => change());

    const preview = await previewPluginPackage(source, empty, paths);
    expect(preview).toMatchObject({
      name: "workflow",
      version: "1.0.0",
      format: "claude-code",
      revision: firstRevision,
      skills: ["Review fixture"],
      templates: [
        {
          name: "workflow-summarize",
          path: "commands/summarize.md",
          text: "Review {{arguments}} and {{arg1}}.",
        },
      ],
      scripts: ["scripts/old.sh", "scripts/server.mjs"],
      servers: [
        {
          name: "echo",
          command: "node",
          args: ["${CLAUDE_PLUGIN_ROOT}/scripts/server.mjs", "--token", "••••"],
        },
      ],
      unsupported: ["钩子", "MCP chat"],
      current: false,
    });
    expect(existsSync(paths.settingsDir)).toBe(false);
    await installPluginPackage(preview.source, preview.token, paths, read, save, close);
    const saved = read();
    const [first] = saved.importedPlugins!;
    const firstAssets = join(paths.settingsDir, "imported-plugins", first.managed!.contentId);
    const data = join(paths.settingsDir, "imported-plugin-data", first.id);
    expect(readFileSync(join(firstAssets, "scripts", "server.mjs"), "utf8")).toContain(
      "version = 1",
    );
    expect(existsSync(join(firstAssets, ".mcp.json"))).toBe(false);
    expect(existsSync(join(firstAssets, ".claude-plugin", "plugin.json"))).toBe(false);
    expect(importedPlugins(saved, paths.skillsDir)).toMatchObject([
      { enabled: "none", templates: 1 },
    ]);
    expect(toPublicSettings(saved).pluginPromptTemplates).toEqual([]);
    expect(saved.mcpServers![0]).toMatchObject({
      enabled: false,
      policy: "confirm",
      transport: { command: "", args: [] },
    });
    expect(resolveImportedMcp(importedConnection(saved, "workflow / echo"))).toMatchObject({
      cwd: firstAssets,
      transport: {
        command: "node",
        args: [firstAssets + "/scripts/server.mjs", "--token", "fixture-private-arg"],
      },
    });
    save(toggleImportedPlugin(saved, first.id, true));
    expect(importedPlugins(read(), paths.skillsDir)[0].enabled).toBe("all");
    expect(scanSkills(paths.skillsDir, read().skillsEnabled ?? [])).toMatchObject([
      { name: "Review fixture", enabled: true },
    ]);
    expect(toPublicSettings(read()).pluginPromptTemplates?.[0].name).toBe("workflow-summarize");
    const same = await previewPluginPackage(first.id, read(), paths);
    expect(same.current).toBe(true);
    await expect(
      installPluginPackage(first.id, same.token, paths, read, save, close),
    ).rejects.toThrow(/重新预览/);

    write(manifest, { name: "workflow", version: "2.0.0", commands: "./commands" });
    write(script, "export const version = 2;\n");
    write(join(root, "scripts", "new.sh"), "# new version");
    unlinkSync(join(root, "scripts", "old.sh"));
    write(join(data, "cache.txt"), "Plugin data survives an update");
    const secondRevision = gitCommit(root, "Update fixture plugin");
    const update = await previewPluginPackage(first.id, read(), paths);
    expect(update.revision).toBe(secondRevision);
    expect(update.previous).toMatchObject({
      version: "1.0.0",
      revision: firstRevision,
      changes: [
        { path: ".claude-plugin/plugin.json", kind: "modified" },
        { path: "scripts/new.sh", kind: "added", after: "# new version" },
        { path: "scripts/old.sh", kind: "removed", before: "# previous version" },
        {
          path: "scripts/server.mjs",
          kind: "modified",
          before: expect.stringMatching(/^export const version = 1;\r?\n$/),
          after: expect.stringMatching(/^export const version = 2;\r?\n$/),
        },
      ],
    });
    await installPluginPackage(first.id, update.token, paths, read, save, close);
    expect(close).toHaveBeenCalledExactlyOnceWith(first.serverIds, expect.any(Function));
    const updated = read();
    expect(importedPlugins(updated, paths.skillsDir)).toMatchObject([
      { id: first.id, enabled: "none", version: "2.0.0", revision: secondRevision },
    ]);
    expect(updated.mcpServers![0].id).not.toBe(first.serverIds[0]);
    expect(existsSync(firstAssets)).toBe(false);
    expect(existsSync(join(paths.skillsDir, first.skillIds[0]))).toBe(false);
    expect(readFileSync(join(data, "cache.txt"), "utf8")).toBe("Plugin data survives an update");

    uninstallPluginPackage(first.id, paths, updated, save);
    expect(read()).toMatchObject({ importedPlugins: [], mcpServers: [], skillsEnabled: [] });
    expect(readdirSync(join(paths.settingsDir, "imported-plugins"))).toEqual([]);
    expect(readdirSync(paths.skillsDir)).toEqual([]);
    expect(existsSync(data)).toBe(false);
    expect(existsSync(script)).toBe(true);
  }, 15_000);

  it("reads a wrapped ZIP and installs only the Pi resources declared by the package", async () => {
    using fixture = mkdtempDisposableSync(join(tmpdir(), "pi-package-zip-"));
    const paths = locations(fixture.path);
    const root = join(fixture.path, "pi-fixture");
    execFileSync("git", ["init", "-q", "--template=", root]);
    write(join(root, "package.json"), {
      name: "@example/tools",
      version: "1.1.0",
      pi: {
        skills: ["./resources/*", "!./resources/internal"],
        prompts: ["./resources/*.md"],
        extensions: ["./extension.ts"],
      },
      scripts: { postinstall: "node extension.ts" },
    });
    write(join(root, "resources", "public", "SKILL.md"), "---\nname: Public fixture\n---\nPublic.");
    write(join(root, "resources", "internal", "SKILL.md"), "Not selected by the manifest.");
    write(join(root, "resources", "review.md"), "Review {{file}}.");
    write(join(root, "extension.ts"), "export {};");
    gitCommit(root, "Add ZIP contents");
    const archive = join(fixture.path, "fixture.zip");
    execFileSync(
      "git",
      ["archive", "--format=zip", "--prefix=pi-fixture/", "--output=" + archive, "HEAD"],
      { cwd: root },
    );
    const source = { kind: "zip", location: archive } satisfies PluginPackageSource;
    let settings = empty;
    const read = (): Settings => settings;
    const save = (next: Settings): void => {
      settings = next;
    };
    const close = vi.fn<WithPluginServersClosed>(async (_ids, change) => change());
    const preview = await previewPluginPackage(source, settings, paths);
    expect(preview).toMatchObject({
      format: "pi",
      name: "@example/tools",
      version: "1.1.0",
      skills: ["Public fixture"],
      templates: [{ name: "example-tools-review", text: "Review {{file}}." }],
      scripts: ["extension.ts"],
      unsupported: ["扩展", "npm 生命周期脚本"],
    });
    const attempts = await Promise.allSettled([
      installPluginPackage(source, preview.token, paths, read, save, close),
      installPluginPackage(source, preview.token, paths, read, save, close),
    ]);
    expect(attempts.map(({ status }) => status).sort()).toEqual(["fulfilled", "rejected"]);
    expect(importedPlugins(settings, paths.skillsDir)).toMatchObject([
      { skills: 1, templates: 1, enabled: "none", packageSource: { kind: "zip" } },
    ]);
  });

  it("rejects a stale directory review and restores the previous package if saving fails", async () => {
    using fixture = mkdtempDisposableSync(join(tmpdir(), "pi-package-directory-"));
    const paths = locations(fixture.path);
    const root = join(fixture.path, "codex");
    write(join(root, "plugin.json"), {
      name: "demo",
      version: "1",
      extensions: { "com.openai": { skills: "./beside" } },
    });
    const skill = join(root, "beside", "demo", "SKILL.md");
    write(skill, "Previous instructions");
    const source = { kind: "directory", location: root } satisfies PluginPackageSource;
    let settings = empty;
    const read = (): Settings => settings;
    const save = (next: Settings): void => {
      settings = next;
    };
    const fail = (): never => {
      throw new Error("fixture save failed");
    };
    const close = vi.fn<WithPluginServersClosed>(async (_ids, change) => change());
    const preview = await previewPluginPackage(source, read(), paths);
    expect(preview).toMatchObject({
      format: "codex",
      name: "demo",
      version: "1",
      skills: ["demo"],
    });
    write(skill, "Changed after review");
    await expect(
      installPluginPackage(source, preview.token, paths, read, save, close),
    ).rejects.toThrow(/重新预览/);
    expect(existsSync(paths.settingsDir)).toBe(false);
    const refreshed = await previewPluginPackage(source, read(), paths);
    await expect(
      installPluginPackage(source, refreshed.token, paths, read, fail, close),
    ).rejects.toThrow(/无法保存插件变更/);
    const installedRoot = join(paths.settingsDir, "imported-plugins");
    expect(readdirSync(installedRoot)).toEqual([]);
    expect(readdirSync(paths.skillsDir)).toEqual([]);
    await installPluginPackage(source, refreshed.token, paths, read, save, close);
    const [plugin] = settings.importedPlugins!;
    save(toggleImportedPlugin(read(), plugin.id, true));
    const old = read();
    write(skill, "An update");
    const next = await previewPluginPackage(plugin.id, read(), paths);
    await expect(
      installPluginPackage(plugin.id, next.token, paths, read, fail, close),
    ).rejects.toThrow(/无法保存插件变更/);
    expect(() => uninstallPluginPackage(plugin.id, paths, read(), fail)).toThrow(
      /无法保存插件变更/,
    );
    expect(read()).toBe(old);
    expect(readdirSync(installedRoot)).toEqual([plugin.managed!.contentId]);
    expect(readdirSync(paths.skillsDir)).toEqual(plugin.skillIds);
    expect(readFileSync(join(paths.skillsDir, plugin.skillIds[0], "SKILL.md"), "utf8")).toBe(
      "Changed after review",
    );
  });

  it("accepts a single skill directory and refuses links within a package", async () => {
    using fixture = mkdtempDisposableSync(join(tmpdir(), "pi-package-skill-"));
    const paths = locations(fixture.path);
    const root = join(fixture.path, "standalone skill");
    write(join(root, "SKILL.md"), "---\nname: Standalone fixture\n---\nUse this fixture.");
    const source = { kind: "directory", location: root } satisfies PluginPackageSource;
    const preview = await previewPluginPackage(source, empty, paths);
    expect(preview).toMatchObject({
      format: "skill",
      source: { location: realpathSync(root) },
      skills: ["Standalone fixture"],
    });
    mkdirSync(paths.home);
    symlinkSync(paths.home, join(root, "linked folder"), "junction");
    await expect(previewPluginPackage(source, empty, paths)).rejects.toThrow(/含有链接或无效路径/);
    expect(existsSync(paths.settingsDir)).toBe(false);
  });
});

describe("Claude Code plugin marketplaces", () => {
  it("reads a Git catalog and installs its sibling plugin directories independently", async () => {
    using fixture = mkdtempDisposableSync(join(tmpdir(), "pi-marketplace-"));
    const paths = locations(fixture.path);
    const root = join(fixture.path, "marketplace");
    execFileSync("git", ["init", "-q", "--template=", root]);
    write(join(root, ".claude-plugin", "marketplace.json"), {
      name: "fixture-market",
      owner: { name: "Fixture owner" },
      metadata: { pluginRoot: "./plugins" },
      plugins: [
        {
          name: "one",
          displayName: "First plugin",
          author: { name: "Fixture author" },
          version: "1.0.0",
          source: "./plugins/one",
        },
        { name: "two", source: "two" },
        {
          name: "remote",
          source: {
            source: "git-subdir",
            url: "example/repo",
            path: "plugins/remote",
            ref: "v2",
            sha: "a".repeat(40),
          },
        },
        { name: "github", source: { source: "github", repo: "example/other" } },
        { name: "url", source: { source: "url", url: "https://example.test/project.git" } },
        { name: "npm", source: { source: "npm", package: "test-marketplace-plugin" } },
        { name: "missing", source: "./absent" },
      ],
    });
    for (const name of ["one", "two"]) {
      write(join(root, "plugins", name, ".claude-plugin", "plugin.json"), {
        name: "plugin-" + name,
      });
      write(
        join(root, "plugins", name, "skills", name, "SKILL.md"),
        "---\nname: " + name + "\n---\nTest skill.",
      );
    }
    const original = gitCommit(root, "Add marketplace");
    execFileSync("git", ["tag", "v1", original], { cwd: root });
    write(
      join(root, "plugins", "one", "skills", "one", "SKILL.md"),
      "---\nname: updated-one\n---\nUpdated.",
    );
    gitCommit(root, "Update one plugin");

    const catalog = await browsePluginMarketplace(root);
    expect(catalog.name).toBe("fixture-market");
    expect(catalog.entries).toMatchObject([
      { key: "one", author: "Fixture author", version: "1.0.0", source: { path: "plugins/one" } },
      { key: "two", author: "Fixture owner", source: { path: "plugins/two" } },
      {
        key: "remote",
        source: {
          location: "https://github.com/example/repo.git",
          path: "plugins/remote",
          ref: "v2",
          sha: "a".repeat(40),
        },
      },
      { key: "github", source: { location: "https://github.com/example/other.git" } },
      { key: "url", source: { location: "https://example.test/project.git" } },
      { key: "npm", sourceType: "npm" },
      { key: "missing", source: { path: "absent" } },
    ]);
    expect(catalog.entries.find((entry) => entry.key === "npm")?.source).toBeUndefined();
    let settings = rememberMarketplace(empty, catalog);
    expect(rememberMarketplace(settings, catalog)).toBe(settings);
    const read = (): Settings => settings;
    const save = (next: Settings): void => {
      settings = next;
    };
    const withClosed: WithPluginServersClosed = async (_ids, change) => change();
    const sources = catalog.entries.slice(0, 2).map(({ source }) => source!);
    const pinned = await previewPluginPackage(
      { ...sources[0], ref: "v1", sha: original },
      settings,
      paths,
    );
    expect(pinned).toMatchObject({ revision: original, skills: ["one"] });
    const tagged = await previewPluginPackage({ ...sources[0], ref: "v1" }, settings, paths);
    expect(tagged).toMatchObject({ revision: original, skills: ["one"] });
    for (const [index, source] of sources.entries()) {
      const preview = await previewPluginPackage(source, settings, paths);
      expect(preview.skills).toEqual(index === 0 ? ["updated-one"] : ["two"]);
      await installPluginPackage(source, preview.token, paths, read, save, withClosed);
    }
    expect(new Set(settings.importedPlugins?.map(({ id }) => id)).size).toBe(2);
    saveSettings(paths.settingsDir, settings);
    expect(listPluginMarketplaces(loadSettings(paths.settingsDir))).toContainEqual({
      name: catalog.name,
      location: catalog.location,
    });
    expect(importedPlugins(loadSettings(paths.settingsDir), paths.skillsDir)).toMatchObject([
      { enabled: "none", packageSource: { path: "plugins/one" } },
      { enabled: "none", packageSource: { path: "plugins/two" } },
    ]);
    await expect(
      previewPluginPackage(catalog.entries.at(-1)!.source!, settings, paths),
    ).rejects.toThrow(/无法读取插件来源/);
  }, 25_000);

  it("rejects a Git repository that has no market manifest", async () => {
    using fixture = mkdtempDisposableSync(join(tmpdir(), "pi-marketplace-"));
    const root = fixture.path;
    execFileSync("git", ["init", "-q", "--template=", root]);
    write(join(root, "readme.md"), "Not a marketplace.");
    gitCommit(root, "Add unrelated file");
    await expect(browsePluginMarketplace(root)).rejects.toThrow(/插件市场清单无效/);
  });
});
