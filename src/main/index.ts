// @env node
import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { BrowserWindow, Menu, app, nativeTheme, session, shell } from "electron";
import { APP_NAME } from "../shared/constants";
import { AgentHost } from "./agent-host/host";
import { McpManager } from "./agent-host/mcp";
import { SessionStore } from "./agent-host/session-store";
import { loadSettings, saveSettings } from "./agent-host/settings";
import { broadcast, registerIpc } from "./ipc";
import { runAgentSmoke } from "./agent-host/smoke";
import { TITLE_BAR_OVERLAY_COLORS, USER_DATA_DIRECTORY } from "./constants";
import { DesktopUpdater } from "./updater";

const isDev = !app.isPackaged;

if (!app.commandLine.getSwitchValue("user-data-dir")) {
  const profile = join(app.getPath("appData"), USER_DATA_DIRECTORY);
  mkdirSync(profile, { recursive: true });
  app.setPath("userData", profile);
  app.setPath("sessionData", profile);
}

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

function createWindow(): BrowserWindow {
  const iconDir = isDev ? join(app.getAppPath(), "resources") : process.resourcesPath;
  const iconPath = join(iconDir, "icon.png");
  const iconOptions = existsSync(iconPath) ? { icon: iconPath } : {};

  const win = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 720,
    minHeight: 480,
    title: APP_NAME,
    backgroundColor: "#ffffff",
    ...iconOptions,
    // 无边框自定义标题栏：保留系统原生窗控按钮（Win11 风格 overlay），标题区由应用绘制
    titleBarStyle: "hidden",
    titleBarOverlay: {
      ...TITLE_BAR_OVERLAY_COLORS[nativeTheme.shouldUseDarkColors ? "dark" : "light"],
      height: 38,
    },
    webPreferences: {
      preload: join(__dirname, "../preload/index.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      webSecurity: true,
    },
  });

  // 渲染层 console 转发到主进程日志（FR-9.1 种子；dev 排障必需）
  win.webContents.on("console-message", (event) => {
    const e = event as unknown as { message?: string; lineNumber?: number; sourceId?: string };
    console.log(
      `[renderer] ${e.message ?? String(event)} (${e.sourceId ?? "?"}:${e.lineNumber ?? "?"})`,
    );
  });
  win.webContents.on("render-process-gone", (_e, details) => {
    console.error(`[renderer] process gone: ${details.reason}`);
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

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    void win.loadFile(join(__dirname, "../renderer/index.html"));
  }
  return win;
}

app.whenReady().then(() => {
  if (process.argv.includes("--smoke")) {
    void runSmoke();
    return;
  }

  // 无边框设计：移除默认应用菜单（File/Edit/View/Window）
  Menu.setApplicationMenu(null);

  const userData = app.getPath("userData");
  const sessionsDir = join(userData, "sessions");
  const skillsDir = join(userData, "skills");
  const store = new SessionStore(sessionsDir);
  const getSettings = (): ReturnType<typeof loadSettings> => loadSettings(userData);
  const mcp = new McpManager(getSettings, app.getVersion());
  const host = new AgentHost({
    store,
    getSettings,
    saveSettings: (settings) => saveSettings(userData, settings),
    broadcast,
    skillsDir,
    mcp,
  });

  if (!isDev) {
    session.defaultSession.webRequest.onHeadersReceived((details, callback) => {
      callback({
        responseHeaders: { ...details.responseHeaders, "Content-Security-Policy": [CSP] },
      });
    });
  }

  const updater = new DesktopUpdater();
  registerIpc({
    settingsDir: userData,
    sessionsDir,
    skillsDir,
    getSettings,
    host,
    mcp,
    updater,
    isDev,
  });
  createWindow();
  app.once("before-quit", (event) => {
    event.preventDefault();
    void mcp.close().finally(() => app.quit());
  });
  setTimeout(() => void updater.check(), 2000).unref();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

// 开发态屏蔽 Electron 的 CSP 安全告警（CSP 仅在生产注入，见上）
if (isDev) {
  process.env.ELECTRON_DISABLE_SECURITY_WARNINGS = "true";
}
