// @env browser
import {
  ArchiveIcon,
  ArrowUpIcon,
  ClipboardListIcon,
  CpuIcon,
  EyeIcon,
  FileDiffIcon,
  FilePlusIcon,
  FileTextIcon,
  FolderOpenIcon,
  LanguagesIcon,
  ListChecksIcon,
  LocateFixedIcon,
  Minimize2Icon,
  PlayIcon,
  PlugIcon,
  SearchIcon,
  SettingsIcon,
  ShieldCheckIcon,
  SquareIcon,
  SquarePenIcon,
  SunMoonIcon,
  TerminalIcon,
  ZapIcon,
} from "lucide-react";

import {
  APPROVAL_MODE_OPTIONS,
  COMPOSER_SHORTCUTS,
  REVIEW_SHORTCUTS,
  THEME_LABELS,
  VERIFICATION_LABELS,
} from "@renderer/lib/constants";
import { setLocale, t, useLocale } from "@renderer/lib/i18n";
import { applyTheme, useTheme } from "@renderer/lib/theme";
import type {
  ComposerAction,
  ComposerShortcut,
  ReviewTab,
  SettingsSection,
  WorkbenchCommand,
} from "@renderer/lib/types";
import {
  selectApprovalMode,
  selectComposerSettings,
  selectProjectDirectory,
  useAgentStore,
} from "@renderer/stores/agent";
import {
  EXECUTION_APPROVAL_MODES,
  LOCALE_DETAILS,
  PROMPT_TEMPLATE_PREFIX,
  SUPPORTED_LOCALES,
} from "@shared/constants";
import { VERIFICATION_KINDS, type PromptTemplate, type ThemeSetting } from "@shared/contract";

const shortcutIcons = {
  "focus-composer": LocateFixedIcon,
  "find-chat": SearchIcon,
  "cycle-approval-mode": ShieldCheckIcon,
  "recall-message": ArrowUpIcon,
  "stop-run": SquareIcon,
};

const approvalIcons = { standard: ShieldCheckIcon, "read-only": EyeIcon, "full-access": ZapIcon };

const initPrompt =
  "检查当前项目的结构、开发命令和工程约定，在项目根目录生成或更新 AGENTS.md。已有文件时先阅读并保留仍适用的约定。只修改 AGENTS.md，并说明你做了哪些更新。";
const reviewPrompt =
  "审查当前 Git 工作区的未提交改动，包括已暂存、未暂存和未跟踪的文件。按严重程度列出具体问题，注明文件和行号，并说明遗漏的验证。只做审查，保持工作区文件原样。";

export function openWorkbenchSettings(section?: SettingsSection): void {
  const agent = useAgentStore.getState();
  if (section) agent.setSettingsSection(section);
  agent.setView("settings");
  requestAnimationFrame(() =>
    document.querySelector<HTMLElement>("[data-settings-heading]")?.focus(),
  );
}

function isCurrentComposer(composerId: string): boolean {
  return useAgentStore.getState().composerId === composerId;
}

