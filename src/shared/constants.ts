// @env all
export { name as APP_PACKAGE_NAME, productName as APP_NAME } from "../../package.json";
export const WORKSPACE_QUERY_LENGTH = 512;
export const CONVERSATION_QUERY_LENGTH = 512;
export const MAX_CONCURRENT_RUNS = 2;
export const IMAGE_ATTACHMENT_MIME_TYPES = [
  "image/png",
  "image/jpeg",
  "image/webp",
  "image/gif",
] as const;
export const IMAGE_ATTACHMENT_LIMIT = 4;
export const IMAGE_ATTACHMENT_MAX_BYTES = 5 * 1024 * 1024;
export const IMAGE_ATTACHMENT_NAME_LIMIT = 255;
export const EXECUTION_APPROVAL_MODES = ["standard", "read-only", "full-access"] as const;
export const PLAN_PROPOSAL_MAX_LENGTH = 12_000;
export const RUN_SUBTASK_TOOL_NAME = "run_subtask";
export const MEMORY_TEXT_LIMIT = 12_000;
export const VERIFICATION_COMMAND_LIMIT = 4_096;
export const PROMPT_TEMPLATE_PREFIX = "prompt-";
export const PROMPT_TEMPLATE_NAME_PATTERN = /^[\p{L}\p{N}][\p{L}\p{N}_-]{0,39}$/u;
export const PROMPT_TEMPLATE_TEXT_LIMIT = 12_000;
export const PROMPT_TEMPLATE_LIMIT = 50;
export const MENTION_CONTEXT_HEADING =
  "Selected mentions (file and folder paths are relative to the workspace):";
export const DEFAULT_THINKING_LEVEL = "medium";
export const OPENAI_RESPONSES_MIN_TOKENS = 16;
export const THINKING_LEVELS = ["off", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export const LOG_LEVELS = ["off", "error", "warn", "info", "debug"] as const;
export const DEFAULT_LOG_LEVEL = "info";
export const DEFAULT_EXTERNAL_EDITOR = { kind: "vscode" } as const;
export const LOG_FILE_COUNT = 3;
export const LOG_FILE_MAX_BYTES = 1024 * 1024;
export const DIAGNOSTIC_EVENT_LIMIT = 200;
export const DIAGNOSTIC_EVENTS = {
  main: [
    "startup",
    "quit",
    "previous-run-interrupted",
    "uncaught-exception",
    "agent-error",
    "exit-failed",
    "window-state-save-failed",
    "scheduled-task-storage",
    "sleep-blocker-start-failed",
    "sleep-blocker-stop-failed",
    "show-project-entry-error",
    "task-notification-show",
    "task-notification-open",
    "task-notification-unread",
  ],
  renderer: [
    "mounted",
    "console",
    "preload-error",
    "load-failed",
    "process-gone",
    "unresponsive",
    "reload",
    "recovery-failed",
  ],
  child: ["process-gone"],
  updater: [
    "unavailable",
    "idle",
    "checking",
    "current",
    "error",
    "available",
    "downloading",
    "ready",
    "installing",
    "package-ready",
  ],
} as const;

export const SUPPORTED_LOCALES = ["zh", "en"] as const;
export const DEFAULT_LOCALE = SUPPORTED_LOCALES[0];
export const LOCALE_DETAILS = {
  zh: { label: "中文", htmlLang: "zh-CN" },
  en: { label: "English", htmlLang: "en" },
} as const satisfies Record<
  (typeof SUPPORTED_LOCALES)[number],
  { label: string; htmlLang: string }
>;
export const GIT_BRANCH_NAME_LIMIT = 1024;
export const GIT_PR_TITLE_LIMIT = 180;
export const GIT_PR_BODY_LIMIT = 65_536;
