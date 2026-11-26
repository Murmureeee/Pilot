// @env node
import { app, dialog } from "electron";

import type { McpOAuthRef } from "@shared/mcp";

import { IPC } from "../../shared/contract";
import { NATIVE_DIALOG_TITLES } from "../constants";
import {
  browsePluginMarketplace,
  listPluginMarketplaces,
  rememberMarketplace,
} from "../discovery/marketplace";
import { searchMcpRegistry } from "../discovery/registry";
import {
  importedPlugins,
  importExternal,
  previewExternalImport,
  toggleImportedPlugin,
} from "../external-import";
import { resolveImportLocations } from "../external-import/locations";
import {
  PACKAGE_BUSY,
  PACKAGE_CHANGED,
  PACKAGE_NOT_FOUND,
} from "../external-import/package-constants";
import {
  installPluginPackage,
  previewPluginPackage,
  uninstallPluginPackage,
} from "../external-import/packages";
import { loadProjectConfig, projectMcpServers, projectTrustState } from "../project-config";
import { mergeMcpServer } from "../settings/mcp";
import type { McpServerConfig } from "../settings/types";
import { handle } from "./transport";
import type { IpcContext } from "./types";

export function registerIntegrationRoutes(
  ctx: Pick<
    IpcContext,
    | "settingsDir"
    | "skillsDir"
    | "getSettings"
    | "saveSettings"
    | "mcp"
    | "host"
    | "request"
    | "exit"
  >,
): void {
  handle(IPC.settingsImportedPlugins, () => importedPlugins(ctx.getSettings(), ctx.skillsDir));
  const importLocations = (project: string | null): ReturnType<typeof resolveImportLocations> =>
    resolveImportLocations(app.getPath("home"), ctx.settingsDir, ctx.skillsDir, project);
  const listMcp = (reconnectId?: string): ReturnType<IpcContext["mcp"]["list"]> =>
    ctx.mcp.list(ctx.host.getWorkingDirectory(), reconnectId, ctx.host.hasActiveRun());
  handle(IPC.settingsPreviewExternalImport, (_event, kind, project) =>
    previewExternalImport(kind, ctx.getSettings(), importLocations(project)),
  );
  handle(IPC.settingsImportExternal, (_event, kind, project, selectedIds) => {
    const { settings, report } = importExternal(
      kind,
      selectedIds,
      ctx.getSettings(),
      importLocations(project),
    );
    if (report.skills || report.plugins || report.servers) ctx.saveSettings(settings);
    return report;
  });
  handle(IPC.settingsToggleImportedPlugin, async (_event, id, enabled) => {
    const current = ctx.getSettings();
    const settings = toggleImportedPlugin(current, id, enabled);
    if (current !== settings) {
      ctx.saveSettings(settings);
      ctx.host.publishSnapshot();
      await listMcp();
    }
    return importedPlugins(ctx.getSettings(), ctx.skillsDir);
  });
  handle(IPC.settingsPickImportDirectory, async (_event, locale) => {
    const result = await dialog.showOpenDialog({
      title: NATIVE_DIALOG_TITLES[locale].importProject,
      defaultPath: ctx.getSettings().workingDirectory ?? app.getPath("home"),
      properties: ["openDirectory"],
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });

  const idle = (): void => {
    if (ctx.host.hasActiveRun()) throw new Error(PACKAGE_BUSY);
  };
  const withServersClosed = async (ids: readonly string[], change: () => void): Promise<void> => {
    idle();
    await ctx.mcp.withPluginServersClosed(ids, () => {
      idle();
      change();
    });
  };
  handle(IPC.settingsPickPluginPackage, async (_event, kind, locale) => {
    const result = await dialog.showOpenDialog({
      title: NATIVE_DIALOG_TITLES[locale][kind === "directory" ? "pluginDirectory" : "pluginZip"],
      properties: kind === "directory" ? ["openDirectory"] : ["openFile"],
      filters: kind === "zip" ? [{ name: "ZIP", extensions: ["zip"] }] : undefined,
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
  handle(IPC.settingsPreviewPluginPackage, (_event, source) =>
    previewPluginPackage(source, ctx.getSettings(), importLocations(null)),
  );
  handle(IPC.settingsInstallPluginPackage, async (_event, source, token) => {
    await installPluginPackage(
      source,
      token,
      importLocations(null),
      ctx.getSettings,
      ctx.saveSettings,
      withServersClosed,
    );
    ctx.host.publishSnapshot();
    return importedPlugins(ctx.getSettings(), ctx.skillsDir);
  });
  handle(IPC.settingsUninstallPlugin, async (_event, id) => {
    idle();
    const plugin = ctx.getSettings().importedPlugins?.find((entry) => entry.id === id);
    if (!plugin) throw new Error(PACKAGE_NOT_FOUND);
    await withServersClosed(plugin.serverIds, () => {
      const current = ctx.getSettings();
      const latest = current.importedPlugins?.find((entry) => entry.id === id);
      if (!latest || latest.managed?.contentId !== plugin.managed?.contentId)
        throw new Error(PACKAGE_CHANGED);
      uninstallPluginPackage(id, importLocations(null), current, ctx.saveSettings);
    });
    ctx.host.publishSnapshot();
    return importedPlugins(ctx.getSettings(), ctx.skillsDir);
  });

  handle(IPC.settingsPluginMarketplaces, () => listPluginMarketplaces(ctx.getSettings()));
  handle(IPC.settingsBrowsePluginMarketplace, async (_event, location, remember) => {
    const catalog = await browsePluginMarketplace(location);
    if (remember) {
      const current = ctx.getSettings();
      const next = rememberMarketplace(current, catalog);
      if (current !== next) ctx.saveSettings(next);
    }
    return catalog;
  });
  handle(IPC.settingsRemovePluginMarketplace, (_event, location) => {
    const current = ctx.getSettings();
    const next = current.pluginMarketplaces?.filter((source) => source.location !== location);
    if (next && next.length !== current.pluginMarketplaces?.length)
      ctx.saveSettings({ ...current, pluginMarketplaces: next });
    return listPluginMarketplaces(ctx.getSettings());
  });
  handle(IPC.settingsSearchMcpRegistry, (_event, query, cursor) =>
    searchMcpRegistry(query, cursor, ctx.request),
  );

  handle(IPC.settingsMcpList, () => listMcp());
  handle(IPC.settingsMcpSave, (_event, input) => {
    ctx.saveSettings(mergeMcpServer(ctx.getSettings(), input));
    return listMcp();
  });
  handle(IPC.settingsMcpReconnect, (_event, id) => listMcp(id));
  const oauthConfig = ({ id, composerId }: McpOAuthRef): McpServerConfig | undefined => {
    const settings = ctx.getSettings();
    if (composerId === undefined) return settings.mcpServers?.find((server) => server.id === id);
    try {
      ctx.host.checkComposerId(composerId);
    } catch {
      return;
    }
    const directory = ctx.host.getProjectDirectory();
    if (!directory) return;
    const config = loadProjectConfig(directory);
    if (projectTrustState(settings, config) !== "trusted") return;
    return projectMcpServers(config).find((server) => server.id === id);
  };
  handle(IPC.settingsMcpOAuthStart, async (event, target, requestId, locale) => {
    ctx.exit.checkWorkAllowed();
    const cancel = (): void => ctx.mcp.cancelSignIn(requestId);
    event.sender.once("destroyed", cancel);
    try {
      const signedIn = await ctx.mcp.signIn(
        () => oauthConfig(target),
        target.revision,
        requestId,
        locale,
      );
      if (signedIn && target.composerId) ctx.host.publishSnapshot();
      return signedIn;
    } finally {
      event.sender.removeListener("destroyed", cancel);
    }
  });
  handle(IPC.settingsMcpOAuthCancel, (_event, requestId) => ctx.mcp.cancelSignIn(requestId));
  handle(IPC.settingsMcpOAuthSignOut, (_event, target) => {
    ctx.mcp.signOut(oauthConfig(target), target.revision);
    if (target.composerId) ctx.host.publishSnapshot();
  });
  handle(IPC.settingsMcpRemove, (_event, id) => {
    const settings = ctx.getSettings();
    ctx.saveSettings({
      ...settings,
      mcpServers: (settings.mcpServers ?? []).filter((server) => server.id !== id),
    });
    return listMcp();
  });
}
