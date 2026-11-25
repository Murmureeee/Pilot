// @env browser
import {
  ArchiveIcon,
  CpuIcon,
  Minimize2Icon,
  PlugIcon,
  ShieldCheckIcon,
  SquarePenIcon,
} from "lucide-react";

import type {
  ApprovalMode,
  CommandDanger,
  CommandShell,
  GitChange,
  GitChangesView,
  GitRollbackConflict,
  LogLevel,
  PermissionDecision,
  PermissionFilePreview,
  ProviderKind,
  ThemeSetting,
  VerificationKind,
  VerificationStatus,
} from "@shared/contract";
import type { ExternalImportKind } from "@shared/imports";

import type {
  ComposerCommand,
  ComposerShortcut,
  SendKey,
  SessionRowStatus,
  SettingsSection,
  ShortcutGroup,
} from "./types";

export const COMPOSER_COMMANDS: readonly ComposerCommand[] = [
  {
    id: "compact",
    label: "压缩上下文",
    description: "整理较早的对话，可在 /compact 后填写保留重点",
    icon: Minimize2Icon,
    requiresSession: true,
    action: (actions) => actions.compactContext(),
  },
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

// 首页的起步任务：label 是按钮文字，prompt 是填进输入框的草稿。
export const STARTER_TASKS: readonly { label: string; prompt: string }[] = [
  {
    label: "梳理项目结构",
    prompt: "梳理这个项目的结构：主要目录、入口和关键模块各自负责什么。",
  },
  { label: "运行测试并修复", prompt: "运行测试，找出失败项并修复。" },
  { label: "审查未提交的改动", prompt: "审查当前未提交的改动，指出问题和风险。" },
];
export const HOME_RECENT_PROJECT_LIMIT = 5;
export const FEEDBACK_TIMEOUT_MS = 4000;

export const SESSION_STATUS_LABELS: Record<SessionRowStatus, string> = {
  approval: "等待审批",
  plan: "等待确认计划",
  running: "运行中",
  stopping: "正在停止",
  failed: "失败",
  interrupted: "已中断",
  unread: "未读",
};

export const SETTINGS_SECTION_LABELS: Record<SettingsSection, string> = {
  general: "常规",
  appearance: "外观",
  permissions: "权限",
  providers: "模型与提供方",
  persona: "个性化",
  shortcuts: "快捷键",
  archived: "已归档的聊天",
  data: "存储与诊断",
  about: "关于",
  skills: "技能",
  mcp: "MCP 服务",
  imports: "导入",
};

export const SETTINGS_SECTION_DESCRIPTIONS: Record<SettingsSection, string> = {
  general: "管理输入方式、桌面通知和 Agent 默认的工作环境。",
  appearance: "主题和界面语言。",
  permissions: "决定 Agent 写入文件、运行命令和调用 MCP 工具前是否需要你确认。",
  providers: "管理模型服务、密钥和聊天中可选的模型。",
  persona: "告诉 Agent 你的偏好和约定，它会在每次任务中遵循。",
  shortcuts: "当前可用的键盘操作。",
  archived: "查看、恢复或永久删除已归档的聊天。",
  data: "本地存储位置和诊断日志。",
  about: "版本信息、应用更新和反馈渠道。",
  skills: "查看本机和当前项目的技能。已启用的技能会在任务需要时读取。",
  mcp: "连接外部工具服务。可手动添加，也可从 Codex 或 Claude Code 导入，工具调用遵循权限设置。",
  imports: "从 Codex 或 Claude Code 一次导入技能、MCP 服务和插件组件，并管理已导入的插件。",
};

// 分区内设置项的名称，供导航搜索匹配；新增设置项时同步补上。
export const SETTINGS_SECTION_KEYWORDS: Record<SettingsSection, readonly string[]> = {
  general: [
    "发送方式",
    "Enter",
    "桌面通知",
    "系统通知",
    "任务栏提醒",
    "默认工作目录",
    "命令环境",
    "PowerShell",
    "Git Bash",
  ],
  appearance: ["主题", "亮色", "暗色", "跟随系统", "语言"],
  permissions: [
    "默认权限模式",
    "确认模式",
    "只读",
    "完全访问",
    "已保存的授权",
    "命令前缀",
    "撤销规则",
  ],
  providers: [
    "提供方",
    "API Key",
    "模型列表",
    "模型能力",
    "上下文长度（tokens）",
    "输出上限（tokens）",
    "图像输入",
    "思考支持",
    "可用思考强度",
    "Anthropic",
    "OpenAI",
  ],
  persona: ["自定义指令", "指令生效顺序", "AGENTS.md"],
  shortcuts: [
    "Ctrl",
    "Shift",
    "Esc",
    "发送消息",
    "换行",
    "聚焦输入框",
    "取回上一条消息",
    "切换权限模式",
    "停止任务",
  ],
  archived: ["取消归档", "永久删除"],
  data: ["应用数据目录", "聊天记录目录", "日志级别", "日志目录"],
  about: ["版本", "软件更新", "检查更新", "更新记录", "反馈问题"],
  skills: ["导入技能目录", "打开技能目录", "查看技能", "项目技能", "删除技能"],
  mcp: ["添加 MCP 服务", "stdio", "HTTP"],
  imports: ["Codex", "Claude Code", "插件组件"],
};

export const SEND_KEY_LABELS: Record<SendKey, string> = {
  enter: "Enter 发送，Shift+Enter 换行",
  "mod-enter": "Ctrl+Enter 发送，Enter 换行",
};

export const REVIEW_SHORTCUTS = {
  changes: { label: "打开或关闭变更页签", keys: "Ctrl+Shift+D" },
  verification: { label: "打开验证页签", keys: "Ctrl+Shift+T" },
} as const;

export const COMPOSER_SHORTCUTS = {
  "focus-composer": { label: "聚焦输入框", keys: "Ctrl+L" },
  "cycle-approval-mode": { label: "切换权限模式", keys: "Shift+Tab" },
  "recall-message": { label: "取回上一条消息", keys: "↑" },
  "stop-run": { label: "停止任务", keys: "Esc × 2" },
} as const satisfies Record<ComposerShortcut, { label: string; keys: string }>;

export const STOP_SHORTCUT_WINDOW_MS = 2000;

export const SHORTCUT_GROUPS: readonly ShortcutGroup[] = [
  {
    label: "全局",
    items: [
      { label: "搜索与命令面板", keys: "Ctrl+K" },
      { label: "新聊天", keys: "Ctrl+N" },
      { label: "打开项目…", keys: "Ctrl+O" },
      { label: "设置", keys: "Ctrl+," },
      { label: "后退", keys: "Ctrl+[" },
      { label: "前进", keys: "Ctrl+]" },
      { label: "显示或隐藏侧边栏", keys: "Ctrl+Shift+S" },
      REVIEW_SHORTCUTS.changes,
      REVIEW_SHORTCUTS.verification,
      COMPOSER_SHORTCUTS["focus-composer"],
      COMPOSER_SHORTCUTS["stop-run"],
    ],
  },
  {
    label: "输入框",
    items: [
      COMPOSER_SHORTCUTS["cycle-approval-mode"],
      COMPOSER_SHORTCUTS["recall-message"],
      { label: "引用文件、文件夹或技能", keys: "@" },
      { label: "打开命令菜单", keys: "/" },
      { label: "在菜单中移动", keys: "↑ ↓" },
      { label: "关闭菜单", keys: "Esc" },
    ],
  },
  {
    label: "审批",
    items: [
      { label: "本次允许", keys: "Enter" },
      { label: "拒绝", keys: "Esc" },
    ],
  },
  {
    label: "窗口",
    items: [
      { label: "放大", keys: "Ctrl+=" },
      { label: "缩小", keys: "Ctrl+-" },
      { label: "实际大小", keys: "Ctrl+0" },
      { label: "切换全屏", keys: "F11" },
      { label: "重新加载", keys: "Ctrl+R" },
      { label: "关闭窗口", keys: "Ctrl+W" },
      { label: "退出", keys: "Ctrl+Q" },
    ],
  },
];

export const APP_LINKS = [
  { label: "更新记录", href: "https://github.com/Murmureeee/Pilot/blob/main/CHANGELOG.md" },
  { label: "全部版本", href: "https://github.com/Murmureeee/Pilot/releases" },
  { label: "反馈问题", href: "https://github.com/Murmureeee/Pilot/issues" },
] as const;

export const APPROVAL_MODE_OPTIONS: Record<ApprovalMode, { label: string; description: string }> = {
  standard: {
    label: "确认模式",
    description: "写入、命令和 MCP 调用需确认，已有授权可直接执行。",
  },
  "read-only": { label: "只读", description: "阻止文件写入、命令和 MCP 工具调用。" },
  plan: { label: "计划模式", description: "先读取项目并制定计划，确认后使用原权限执行。" },
  "full-access": {
    label: "完全访问",
    description: "允许写入和运行命令。危险命令始终需要确认，MCP 服务可单独要求确认。",
  },
};

export const COMMAND_DANGER_DESCRIPTIONS: Record<CommandDanger, string> = {
  "git-force-push": "强制推送可能覆盖远端提交。",
  "git-hard-reset": "硬重置会丢弃工作区和暂存区的改动。",
  "git-clean": "此命令可以删除未跟踪的文件和目录。",
  "git-checkout-files": "检出文件可能覆盖项目中的本地改动。",
  "git-dynamic": "Git 命令依赖运行时参数，可能覆盖或删除数据。",
  "download-and-execute": "管道可能将下载内容交给解释器执行。",
  "disk-operation": "此命令可以更改磁盘分区或文件系统。",
  "recursive-delete-outside-project": "递归删除可能影响项目目录之外的文件。",
  "forced-delete": "此命令可能强制删除文件或整个目录。",
  "system-operation": "此命令可以修改系统设置或中断系统运行。",
};

// 已保存授权里的内置工具名称，与主进程 TOOL_LABELS 的文案一致；MCP 工具显示原名。
export const TOOL_RULE_LABELS: Readonly<Record<string, string>> = {
  write_file: "写入文件",
  edit_file: "编辑文件",
  bash: "执行命令",
};

export const COMMAND_SHELL_LABELS: Record<CommandShell, string> = {
  powershell: "PowerShell",
  bash: "Git Bash",
};

export const PERMISSION_ATTENTION_TEXT = "text-amber-700 dark:text-amber-400";

export const PERMISSION_FILE_OPERATIONS: Record<PermissionFilePreview["operation"], string> = {
  create: "新建文件",
  overwrite: "覆盖文件",
  edit: "编辑文件",
  write: "写入文件",
};

export const PERMISSION_DECISIONS: Record<PermissionDecision, string> = {
  once: "本次已允许",
  session: "已为本会话允许",
  global: "已保存为总是允许",
  deny: "已拒绝",
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

export const SIDEBAR_MIN_WIDTH = 220;
export const SIDEBAR_MAX_WIDTH = 520;
export const SIDEBAR_DEFAULT_WIDTH = 262;
export const RAIL_EXPAND_THRESHOLD = 80;

export const REVIEW_TWO_COLUMN_WIDTH = 900;
export const REVIEW_THREE_COLUMN_WIDTH = 1100;
export const REVIEW_MIN_WIDTH = 360;
export const REVIEW_CHAT_MIN_WIDTH = 21 * 16;
export const REVIEW_CARD_INSET = 64;
export const REVIEW_PANEL_ID = "review-panel";
export const REVIEW_TRIGGER_ID = "review-trigger";
export const REVIEW_TABS = [
  { value: "changes", label: "变更" },
  { value: "files", label: "文件" },
  { value: "verification", label: "验证" },
] as const;
export const FILE_CHANGES_TREE_MIN_WIDTH = 500;
export const VERIFICATION_LABELS: Record<VerificationKind, string> = {
  test: "测试",
  typecheck: "类型检查",
  build: "构建",
};
export const VERIFICATION_STATUS_LABELS: Record<VerificationStatus, string> = {
  running: "运行中…",
  stopping: "正在停止…",
  success: "成功",
  failed: "失败",
  stopped: "已停止",
  interrupted: "已中断",
};
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
export const GIT_ROLLBACK_CONFLICT_LABELS: Record<GitRollbackConflict, string> = {
  ownership: "改动归属不明，冲突内容已保留。",
  index: "暂存内容有变化，文件已保留。",
  snapshot: "此文件缺少可校验的检查点，文件已保留。",
  "later-edit": "文件已有后续改动，无法撤销此变更。",
};
export const WORKSPACE_LINK_PREFIX = "#pilot-workspace-reference=";
export const SANITIZED_WORKSPACE_LINK_PREFIX = "#user-content-" + WORKSPACE_LINK_PREFIX.slice(1);
