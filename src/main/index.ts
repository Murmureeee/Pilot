// @env node
import { existsSync, realpathSync } from "node:fs";
import { join } from "node:path";

import {
  BrowserWindow,
  Menu,
  app,
  dialog,
  nativeTheme,
  powerMonitor,
  session,
  shell,
} from "electron";

import { APP_NAME, DEFAULT_LOCALE } from "../shared/constants";
import {
  AGENT_EVENT_CHANNEL,
  TERMINAL_EVENT_CHANNEL,
  UPDATE_STATUS_CHANNEL,
} from "../shared/contract";
import { AgentHost } from "./agent-host/host";
import { McpManager } from "./agent-host/mcp";
import { McpOAuth } from "./agent-host/mcp/oauth";
import { SessionStore } from "./agent-host/session-store";
import { runAgentSmoke } from "./agent-host/smoke";
import { ProfileBackup } from "./backup";
import { BACKUP_COPY } from "./backup/constants";
import { applyPendingBackup } from "./backup/restore";
import {
  DEFAULT_WINDOW_SIZE,
  MINIMUM_WINDOW_SIZE,
  PROJECT_ENTRY_ERROR,
  TITLE_BAR_OVERLAY_COLORS,
  WINDOWS_APP_ID,
  WINDOW_STATE_FILE_NAME,
  WINDOW_TITLE_BAR_HEIGHT,
} from "./constants";
import { DesktopBackground } from "./desktop-background";
import { DesktopExit } from "./desktop-exit";
import { DiagnosticLog, errorDetails } from "./diagnostics";
import { logRendererConsole } from "./diagnostics/renderer";
import { registerIpc } from "./ipc";
import {
  getRendererLocale,
  isConversationVisible,
  registerRenderer,
  sendToRenderers,
} from "./ipc/transport";
import { createDesktopNetwork } from "./network";
import { registerPagePreview } from "./page-preview";
import { prepareUserDataDirectory } from "./profile";
import { afterTurnVerificationFor } from "./project-config";
import {
  applicationArguments,
  projectEntryArgument,
  projectEntryFromInstance,
} from "./project-entry";
import { ScheduledTasks } from "./scheduled-tasks";
import { getLogLevel, loadSettings, saveSettings } from "./settings";
import type { Settings } from "./settings/types";
import { createSleepBlocker } from "./sleep-blocker";
import { TaskNotifications } from "./task-notifications";
import { TerminalManager } from "./terminal";
import type { ProjectEntry } from "./types";
import { DesktopUpdater } from "./updater";
import { VerificationManager } from "./verification";
import { createSearchRequest, createWebRequest } from "./web/request";
import { revealWindow } from "./window";
import { registerWindowRecovery } from "./window-recovery";
import { loadWindowState, rememberWindow } from "./window-state";

const isDev = !app.isPackaged;

if (process.platform === "win32")
  app.setAppUserModelId(app.isPackaged ? WINDOWS_APP_ID : process.execPath);

// Phase 0 无窗冒烟：electron . --smoke → 跑通 pi Agent 即退出
async function runSmoke(): Promise<void> {
  const result = await runAgentSmoke();
  console.log(`SMOKE_RESULT ${JSON.stringify(result)}`);
  // An exit during the ready event can race Electron's startup threads on Windows.
  setTimeout(() => app.exit(result.ok ? 0 : 1), 0);
}

// FR-7.1：仅对打包产物注入 CSP；开发态由 Vite 服务，注入会破坏 HMR
const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self'";

