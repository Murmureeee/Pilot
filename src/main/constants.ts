// @env node
import type { Locale } from "../shared/contract";

export const DESKTOP_BACKGROUND_COPY = {
  zh: { open: "打开 Pilot", quit: "退出 Pilot" },
  "zh-TW": { open: "開啟 Pilot", quit: "結束 Pilot" },
  en: { open: "Open Pilot", quit: "Quit Pilot" },
} satisfies Record<Locale, { open: string; quit: string }>;

export const DESKTOP_BACKGROUND_ERRORS = {
  closeToTray: "无法创建系统托盘图标。请检查桌面环境是否支持托盘，再重新开启。",
  globalComposerShortcut: "无法注册全局快捷键。请检查系统快捷键或其他应用的占用，再重新开启。",
} as const;

export const WINDOWS_APP_ID = "dev.pilot.app";
export const LEGACY_USER_DATA_DIRECTORIES = ["pi Desktop", "pi-desktop"] as const;
export const SESSION_TRANSCRIPT_EXTENSION = ".jsonl";
export const SESSION_FORMAT_VERSION = 1;
export const TRANSCRIPT_FORMAT_HEADER = "pilot_transcript";
export const SESSION_DRAFT_EXTENSION = ".draft.json";
export const SESSION_DRAFT_IMAGES_EXTENSION = ".draft-images.json";
export const NEW_CHAT_DRAFTS_FILE = "new-chat-drafts.json";
export const SESSION_FILE_ID = /^[a-z\d_-]+$/i;
export const SESSION_INDEX_SAVE_BLOCKED = "无法备份原会话索引，暂时不能保存会话索引。";
export const SETTINGS_FILE_NAME = "settings.json";
export const SETTINGS_FORMAT_VERSION = 1;
export const SETTINGS_SAVE_BLOCKED = "无法保存设置。请恢复原文件的访问权限后重试。";
export const STORAGE_UPGRADE_REQUIRED = "此数据文件来自较新版 Pilot。请升级 Pilot 后重试。";
export const WINDOW_STATE_FILE_NAME = "window-state.json";
export const DEFAULT_WINDOW_SIZE = { width: 1100, height: 750 } as const;
export const MINIMUM_WINDOW_SIZE = { width: 720, height: 480 } as const;
export const WINDOW_TITLE_BAR_HEIGHT = 38;
export const MINIMUM_VISIBLE_TITLE_BAR = { width: 120, height: 24 } as const;
export const WINDOW_STATE_SAVE_DELAY_MS = 250;

// 原生窗控与 src/renderer/src/assets/main.css 的窗口底色对齐。
export const TITLE_BAR_OVERLAY_COLORS = {
  light: { color: "#edf2f7", symbolColor: "#243448" },
  dark: { color: "#161e28", symbolColor: "#e4ebf4" },
} as const;

export const RENDERER_RECOVERY_MESSAGES = {
  zh: {
    unresponsive: "Pilot 界面未响应",
    crashed: "Pilot 界面进程已退出",
    outOfMemory: "Pilot 界面内存不足",
    detail: "重新加载界面后可以接着使用当前会话。正在运行的任务会继续。",
    reload: "重新加载",
  },
  "zh-TW": {
    unresponsive: "Pilot 介面沒有回應",
    crashed: "Pilot 介面程序已結束",
    outOfMemory: "Pilot 介面記憶體不足",
    detail: "重新載入介面後可繼續使用目前的對話。執行中的工作會繼續。",
    reload: "重新載入",
  },
  en: {
    unresponsive: "Pilot is not responding",
    crashed: "The Pilot interface process exited",
    outOfMemory: "The Pilot interface ran out of memory",
    detail: "Reload the interface to return to this chat. Running tasks will continue.",
    reload: "Reload",
  },
} as const;

export const APP_EXITING_MESSAGE = "应用正在退出。";
export const UPDATE_NOT_READY_MESSAGE = "没有已下载的更新。";
export const UPDATE_CHECK_STARTUP_DELAY_MS = 2_000;
export const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1_000;
export const INVALID_ENVIRONMENT_PROXY =
  "无法使用环境变量中的代理地址。请检查 HTTP_PROXY 或 HTTPS_PROXY 后重启 Pilot。";

