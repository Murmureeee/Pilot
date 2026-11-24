// @env node
import type { Locale } from "../shared/contract";

export const WINDOWS_APP_ID = "dev.pilot.app";
export const LEGACY_USER_DATA_DIRECTORIES = ["pi Desktop", "pi-desktop"] as const;
export const SESSION_TRANSCRIPT_EXTENSION = ".jsonl";
export const SESSION_DRAFT_EXTENSION = ".draft.json";
export const SESSION_FILE_ID = /^[a-z\d_-]+$/i;
export const SESSION_INDEX_SAVE_BLOCKED = "无法备份原会话索引，暂时不能保存会话索引。";
export const SETTINGS_FILE_NAME = "settings.json";
export const SETTINGS_SAVE_BLOCKED = "无法保存设置。请恢复原文件的访问权限后重试。";

// 原生窗控与 src/renderer/src/assets/main.css 的窗口底色对齐。
export const TITLE_BAR_OVERLAY_COLORS = {
  light: { color: "#edf2f7", symbolColor: "#243448" },
  dark: { color: "#161e28", symbolColor: "#e4ebf4" },
} as const;

export const NATIVE_DIALOG_TITLES = {
  zh: {
    skill: "选择技能目录（须含 SKILL.md）",
    importProject: "选择导入来源项目",
    workingDirectory: "选择工具工作目录",
    openProject: "打开项目",
    bindProject: "关联项目",
  },
  en: {
    skill: "Choose a skill folder containing SKILL.md",
    importProject: "Choose a project to import from",
    workingDirectory: "Choose the tools’ working directory",
    openProject: "Open project",
    bindProject: "Link project",
  },
} as const satisfies Record<
  Locale,
  {
    skill: string;
    importProject: string;
    workingDirectory: string;
    openProject: string;
    bindProject: string;
  }
>;
