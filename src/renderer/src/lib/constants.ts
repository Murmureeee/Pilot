// @env browser
import type { ApprovalMode, ThemeSetting } from "@shared/contract";
import type { ExternalImportKind } from "@shared/imports";
import type { SettingsSection } from "./types";

export const SETTINGS_SECTION_LABELS: Record<SettingsSection, string> = {
  general: "常规",
  providers: "模型与提供方",
  persona: "个性化",
  data: "数据管理",
  skills: "技能",
  mcp: "MCP 服务",
  imports: "导入",
};

export const APPROVAL_MODE_OPTIONS: Record<ApprovalMode, { label: string; description: string }> = {
  standard: {
    label: "确认模式",
    description: "写入、命令和 MCP 调用需确认，已有授权可直接执行。",
  },
  "read-only": { label: "只读", description: "阻止文件写入、命令和 MCP 工具调用。" },
  "full-access": {
    label: "完全访问",
    description: "允许写入和运行命令，MCP 服务可单独要求确认。",
  },
};

export const THEME_LABELS: Record<ThemeSetting, string> = {
  light: "亮色",
  dark: "暗色",
  system: "跟随系统",
};

export const EXTERNAL_IMPORT_OPTIONS: Record<
  ExternalImportKind,
  { label: string; description: string; title: string; chooseLabel: string }
> = {
  skill: {
    label: "技能",
    description: "导入技能指令及其随附文件。",
    title: "导入技能",
    chooseLabel: "选择要导入的技能",
  },
  mcp: {
    label: "MCP 服务",
    description: "导入本地命令或 HTTP 服务的连接配置。",
    title: "导入 MCP 服务",
    chooseLabel: "选择要导入的 MCP 服务",
  },
  plugin: {
    label: "插件组件",
    description: "提取插件中可识别的技能和 MCP 配置。",
    title: "导入插件组件",
    chooseLabel: "选择要导入的插件组件",
  },
};

export const IMPORT_SOURCE_LABELS = { codex: "Codex", "claude-code": "Claude Code" } as const;

export const MESSAGE_JUMP = {
  minTurns: 5,
  railInset: 10,
  railMinWidth: 12,
  railMaxWidth: 24,
  railClearance: 2,
  gutterGap: 8,
  previewMinWidth: 160,
  previewMaxWidth: 312,
  previewHalfHeight: 64,
  tickWidths: [24, 18, 13, 9],
  idleTickWidth: 6,
  revealTickOptions: { block: "nearest", container: "nearest" },
} as const;