export const NATIVE_EXIT_MESSAGES = {
  zh: {
    quit: { title: "退出 Pilot？", accept: "停止并退出" },
    closeWindow: { title: "关闭 Pilot 窗口？", accept: "停止并关闭" },
    update: { title: "安装更新并重启 Pilot？", accept: "停止并更新" },
    agent: "有任务在运行。",
    verification: "有验证命令在运行。",
    terminal: "有终端或后台命令在运行。",
    detail: "继续会停止运行中的操作并保存当前进度。",
    cancel: "取消",
    failed: "无法完成退出操作",
    failedDetail: "部分运行未能停止或保存。请重试或在设置中查看日志。",
    back: "返回 Pilot",
  },
  "zh-TW": {
    quit: { title: "結束 Pilot？", accept: "停止並結束" },
    closeWindow: { title: "關閉 Pilot 視窗？", accept: "停止並關閉" },
    update: { title: "安裝更新並重新啟動 Pilot？", accept: "停止並更新" },
    agent: "有工作正在執行。",
    verification: "有驗證指令正在執行。",
    terminal: "有終端機或背景指令正在執行。",
    detail: "繼續會停止執行中的操作並儲存目前的進度。",
    cancel: "取消",
    failed: "無法完成結束操作",
    failedDetail: "部分工作無法停止或儲存。請重試或在設定中檢視記錄。",
    back: "返回 Pilot",
  },
  en: {
    quit: { title: "Quit Pilot?", accept: "Stop and quit" },
    closeWindow: { title: "Close the Pilot window?", accept: "Stop and close" },
    update: { title: "Install the update and restart Pilot?", accept: "Stop and update" },
    agent: "A task is running.",
    verification: "Verification commands are running.",
    terminal: "A terminal or background command is running.",
    detail: "Continuing will stop the running work and save its progress.",
    cancel: "Cancel",
    failed: "Could not complete the exit",
    failedDetail:
      "Some work could not be stopped or saved. Try again or check the logs in Settings.",
    back: "Return to Pilot",
  },
} as const;

export const NATIVE_DIALOG_TITLES = {
  zh: {
    skill: "选择技能目录（须含 SKILL.md）",
    importProject: "选择导入来源项目",
    pluginDirectory: "选择插件文件夹",
    pluginZip: "选择插件 ZIP 压缩包",
    workingDirectory: "选择工具工作目录",
    openProject: "打开项目",
    bindProject: "关联项目",
    exportMarkdown: "导出 Markdown",
    exportDiagnostics: "导出脱敏诊断",
  },
  "zh-TW": {
    skill: "選擇技能資料夾（須包含 SKILL.md）",
    importProject: "選擇匯入來源專案",
    pluginDirectory: "選擇外掛資料夾",
    pluginZip: "選擇外掛 ZIP 壓縮檔",
    workingDirectory: "選擇工具工作目錄",
    openProject: "開啟專案",
    bindProject: "連結專案",
    exportMarkdown: "匯出 Markdown",
    exportDiagnostics: "匯出去識別化診斷資料",
  },
  en: {
    skill: "Choose a skill folder containing SKILL.md",
    importProject: "Choose a project to import from",
    pluginDirectory: "Choose a plugin folder",
    pluginZip: "Choose a plugin ZIP archive",
    workingDirectory: "Choose the tools’ working directory",
    openProject: "Open project",
    bindProject: "Link project",
    exportMarkdown: "Export Markdown",
    exportDiagnostics: "Export redacted diagnostics",
  },
} as const satisfies Record<
  Locale,
  {
    skill: string;
    importProject: string;
    pluginDirectory: string;
    pluginZip: string;
    workingDirectory: string;
    openProject: string;
    bindProject: string;
    exportMarkdown: string;
    exportDiagnostics: string;
  }
>;

export const PROJECT_ENTRY_ERROR = {
  zh: {
    message: "无法打开项目",
    detail: "请选择一个可访问的文件夹，或在终端运行 pilot <目录>。",
    close: "关闭",
  },
  "zh-TW": {
    message: "無法開啟專案",
    detail: "請選擇一個可存取的資料夾，或在終端機執行 pilot <目錄>。",
    close: "關閉",
  },
  en: {
    message: "Could not open the project",
    detail: "Choose one accessible folder, or run pilot <folder> in a terminal.",
    close: "Close",
  },
} as const;