function createWindow(log: DiagnosticLog, stateFile: string, iconPath: string): BrowserWindow {
  const iconOptions = existsSync(iconPath) ? { icon: iconPath } : {};
  const state = loadWindowState(stateFile);

  const win = new BrowserWindow({
    ...(state?.bounds ?? DEFAULT_WINDOW_SIZE),
    minWidth: MINIMUM_WINDOW_SIZE.width,
    minHeight: MINIMUM_WINDOW_SIZE.height,
    title: APP_NAME,
    backgroundColor: "#ffffff",
    ...iconOptions,
    titleBarStyle: "hidden",
    ...(process.platform === "darwin"
      ? { titleBarOverlay: true, trafficLightPosition: { x: 12, y: 12 } }
      : {
          titleBarOverlay: {
            ...TITLE_BAR_OVERLAY_COLORS[nativeTheme.shouldUseDarkColors ? "dark" : "light"],
            height: WINDOW_TITLE_BAR_HEIGHT,
          },
        }),
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
      webviewTag: true,
    },
  });
  rememberWindow(win, stateFile, log);
  if (state?.maximized) win.maximize();
  registerRenderer(win.webContents);
  registerPagePreview(win.webContents);
  registerWindowRecovery(win, log);

  // Dev startup checks consume the console marker. Packaged diagnostics store metadata only.
  win.webContents.on("console-message", (event) => {
    logRendererConsole(log, event);
    if (isDev) console.log(`[renderer] ${event.message} (${event.sourceId}:${event.lineNumber})`);
  });
  win.webContents.on("preload-error", (_event, _path, error) => {
    log.write("error", "renderer", "preload-error", errorDetails(error));
  });
  // dev 快捷键：F12 开关 DevTools（应用菜单已移除，默认快捷键失效）
  if (isDev) {
    win.webContents.on("before-input-event", (_event, input) => {
      if (input.type === "keyDown" && input.key === "F12") {
        if (win.webContents.isDevToolsOpened()) {
          win.webContents.closeDevTools();
        } else {
          win.webContents.openDevTools({ mode: "detach" });
        }
      }
    });
  }

  // 所有新窗口一律拒绝，http(s) 交给系统默认浏览器
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });

  // 禁止页面级导航（应用是 SPA，导航只可能是意外或攻击）
  win.webContents.on("will-navigate", (event) => {
    event.preventDefault();
  });

  const load =
    isDev && process.env.ELECTRON_RENDERER_URL
      ? win.loadURL(process.env.ELECTRON_RENDERER_URL)
      : win.loadFile(join(__dirname, "../renderer/index.html"));
  void load.catch((error: unknown) => {
    const details = errorDetails(error);
    if (details.code !== "ERR_ABORTED") log.write("error", "renderer", "load-failed", details);
  });
  return win;
}

