// @env node
export const MAX_FILE_SNAPSHOT_BYTES = 256 * 1024;
export const MAX_DIFF_SEARCH_DISTANCE = 512;
export const MAX_DIFF_COMPARISONS = 1_000_000;
export const MAX_DIFF_PREVIEW_LINES = 700;
export const MAX_DIRECTORY_PREVIEW_ENTRIES = 200;
export const DIFF_CONTEXT_LINES = 3;
export const GIT_STATUS_MAX_BYTES = 8 * 1024 * 1024;
export const GIT_STATUS_TIMEOUT_MS = 5000;
export const GIT_FILE_READ_CONCURRENCY = 16;
export const MAX_GIT_CHECKPOINT_BYTES = 8 * 1024 * 1024;
export const GIT_COMMIT_TIMEOUT_MS = 60_000;
export const GIT_REMOTE_READ_TIMEOUT_MS = 20_000;
export const GIT_PUBLISH_TIMEOUT_MS = 60_000;
export const GIT_BRANCH_REF_PREFIX = "refs/heads/";
export const GIT_OBJECT_ID = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
export const TASKKILL_TIMEOUT_MS = 5_000;

export const CODE_EDITOR_PRESETS = {
  vscode: {
    command: "code",
    windowsExe: "Code.exe",
    windowsFolder: "Microsoft VS Code",
    macBundle: "Visual Studio Code.app",
  },
  cursor: {
    command: "cursor",
    windowsExe: "Cursor.exe",
    windowsFolder: "cursor",
    macBundle: "Cursor.app",
  },
} as const;
export const EDITOR_NOT_FOUND = "找不到外部编辑器。请在「设置 → 常规」检查安装或启动程序。";
export const EDITOR_START_FAILED = "外部编辑器启动失败。请在「设置 → 常规」检查启动程序后重试。";
export const EDITOR_FILE_UNAVAILABLE = "文件不可用。请重新打开文件预览后重试。";
export const EDITOR_LINE_UNAVAILABLE = "该行在工作树中不可用。请刷新差异后重试。";
