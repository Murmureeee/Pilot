// @env node
import { existsSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import {
  BrowserWindow,
  app,
  dialog,
  ipcMain,
  nativeTheme,
  shell,
  type IpcMainInvokeEvent,
  type WebContents,
} from "electron";
import type {
  MenuAction,
  OpenPathTarget,
  PingResponse,
  ProviderInput,
  UiAgentEvent,
} from "@shared/contract";
import { AGENT_EVENT_CHANNEL, IPC } from "@shared/contract";
import type { AgentHost } from "./agent-host/host";
import type { McpManager } from "./agent-host/mcp";
import { listModels, resolveProviderRef, testProvider } from "./agent-host/models";
import {
  decryptSecret,
  encryptSecret,
  loadSettings,
  mergeSettingsInput,
  saveSettings,
  toPublicSettings,
  validateSettingsInput,
} from "./agent-host/settings";
import { importSkill, scanSkills } from "./agent-host/skills";
import { runAgentSmoke } from "./agent-host/smoke";
import { searchWorkspace } from "./agent-host/workspace";
import { TITLE_BAR_OVERLAY_COLORS } from "./constants";
import {
  importedPlugins,
  importExternal,
  previewExternalImport,
  toggleImportedPlugin,
} from "./external-import";
import { directory } from "./external-import/files";
import type { ImportLocations } from "./external-import/types";
import type { IpcChannel } from "./ipc/types";
import { parseIpcArgs } from "./ipc/validation";
import type { DesktopUpdater } from "./updater";

export interface IpcContext {
  settingsDir: string;
  sessionsDir: string;
  skillsDir: string;
  getSettings: () => ReturnType<typeof loadSettings>;
  host: AgentHost;
  mcp: McpManager;
  updater: DesktopUpdater;
  isDev: boolean;
}

function broadcast(event: UiAgentEvent): void {
  for (const win of BrowserWindow.getAllWindows()) {
    win.webContents.send(AGENT_EVENT_CHANNEL, event);
  }
}

/** 菜单动作白名单实现（渲染层传来的 action 必须命中此表） */
const MENU_ACTIONS: Record<MenuAction, (wc: WebContents) => void> = {
  undo: (wc) => wc.undo(),
  redo: (wc) => wc.redo(),
  cut: (wc) => wc.cut(),
  copy: (wc) => wc.copy(),
  paste: (wc) => wc.paste(),
  delete: (wc) => wc.delete(),
  "select-all": (wc) => wc.selectAll(),
  "zoom-in": (wc) => {
    wc.zoomLevel = Math.min(5, wc.zoomLevel + 0.5);
  },
  "zoom-out": (wc) => {
    wc.zoomLevel = Math.max(-3, wc.zoomLevel - 0.5);
  },
  "zoom-reset": (wc) => {
    wc.zoomLevel = 0;
  },
  reload: (wc) => wc.reload(),
  fullscreen: (wc) => {
    const win = BrowserWindow.fromWebContents(wc);
    win?.setFullScreen(!win.isFullScreen());
  },
  close: (wc) => {
    BrowserWindow.fromWebContents(wc)?.close();
  },
  quit: () => app.quit(),
};

export function registerIpc(ctx: IpcContext): void {
  const handle = <C extends IpcChannel>(
    channel: C,
    listener: (event: IpcMainInvokeEvent, ...args: ReturnType<typeof parseIpcArgs<C>>) => unknown,
  ): void => {
    ipcMain.handle(channel, (event, ...args: unknown[]) =>
      listener(event, ...parseIpcArgs(channel, args)),
    );
  };

  handle(IPC.ping, (_event, request): PingResponse => {
    return { payload: `pong: ${request.payload}`, receivedAt: Date.now() };
  });

  handle(IPC.runAgentSmoke, () => runAgentSmoke());

  handle(IPC.appInfo, () => ({
    version: app.getVersion(),
    isDev: ctx.isDev,
    isWindows: process.platform === "win32",
    settingsDir: ctx.settingsDir,
    sessionsDir: ctx.sessionsDir,
  }));
  handle(IPC.appOpenPath, (_event, target) => {
    const dirs: Record<OpenPathTarget, string> = {
      settings: ctx.settingsDir,
      sessions: ctx.sessionsDir,
      skills: ctx.skillsDir,
    };
    return shell.openPath(dirs[target]);
  });
  handle(IPC.appSetTitlebarTheme, (event, theme) => {
    // 无边框窗口的原生窗控颜色跟随主题（Linux 无 titleBarOverlay，静默忽略）
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return;
    const dark = theme === "dark" || (theme === "system" && nativeTheme.shouldUseDarkColors);
    try {
      win.setTitleBarOverlay(TITLE_BAR_OVERLAY_COLORS[dark ? "dark" : "light"]);
    } catch {
      // 平台不支持 setTitleBarOverlay：保持创建时的颜色
    }
  });
  handle(IPC.menuAction, (event, action) => {
    MENU_ACTIONS[action](event.sender);
  });
  handle(IPC.appGetUpdateStatus, () => ctx.updater.getStatus());
  handle(IPC.appCheckForUpdates, () => ctx.updater.check());
  handle(IPC.appInstallUpdate, () => {
    if (ctx.host.getSnapshot().status !== "idle") {
      throw new Error("请等待当前任务结束后再安装更新。");
    }
    ctx.updater.install();
  });

  handle(IPC.agentGetSnapshot, () => ctx.host.getSnapshot());
  handle(IPC.agentSearchWorkspace, (_event, query) =>
    searchWorkspace(ctx.getSettings().workingDirectory, query),
  );
  handle(IPC.agentPrompt, (_event, text, referenceDirectory) => {
    if (
      referenceDirectory !== undefined &&
      !ctx.host.acceptsReferenceDirectory(referenceDirectory)
    ) {
      throw new Error("工作目录已变更，请重新选择文件引用。");
    }
    // 不 await：结果通过事件流推送
    void ctx.host.prompt(text);
  });
  handle(IPC.agentAbort, () => ctx.host.abort());

  handle(IPC.sessionNew, () => ctx.host.newSession());
  handle(IPC.sessionLoad, (_event, id) => ctx.host.loadSession(id));
  handle(IPC.sessionRename, (_event, id, title) =>
    ctx.host.renameSession(id, title.trim().slice(0, 100)),
  );
  handle(IPC.sessionDelete, (_event, id) => ctx.host.deleteSession(id));
  handle(IPC.sessionPin, (_event, id, pinned) => ctx.host.pinSession(id, pinned));
  handle(IPC.sessionArchive, (_event, id, archived) => ctx.host.archiveSession(id, archived));
  handle(IPC.sessionUnread, (_event, id, unread) => ctx.host.unreadSession(id, unread));
  handle(IPC.sessionFork, (_event, id) => ctx.host.forkSession(id));
  handle(IPC.sessionCopy, (_event, id) => ctx.host.copySession(id));
  handle(IPC.sessionPersona, (_event, id, persona) => ctx.host.setSessionPersona(id, persona));

  // ------------------------------------------------ 技能（FR-5.8）
  const skillList = () => {
    const settings = ctx.getSettings();
    return scanSkills(ctx.skillsDir, settings.skillsEnabled ?? []);
  };
  handle(IPC.skillsList, () => skillList());
  // 主进程弹目录选择框（渲染层无文件系统权限），取消返回 null
  handle(IPC.skillsImport, async (_event, locale) => {
    const result = await dialog.showOpenDialog({
      title:
        locale === "en"
          ? "Choose a skill folder containing SKILL.md"
          : "选择技能目录（须含 SKILL.md）",
      properties: ["openDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    importSkill(result.filePaths[0], ctx.skillsDir);
    return skillList();
  });
  handle(IPC.skillsToggle, (_event, id, enabled) => {
    const settings = ctx.getSettings();
    const current = new Set(settings.skillsEnabled ?? []);
    if (enabled) current.add(id);
    else current.delete(id);
    saveSettings(ctx.settingsDir, { ...settings, skillsEnabled: [...current] });
    return skillList();
  });

  handle(IPC.agentClearQueue, () => ctx.host.clearQueue());

  handle(IPC.toolPermissionRespond, (_event, requestId, decision) =>
    ctx.host.respondPermission(requestId, decision),
  );

  handle(IPC.settingsGet, () => toPublicSettings(ctx.getSettings()));
  handle(IPC.settingsImportedPlugins, () => importedPlugins(ctx.getSettings(), ctx.skillsDir));
  const importLocations = (project: string | null): ImportLocations => {
    const workspace = project && isAbsolute(project) ? directory(project) : undefined;
    if (project && !workspace) throw new Error("无法读取所选项目目录。");
    const home = app.getPath("home");
    const codexHome = process.env.CODEX_HOME || join(home, ".codex");
    const claudeHome = process.env.CLAUDE_CONFIG_DIR || join(home, ".claude");
    const customClaudeConfig = join(claudeHome, ".claude.json");
    return {
      home,
      codexHome,
      claudeHome,
      claudeConfig: existsSync(customClaudeConfig)
        ? customClaudeConfig
        : join(home, ".claude.json"),
      workspace,
      settingsDir: ctx.settingsDir,
      skillsDir: ctx.skillsDir,
    };
  };
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
    if (report.skills || report.plugins || report.servers) saveSettings(ctx.settingsDir, settings);
    return report;
  });
  handle(IPC.settingsToggleImportedPlugin, async (_event, id, enabled) => {
    const current = ctx.getSettings();
    const settings = toggleImportedPlugin(current, id, enabled);
    if (current !== settings) {
      saveSettings(ctx.settingsDir, settings);
      await ctx.mcp.list();
    }
    return importedPlugins(ctx.getSettings(), ctx.skillsDir);
  });
  handle(IPC.settingsPickImportDirectory, async (_event, locale) => {
    const result = await dialog.showOpenDialog({
      title: locale === "en" ? "Choose a project to import from" : "选择导入来源项目",
      defaultPath: ctx.getSettings().workingDirectory ?? app.getPath("home"),
      properties: ["openDirectory"],
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
  handle(IPC.settingsMcpList, () => ctx.mcp.list());
  handle(IPC.settingsMcpSave, (_event, { env, headers, transport, ...config }) => {
    const settings = ctx.getSettings();
    const previous = settings.mcpServers?.find((server) => server.id === config.id);
    const connection = transport ?? previous?.transport;
    if (!connection) throw new Error("请填写 MCP 连接信息。");
    const sameConnection =
      !transport ||
      (!previous?.encryptedImport &&
        JSON.stringify(previous?.transport) === JSON.stringify(transport));
    const encryptedImport = sameConnection ? previous?.encryptedImport : undefined;
    const secret = (pairs: [string, string][] | undefined, prior?: string): string | undefined =>
      pairs === undefined
        ? sameConnection
          ? prior
          : undefined
        : pairs.length || encryptedImport
          ? encryptSecret(JSON.stringify(pairs), true)
          : undefined;
    const saved = {
      ...config,
      name: config.name.trim(),
      transport: connection,
      encryptedImport,
      importKey: previous?.importKey,
      encryptedEnv: connection.type === "stdio" ? secret(env, previous?.encryptedEnv) : undefined,
      encryptedHeaders:
        connection.type === "http" ? secret(headers, previous?.encryptedHeaders) : undefined,
    };
    const servers = settings.mcpServers ?? [];
    saveSettings(ctx.settingsDir, {
      ...settings,
      mcpServers: previous
        ? servers.map((server) => (server.id === saved.id ? saved : server))
        : [...servers, saved],
    });
    return ctx.mcp.list();
  });
  handle(IPC.settingsMcpReconnect, (_event, id) => ctx.mcp.list(id));
  handle(IPC.settingsMcpRemove, (_event, id) => {
    const settings = ctx.getSettings();
    saveSettings(ctx.settingsDir, {
      ...settings,
      mcpServers: (settings.mcpServers ?? []).filter((server) => server.id !== id),
    });
    return ctx.mcp.list();
  });
  handle(IPC.settingsPickWorkingDirectory, async (_event, locale) => {
    const result = await dialog.showOpenDialog({
      title: locale === "en" ? "Choose the tools’ working directory" : "选择工具工作目录",
      defaultPath: ctx.getSettings().workingDirectory ?? app.getPath("home"),
      properties: ["openDirectory"],
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
  // ref = 已保存 provider id（string，key 从存储解密）或未保存草稿（ProviderInput，FR-5.7 向导）
  const providerRef = (ref: string | ProviderInput): ReturnType<typeof resolveProviderRef> => {
    const { providers } = ctx.getSettings();
    return resolveProviderRef(ref, (id) => providers.find((p) => p.id === id), decryptSecret);
  };
  handle(IPC.settingsModelCatalog, (_event, ref) => {
    const { cfg, key } = providerRef(ref);
    return listModels(cfg, key);
  });
  handle(IPC.settingsTestProvider, (_event, ref) => {
    const { cfg, key } = providerRef(ref);
    return testProvider(cfg, key);
  });
  handle(IPC.settingsSave, (_event, input) => {
    const invalid = validateSettingsInput(input);
    if (invalid) throw new Error(invalid);
    const merged = mergeSettingsInput(ctx.getSettings(), input);
    saveSettings(ctx.settingsDir, merged);
    // 思考强度运行时同步到当前 Agent（provider/权限模式由各自通道/下次 prompt 生效）
    if (input.thinkingLevel) ctx.host.setThinkingLevel(input.thinkingLevel);
    return toPublicSettings(merged);
  });
}

export { broadcast };
