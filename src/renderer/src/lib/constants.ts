// @env browser
import { ArchiveIcon, CpuIcon, PlugIcon, ShieldCheckIcon, SquarePenIcon } from "lucide-react";
import type {
  ApprovalMode,
  GitChange,
  GitChangesView,
  LogLevel,
  ProviderKind,
  ThemeSetting,
} from "@shared/contract";
import type { ExternalImportKind } from "@shared/imports";
import type { ComposerCommand, SettingsSection } from "./types";

export const COMPOSER_COMMANDS: readonly ComposerCommand[] = [
  {
    id: "new",
    label: "新聊天",
    description: "打开一个空白会话",
    icon: SquarePenIcon,
    action: (actions) => actions.newChat(),
  },
  {
    id: "model",
    label: "选择模型",
    description: "浏览当前提供方的可用模型",
    icon: CpuIcon,
    action: (actions) => actions.openMenu("model"),
  },
  {
    id: "permissions",
    label: "权限模式",
    description: "调整 Agent 操作的审批方式",
    icon: ShieldCheckIcon,
    action: (actions) => actions.openMenu("permissions"),
  },
  {
    id: "mcp",
    label: "MCP 服务",
    description: "打开 MCP 服务设置",
    icon: PlugIcon,
    action: (actions) => actions.openSettings("mcp"),
  },
  {
    id: "archive",
    label: "归档当前聊天",
    description: "把聊天移到已归档列表",
    icon: ArchiveIcon,
    requiresSession: true,
    action: (actions) => actions.archiveChat(),
  },
];

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

export const LOG_LEVEL_LABELS: Record<LogLevel, string> = {
  off: "关闭记录",
  error: "仅错误",
  warn: "警告",
  info: "信息",
  debug: "调试",
};

export const PROVIDER_KIND_LABELS: Record<ProviderKind, string> = {
  anthropic: "Anthropic",
  "openai-compatible": "OpenAI 兼容（Chat Completions）",
  "openai-responses": "OpenAI Responses",
  faux: "Faux 测试（无需 key）",
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
// Leave room for the chat and its review pane after the navigation rail and frame.
export const COMPOSER_MODEL_OPTION_CLASS =
  "hover:bg-accent focus-visible:ring-ring/55 aria-pressed:bg-accent/70 flex w-full items-start gap-2 rounded-lg px-2.5 py-1.5 text-left outline-none focus-visible:ring-1 focus-visible:ring-inset";

export const COMPOSER_SURFACE_CLASS =
  "border-border bg-card rounded-[22px] shadow-sm shadow-foreground/10";

export const FILE_REVIEW_MIN_WINDOW_WIDTH = 700;
export const FILE_CHANGES_MIN_WINDOW_WIDTH = 900;
export const FILE_CHANGES_TREE_MIN_WIDTH = 500;
export const FILE_CHANGES_PANEL_CLASS =
  "border-border bg-background flex min-w-0 shrink-0 flex-col border-s [width:min(62%,56rem,calc(100%_-_21rem))]";

export const GIT_CHANGE_AREAS = ["staged", "unstaged", "untracked"] as const;
export const GIT_CHANGE_AREA_LABELS: Record<GitChange["area"], string> = {
  staged: "暂存区",
  unstaged: "未暂存",
  untracked: "未跟踪",
};
export const GIT_CHANGE_KIND_LABELS: Record<GitChange["kind"], string> = {
  added: "新增文件",
  modified: "修改文件",
  deleted: "删除文件",
  renamed: "重命名文件",
  conflicted: "合并冲突",
};
export const GIT_CHANGE_ORIGIN_LABELS: Record<GitChange["origin"], string> = {
  existing: "已有改动",
  task: "任务期间",
  mixed: "混合变更",
};
export const GIT_REVIEW_PHASE_LABELS: Record<GitChangesView["phase"], string> = {
  workspace: "当前工作区",
  running: "当前任务",
  interrupted: "已中断的任务",
  finished: "最近一次任务结束时",
};
export const WORKSPACE_LINK_PREFIX = "#pilot-workspace-reference=";
export const SANITIZED_WORKSPACE_LINK_PREFIX = "#user-content-" + WORKSPACE_LINK_PREFIX.slice(1);
