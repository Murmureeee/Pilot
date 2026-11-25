// @env node
import type { Locale } from "../shared/contract";

export const WINDOWS_APP_ID = "dev.pilot.app";
export const LEGACY_USER_DATA_DIRECTORIES = ["pi Desktop", "pi-desktop"] as const;
export const SESSION_TRANSCRIPT_EXTENSION = ".jsonl";
export const SESSION_DRAFT_EXTENSION = ".draft.json";
export const SESSION_DRAFT_IMAGES_EXTENSION = ".draft-images.json";
export const NEW_CHAT_DRAFTS_FILE = "new-chat-drafts.json";
export const SESSION_FILE_ID = /^[a-z\d_-]+$/i;
export const SESSION_INDEX_SAVE_BLOCKED = "无法备份原会话索引，暂时不能保存会话索引。";
export const SETTINGS_FILE_NAME = "settings.json";
export const SETTINGS_SAVE_BLOCKED = "无法保存设置。请恢复原文件的访问权限后重试。";
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
    workingDirectory: "选择工具工作目录",
    openProject: "打开项目",
    bindProject: "关联项目",
    exportMarkdown: "导出 Markdown",
  },
  en: {
    skill: "Choose a skill folder containing SKILL.md",
    importProject: "Choose a project to import from",
    workingDirectory: "Choose the tools’ working directory",
    openProject: "Open project",
    bindProject: "Link project",
    exportMarkdown: "Export Markdown",
  },
} as const satisfies Record<
  Locale,
  {
    skill: string;
    importProject: string;
    workingDirectory: string;
    openProject: string;
    bindProject: string;
    exportMarkdown: string;
  }
>;