function startDesktop(): (entry: ProjectEntry) => void {
  // 无边框设计：移除默认应用菜单（File/Edit/View/Window）
  Menu.setApplicationMenu(null);

  const userData = app.getPath("userData");
  const restored = applyPendingBackup(userData);
  if (restored?.status === "blocked") {
    const copy = BACKUP_COPY[restored.locale];
    void dialog
      .showMessageBox({
        type: "error",
        title: APP_NAME,
        message: copy.failed,
        detail: copy.blocked + "\n" + userData,
        buttons: [copy.close],
      })
      .then(
        () => app.exit(1),
        () => app.exit(1),
      );
    return () => {};
  }
  const sessionsDir = join(userData, "sessions");
  const skillsDir = join(userData, "skills");
  const logsDir = join(userData, "logs");
  const windowState = join(userData, WINDOW_STATE_FILE_NAME);
  const iconPath = join(
    isDev ? join(app.getAppPath(), "resources") : process.resourcesPath,
    "icon.png",
  );
  const getSettings = (): ReturnType<typeof loadSettings> => loadSettings(userData);
  const initialSettings = getSettings();
  const log = new DiagnosticLog(logsDir, getLogLevel(initialSettings));
  log.startRun(app.getVersion());
  process.on("uncaughtExceptionMonitor", (error) => {
    log.write("error", "main", "uncaught-exception", errorDetails(error));
  });
  app.on("child-process-gone", (_event, { type, reason, exitCode }) => {
    if (reason !== "clean-exit")
      log.write("error", "child", "process-gone", { reason, code: exitCode, processType: type });
  });
  const setSleepBlocked = createSleepBlocker(log);
  app.once("will-quit", () => {
    setSleepBlocked(false);
    log.finishRun();
  });

  const persistSettings = (settings: Settings): void => {
    saveSettings(userData, settings);
    log.setLevel(getLogLevel(settings));
    notifications.setEnabled(settings.notificationsEnabled !== false);
    updater.setAutoDownload(settings.autoDownloadUpdates !== false);
  };
  const store = new SessionStore(sessionsDir);
  const syncSleepBlocker = (): void =>
    setSleepBlocked(
      host.hasActiveRun() || verification.hasActiveRuns() || terminal.hasActiveProcesses(),
    );
  const terminal = new TerminalManager(
    (event) => sendToRenderers(TERMINAL_EVENT_CHANNEL, event),
    syncSleepBlocker,
  );
  const verification = new VerificationManager(
    join(sessionsDir, "verification"),
    (result) => sendToRenderers(AGENT_EVENT_CHANNEL, { type: "verification_updated", result }),
    syncSleepBlocker,
  );
  const networkSession = session.fromPartition("pilot-network", { cache: false });
  const network = createDesktopNetwork(networkSession);
  const webRequest = createWebRequest(
    async (url) => {
      await network.configureProxy(networkSession);
      return networkSession.resolveProxy(url.href);
    },
    APP_NAME + "/" + app.getVersion(),
  );
  const mcp = new McpManager(
    getSettings,
    app.getVersion(),
    network.fetch,
    new McpOAuth({
      getSettings,
      saveSettings: persistSettings,
      request: network.fetch,
      openBrowser: (url) => shell.openExternal(url),
    }),
  );
  const host = new AgentHost({
    store,
    worktreesDir: join(userData, "worktrees"),
    hasWorkspaceProcesses: (directory) =>
      terminal.hasActiveProcesses(directory) || verification.hasActiveRuns(directory),
    getSettings,
    saveSettings: persistSettings,
    broadcast: (event) => {
      if (event.type === "error") log.write("error", "main", "agent-error");
      sendToRenderers(AGENT_EVENT_CHANNEL, event);
      notifications.handleEvent(event);
    },
    onActivityChanged: syncSleepBlocker,
    onTurnCompleted: (sessionId, directory, task, projectFingerprint) => {
      const config = afterTurnVerificationFor(getSettings(), directory, projectFingerprint);
      if (!config) return;
      verification.afterTurn({ ...config, sessionId, workingDirectory: directory, task }, () => {
        try {
          exit.checkWorkAllowed();
          const current = afterTurnVerificationFor(getSettings(), directory, projectFingerprint);
          return (
            current?.shell === config.shell &&
            current.kind === config.kind &&
            current.command === config.command
          );
        } catch {
          return false;
        }
      });
    },
    skillsDir,
    mcp,
    terminal,
    request: network.fetch,
    webRequests: { page: webRequest, search: createSearchRequest(network.fetch) },
  });

  if (!isDev) {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: { ...details.responseHeaders, "Content-Security-Policy": [CSP] },
      });
    });
  }

  const updater = new DesktopUpdater(
    (event) => sendToRenderers(UPDATE_STATUS_CHANNEL, event),
    log,
    network.configureProxy,
    initialSettings.autoDownloadUpdates !== false,
  );
  app.once("will-quit", () => updater.stopPeriodicChecks());
  let mainWindow: BrowserWindow | undefined;
  const exit = new DesktopExit({
    getWindow: () => mainWindow,
    hideToTray: (window) => background.hideWindow(window),
    host,
    verification,
    terminal,
    mcp,
    updater,
    log,
  });
  const notifications = new TaskNotifications({
    enabled: initialSettings.notificationsEnabled !== false,
    getWindow: () => mainWindow,
    getLocale: () =>
      mainWindow && !mainWindow.isDestroyed()
        ? getRendererLocale(mainWindow.webContents)
        : DEFAULT_LOCALE,
    getVisibleSessionId: () =>
      mainWindow &&
      !mainWindow.isDestroyed() &&
      !mainWindow.isMinimized() &&
      mainWindow.isFocused() &&
      isConversationVisible(mainWindow.webContents)
        ? host.selectedSessionId()
        : null,
    getSession: (id) => store.getMeta(id),
    setUnread: (id, unread) => void host.unreadSession(id, unread),
    openSession: (id) => {
      if (exit.isExiting() || !store.getMeta(id)) return;
      const window = getMainWindow();
      host.revealSession(id);
      revealWindow(window);
    },
    reportError: (action) => log.write("warn", "main", `task-notification-${action}`),
  });
  app.once("will-quit", () => notifications.dispose());
  const scheduledTasks = new ScheduledTasks({
    file: join(userData, "scheduled-tasks.json"),
    run: (task, id) => {
      exit.checkWorkAllowed();
      return host.runScheduledTask(id, task.title, task.directory, task.prompt);
    },
    settled: (id) => ({
      status: store.getMeta(id)?.lastRunResult,
      error: store.checkpoint(id)?.failure?.detail,
    }),
    reportError: () => log.write("warn", "main", "scheduled-task-storage"),
  });
  scheduledTasks.start();
  const resumeSchedules = (): void => scheduledTasks.resume();
  powerMonitor.on("resume", resumeSchedules);
  app.once("will-quit", () => {
    powerMonitor.removeListener("resume", resumeSchedules);
    scheduledTasks.stop();
  });
  const background = new DesktopBackground({
    iconPath,
    getSettings,
    saveSettings: persistSettings,
    reveal: () => {
      if (exit.isExiting()) return undefined;
      const window = getMainWindow();
      revealWindow(window);
      return window;
    },
    focusComposer: () => host.publishSnapshot("reveal"),
    getLocale: () =>
      mainWindow && !mainWindow.isDestroyed()
        ? getRendererLocale(mainWindow.webContents)
        : DEFAULT_LOCALE,
    log,
  });
  app.once("will-quit", () => background.dispose());
  registerIpc({
    scheduledTasks,
    settingsDir: userData,
    sessionsDir,
    skillsDir,
    logsDir,
    log,
    getSettings,
    saveSettings: persistSettings,
    onConversationVisibilityChanged: () => notifications.sync(),
    request: network.fetch,
    host,
    mcp,
    updater,
    verification,
    terminal,
    exit,
    background,
    backup: new ProfileBackup(userData),
    backupResult: restored ? { status: restored.status, credentials: restored.credentials } : null,
    isDev,
  });
  const getMainWindow = (): BrowserWindow => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      mainWindow = createWindow(log, windowState, iconPath);
      exit.watchWindow(mainWindow);
      notifications.watchWindow(mainWindow);
    }
    return mainWindow;
  };
  app.on("activate", () => {
    if (!exit.isExiting()) getMainWindow();
  });
  getMainWindow();
  background.start();

  updater.startPeriodicChecks();
  return (entry) => {
    if (exit.isExiting()) return;
    const window = getMainWindow();
    revealWindow(window);
    if (entry === undefined) return;
    try {
      exit.checkWorkAllowed();
      if (entry === null) throw new Error("Invalid project argument");
      host.openProject(entry, "reveal");
    } catch {
      const copy = PROJECT_ENTRY_ERROR[getRendererLocale(window.webContents)];
      void dialog
        .showMessageBox(window, {
          type: "warning",
          title: APP_NAME,
          message: copy.message,
          detail: copy.detail,
          buttons: [copy.close],
        })
        .catch(() => log.write("warn", "main", "show-project-entry-error"));
    }
  };
}

