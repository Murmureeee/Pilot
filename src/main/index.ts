// @env node
import { existsSync, realpathSync } from "node:fs";
import { join } from "node:path";

import { BrowserWindow, Menu, app, nativeTheme, session, shell } from "electron";

import { APP_NAME, DEFAULT_LOCALE } from "../shared/constants";
import {
  AGENT_EVENT_CHANNEL,
  TERMINAL_EVENT_CHANNEL,
  UPDATE_STATUS_CHANNEL,
} from "../shared/contract";
import { AgentHost } from "./agent-host/host";
import { McpManager } from "./agent-host/mcp";
import { SessionStore } from "./agent-host/session-store";
import { runAgentSmoke } from "./agent-host/smoke";
import {
  DEFAULT_WINDOW_SIZE,
  MINIMUM_WINDOW_SIZE,
  TITLE_BAR_OVERLAY_COLORS,
  WINDOWS_APP_ID,
  WINDOW_STATE_FILE_NAME,
  WINDOW_TITLE_BAR_HEIGHT,
} from "./constants";
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
import { prepareUserDataDirectory } from "./profile";
import { getLogLevel, loadSettings, saveSettings } from "./settings";
import type { Settings } from "./settings/types";
import { createSleepBlocker } from "./sleep-blocker";
import { TaskNotifications } from "./task-notifications";
import { TerminalManager } from "./terminal";
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

function createWindow(log: DiagnosticLog, stateFile: string): BrowserWindow {
  const iconDir = isDev ? join(app.getAppPath(), "resources") : process.resourcesPath;
  const iconPath = join(iconDir, "icon.png");
  const iconOptions = existsSync(iconPath) ? { icon: iconPath } : {};
  const state = loadWindowState(stateFile);

  const win = new BrowserWindow({
    ...(state?.bounds ?? DEFAULT_WINDOW_SIZE),
    minWidth: MINIMUM_WINDOW_SIZE.width,
    minHeight: MINIMUM_WINDOW_SIZE.height,
    title: APP_NAME,
    backgroundColor: "#ffffff",
    ...iconOptions,
    // 无边框自定义标题栏：保留系统原生窗控按钮（Win11 风格 overlay），标题区由应用绘制
    titleBarStyle: "hidden",
    titleBarOverlay: {
      ...TITLE_BAR_OVERLAY_COLORS[nativeTheme.shouldUseDarkColors ? "dark" : "light"],
      height: WINDOW_TITLE_BAR_HEIGHT,
    },
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });
  rememberWindow(win, stateFile, log);
  if (state?.maximized) win.maximize();
  registerRenderer(win.webContents);
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

function startDesktop(): void {
  // 无边框设计：移除默认应用菜单（File/Edit/View/Window）
  Menu.setApplicationMenu(null);

  const userData = app.getPath("userData");
  const sessionsDir = join(userData, "sessions");
  const skillsDir = join(userData, "skills");
  const logsDir = join(userData, "logs");
  const windowState = join(userData, WINDOW_STATE_FILE_NAME);
  const getSettings = (): ReturnType<typeof loadSettings> => loadSettings(userData);
  const initialSettings = getSettings();
  const log = new DiagnosticLog(logsDir, getLogLevel(initialSettings));
  log.write("info", "main", "startup", { version: app.getVersion() });
  process.on("uncaughtExceptionMonitor", (error) => {
    log.write("error", "main", "uncaught-exception", errorDetails(error));
  });
  const setSleepBlocked = createSleepBlocker(log);
  app.once("will-quit", () => {
    setSleepBlocked(false);
    log.write("info", "main", "quit");
  });

  const persistSettings = (settings: Settings): void => {
    saveSettings(userData, settings);
    log.setLevel(getLogLevel(settings));
    notifications.setEnabled(settings.notificationsEnabled !== false);
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
  const mcp = new McpManager(getSettings, app.getVersion(), network.fetch);
  const host = new AgentHost({
    store,
    getSettings,
    saveSettings: persistSettings,
    broadcast: (event) => {
      if (event.type === "error") log.write("error", "main", "agent-error");
      sendToRenderers(AGENT_EVENT_CHANNEL, event);
      notifications.handleEvent(event);
    },
    onActivityChanged: syncSleepBlocker,
    onTurnCompleted: (sessionId, directory, task) => {
      const config = getSettings().afterTurnVerification?.[directory];
      if (!config) return;
      verification.afterTurn({ ...config, sessionId, workingDirectory: directory, task }, () => {
        try {
          exit.checkWorkAllowed();
          const current = getSettings().afterTurnVerification?.[directory];
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
  );
  let mainWindow: BrowserWindow | undefined;
  const exit = new DesktopExit({
    getWindow: () => mainWindow,
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
    reportError: (action) => log.write("warn", "main", "task-notification-" + action),
  });
  app.once("will-quit", () => notifications.dispose());
  registerIpc({
    settingsDir: userData,
    sessionsDir,
    skillsDir,
    logsDir,
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
    isDev,
  });
  const getMainWindow = (): BrowserWindow => {
    if (!mainWindow || mainWindow.isDestroyed()) {
      mainWindow = createWindow(log, windowState);
      exit.watchWindow(mainWindow);
      notifications.watchWindow(mainWindow);
    }
    return mainWindow;
  };
  app.on("second-instance", () => {
    if (!exit.isExiting()) revealWindow(getMainWindow());
  });
  app.on("activate", () => {
    if (!exit.isExiting()) getMainWindow();
  });
  getMainWindow();

  setTimeout(() => void updater.check(), 2000).unref();
}

// 开发态屏蔽 Electron 的 CSP 安全告警（CSP 仅在生产注入，见上）
if (isDev) {
  process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = "true";
}

if (process.argv.includes("--smoke")) {
  void app.whenReady().then(runSmoke);
} else {
  const requestedProfile = app.commandLine.getSwitchValue("user-data-dir")
    ? app.getPath("userData")
    : prepareUserDataDirectory(app.getPath("appData"));
  // Windows 按路径寻找已运行的实例，目录联接也需要解析到同一个实际目录。
  const profile = realpathSync.native(requestedProfile);
  app.setPath("userData", profile);
  app.setPath("sessionData", profile);

  if (app.requestSingleInstanceLock()) {
    app.once("ready", startDesktop);
    app.on("window-all-closed", () => {
      if (process.platform !== "darwin") app.quit();
    });
  } else {
    app.exit(0);
  }
}
