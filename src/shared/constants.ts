// @env all
export { name as APP_PACKAGE_NAME, productName as APP_NAME } from "../../package.json";
export const WORKSPACE_QUERY_LENGTH = 512;
export const CONVERSATION_QUERY_LENGTH = 512;
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
export const LOG_FILE_COUNT = 3;
export const LOG_FILE_MAX_BYTES = 1024 * 1024;

export const SUPPORTED_LOCALES = ["zh", "en"] as const;
export const DEFAULT_LOCALE = SUPPORTED_LOCALES[0];
export const LOCALE_DETAILS = {
  zh: { label: "中文", htmlLang: "zh-CN" },
  en: { label: "English", htmlLang: "en" },
} as const satisfies Record<
  (typeof SUPPORTED_LOCALES)[number],
  { label: string; htmlLang: string }
>;
