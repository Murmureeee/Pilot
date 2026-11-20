// @env node
import { app, dialog } from "electron";
import { IPC } from "../../shared/contract";
import { NATIVE_DIALOG_TITLES } from "../constants";
import {
  importedPlugins,
  importExternal,
  previewExternalImport,
  toggleImportedPlugin,
} from "../external-import";
import { resolveImportLocations } from "../external-import/locations";
import { mergeMcpServer } from "../settings/mcp";
import { handle } from "./transport";
import type { IpcContext } from "./types";

export function registerIntegrationRoutes(
  ctx: Pick<
    IpcContext,
    "settingsDir" | "skillsDir" | "getSettings" | "saveSettings" | "mcp" | "host"
  >,
): void {
  handle(IPC.settingsImportedPlugins, () => importedPlugins(ctx.getSettings(), ctx.skillsDir));
  const importLocations = (project: string | null): ReturnType<typeof resolveImportLocations> =>
    resolveImportLocations(app.getPath("home"), ctx.settingsDir, ctx.skillsDir, project);
  const listMcp = (reconnectId?: string): ReturnType<IpcContext["mcp"]["list"]> =>
    ctx.mcp.list(ctx.host.getWorkingDirectory(), reconnectId);
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

  handle(IPC.settingsMcpList, () => listMcp());
  handle(IPC.settingsMcpSave, (_event, input) => {
    ctx.saveSettings(mergeMcpServer(ctx.getSettings(), input));
    return listMcp();
  });
  handle(IPC.settingsMcpReconnect, (_event, id) => listMcp(id));
  handle(IPC.settingsMcpRemove, (_event, id) => {
    const settings = ctx.getSettings();
    ctx.saveSettings({
      ...settings,
      mcpServers: (settings.mcpServers ?? []).filter((server) => server.id !== id),
    });
    return listMcp();
  });
}