export function useWorkbenchCommands({
  canEdit,
  canReview,
  hasGit,
  shortcuts,
  runShortcut,
  editComposer,
  openReview,
  requestTemplate,
}: {
  canEdit: boolean;
  canReview: boolean;
  hasGit: boolean;
  shortcuts: Record<ComposerShortcut, boolean>;
  runShortcut(shortcut: ComposerShortcut): void;
  editComposer(action: ComposerAction): void;
  openReview(tab: ReviewTab): void;
  requestTemplate(template: PromptTemplate, insert: (text: string) => void): void;
}): WorkbenchCommand[] {
  const locale = useLocale();
  const theme = useTheme();
  const composerId = useAgentStore((state) => state.composerId);
  const sessionId = useAgentStore((state) => state.sessionId);
  const planning = useAgentStore((state) => Boolean(selectComposerSettings(state).planMode));
  const approvalMode = useAgentStore(selectApprovalMode);
  const activeRun = useAgentStore((state) => state.activeRun);
  const choosingProject = useAgentStore((state) => state.choosingProject);
  const project = useAgentStore(selectProjectDirectory);
  const templates = useAgentStore((state) => state.settings?.promptTemplates);
  const setView = useAgentStore((state) => state.setView);
  const newSession = useAgentStore((state) => state.newSession);
  const selectProject = useAgentStore((state) => state.selectProject);
  const archiveSession = useAgentStore((state) => state.setSessionArchived);
  const commands: WorkbenchCommand[] = [
    {
      id: "clear",
      label: "新聊天",
      description: "在当前项目打开空白聊天，保留已有会话。",
      slash: "clear",
      slashAliases: ["new"],
      shortcut: "Ctrl+N",
      icon: SquarePenIcon,
      run: async () => {
        setView("chat");
        await newSession();
        editComposer({ shortcut: "focus-composer" });
      },
    },
    {
      id: "open-settings",
      label: "打开设置",
      shortcut: "Ctrl+,",
      icon: SettingsIcon,
      run: () => openWorkbenchSettings(),
    },
    {
      id: "mcp",
      label: "MCP 服务",
      description: "打开 MCP 服务设置",
      slash: "mcp",
      icon: PlugIcon,
      run: () => openWorkbenchSettings("mcp"),
    },
  ];

  if (!choosingProject)
    commands.push({
      id: "open-project",
      label: "打开项目…",
      description: "选择一个本地文件夹。",
      shortcut: "Ctrl+O",
      icon: FolderOpenIcon,
      run: () => selectProject(),
    });

  if (composerId && canEdit) {
    const append = (text: string): void => editComposer({ prompt: text, composerId });
    commands.unshift({
      id: "plan",
      label: "计划模式",
      description: planning ? "退出计划模式。" : "先读取和搜索，再提交计划供你确认。",
      slash: "plan",
      icon: ClipboardListIcon,
      checked: planning,
      palette: false,
      run: () => window.pi.sessionSetPlanMode(composerId, !planning),
    });
    commands.push(
      {
        id: "model",
        label: "选择模型",
        description: "浏览当前提供方的可用模型",
        slash: "model",
        icon: CpuIcon,
        run: () => editComposer({ menu: "model", composerId }),
      },
      {
        id: "permissions",
        label: "权限模式",
        description: "调整 Agent 操作的审批方式",
        slash: "permissions",
        icon: ShieldCheckIcon,
        run: () => editComposer({ menu: "permissions", composerId }),
      },
    );
    for (const mode of EXECUTION_APPROVAL_MODES) {
      const option = APPROVAL_MODE_OPTIONS[mode];
      commands.push({
        id: "mode-" + mode,
        label: "权限模式：" + option.label,
        description: option.description,
        checked: mode === approvalMode,
        attention: mode === "full-access",
        icon: approvalIcons[mode],
        run: () => {
          setView("chat");
          return window.pi.sessionUpdateSettings(composerId, { approvalMode: mode });
        },
      });
    }
    if (project)
      commands.push({
        id: "init",
        label: "生成项目指令",
        description: "填入用于生成或更新 AGENTS.md 的提示词。",
        slash: "init",
        icon: FilePlusIcon,
        insertsPrompt: true,
        run: ({ insert = append } = {}) => insert(t(initPrompt, locale)),
      });
    if (project && hasGit)
      commands.push({
        id: "review",
        label: "审查未提交的改动",
        description: "填入审查当前 Git 改动的提示词。",
        slash: "review",
        icon: ClipboardListIcon,
        insertsPrompt: true,
        run: ({ insert = append } = {}) => insert(t(reviewPrompt, locale)),
      });
    for (const template of templates ?? []) {
      const slash = PROMPT_TEMPLATE_PREFIX + template.name;
      commands.push({
        id: slash,
        label: template.name,
        description: "使用提示词模板",
        slash,
        icon: FileTextIcon,
        insertsPrompt: true,
        run: ({ insert = append } = {}) => requestTemplate(template, insert),
      });
    }
  }

  if (sessionId)
    commands.push({
      id: "archive",
      label: "归档当前聊天",
      description: "把聊天移到已归档列表",
      slash: "archive",
      icon: ArchiveIcon,
      run: () => archiveSession(sessionId, true),
    });
  if (sessionId && composerId && canEdit && !activeRun)
    commands.push({
      id: "compact",
      label: "压缩上下文",
      description: "整理较早的对话，可在 /compact 后填写保留重点",
      slash: "compact",
      icon: Minimize2Icon,
      run: ({ argument } = {}) => window.pi.agentCompact(composerId, argument),
    });

  if (composerId && canReview) {
    commands.push(
      {
        id: "diff",
        label: "打开变更页签",
        description: "查看当前项目或会话的文件改动。",
        shortcut: REVIEW_SHORTCUTS.changes.keys,
        slash: "diff",
        icon: FileDiffIcon,
        run: () => openReview("changes"),
      },
      {
        id: "review-files",
        label: "打开文件页签",
        icon: FileTextIcon,
        run: () => openReview("files"),
      },
      {
        id: "review-verification",
        label: REVIEW_SHORTCUTS.verification.label,
        description: "运行验证或查看历史结果。",
        shortcut: REVIEW_SHORTCUTS.verification.keys,
        icon: ListChecksIcon,
        run: () => openReview("verification"),
      },
      {
        id: "review-terminal",
        label: REVIEW_SHORTCUTS.terminal.label,
        description: "打开交互式 Shell 或查看 Agent 后台命令。",
        shortcut: REVIEW_SHORTCUTS.terminal.keys,
        icon: TerminalIcon,
        run: () => openReview("terminal"),
      },
    );
    for (const kind of VERIFICATION_KINDS)
      commands.push({
        id: "verify-" + kind,
        label: "运行验证",
        description: VERIFICATION_LABELS[kind],
        icon: PlayIcon,
        run: async () => {
          openReview("verification");
          const state = await window.pi.sessionVerification(composerId);
          if (!isCurrentComposer(composerId)) return;
          const command = state.commands[kind];
          if (!state.workingDirectory || !command)
            throw new Error("没有可用的默认验证命令。请在验证页签输入命令。");
          await window.pi.sessionStartVerification(composerId, {
            kind,
            command,
            workingDirectory: state.workingDirectory,
          });
        },
      });
  }

  for (const shortcut of Object.keys(COMPOSER_SHORTCUTS) as ComposerShortcut[]) {
    if (!shortcuts[shortcut]) continue;
    const { label, keys } = COMPOSER_SHORTCUTS[shortcut];
    commands.push({
      id: shortcut,
      label,
      shortcut: keys,
      icon: shortcutIcons[shortcut],
      run: () => runShortcut(shortcut),
    });
  }
  for (const value of Object.keys(THEME_LABELS) as ThemeSetting[])
    commands.push({
      id: "theme-" + value,
      label: "切换主题",
      description: THEME_LABELS[value],
      checked: value === theme,
      icon: SunMoonIcon,
      run: () => applyTheme(value),
    });
  for (const value of SUPPORTED_LOCALES)
    commands.push({
      id: "locale-" + value,
      label: "切换语言",
      description: LOCALE_DETAILS[value].label,
      checked: locale === value,
      icon: LanguagesIcon,
      run: () => setLocale(value),
    });
  return commands;
}