// 开发态屏蔽 Electron 的 CSP 安全告警（CSP 仅在生产注入，见上）
if (isDev) {
  process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = "true";
}

const args = applicationArguments(process.argv, process.defaultApp === true);
const firstEntryFlag = args.find(
  (argument) =>
    argument === "--" ||
    argument === "--open-project" ||
    argument.startsWith("--open-project=") ||
    argument === "--smoke",
);
if (firstEntryFlag === "--smoke") {
  void app.whenReady().then(runSmoke);
} else {
  const requestedProfile = app.commandLine.getSwitchValue("user-data-dir")
    ? app.getPath("userData")
    : prepareUserDataDirectory(app.getPath("appData"));
  // Windows 按路径寻找已运行的实例，目录联接也需要解析到同一个实际目录。
  const profile = realpathSync.native(requestedProfile);
  app.setPath("userData", profile);
  app.setPath("sessionData", profile);

  const project = projectEntryArgument(args, process.cwd());
  if (app.requestSingleInstanceLock(project === undefined ? {} : { project })) {
    // A second launch can arrive before settings and the project host are available.
    const pending: ProjectEntry[] = project === undefined ? [] : [project];
    let open = (entry: ProjectEntry): void => {
      pending.push(entry);
    };
    app.on("second-instance", (_event, _commandLine, _workingDirectory, data) =>
      open(projectEntryFromInstance(data)),
    );
    app.once("ready", () => {
      open = startDesktop();
      for (const entry of pending.splice(0)) open(entry);
    });
    app.on("window-all-closed", () => {
      if (process.platform !== "darwin") app.quit();
    });
  } else {
    app.exit(0);
  }
}
