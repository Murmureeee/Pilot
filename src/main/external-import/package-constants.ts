// @env node
export const PACKAGE_SIZE_LIMIT = 64 * 1024 * 1024;
export const PACKAGE_ENTRY_LIMIT = 2500;
export const PACKAGE_GIT_TIMEOUT = 90_000;
export const PACKAGE_EXCERPT_BYTES = 4096;
export const PACKAGE_EXCERPT_LIMIT = 16;
export const PACKAGE_CONTENT_ID = /^[a-f0-9]{24}$/;
export const PACKAGE_UNREADABLE = "无法读取插件来源。请检查路径或 Git 地址后重试。";
export const PACKAGE_TOO_LARGE = "插件超过 64 MB 或 2500 个条目。请选择较小的包。";
export const PACKAGE_BAD_PATH = "插件含有链接或无效路径。请使用常规文件和文件夹。";
export const PACKAGE_CHANGED = "插件内容或安装状态已变化。请重新预览。";
export const PACKAGE_NOT_FOUND = "找不到该插件。请刷新列表后重试。";
export const PACKAGE_EMPTY = "没有可安装的插件组件。请检查所选来源。";
export const PACKAGE_BUSY = "请在当前任务结束后更新或卸载插件。";
export const PACKAGE_SAVE_FAILED = "无法保存插件变更。请检查应用数据目录权限后重试。";
export const PACKAGE_OLD_FILES_BUSY = "无法移除旧插件文件。请停用插件后重试。";
export const PACKAGE_IGNORED = /^(?:\.git|node_modules|__MACOSX|\.DS_Store|\.env(?:\..*)?)$/i;
export const PACKAGE_SCRIPT =
  /(?:^|\/)(?:scripts|bin)\/|(?:\.(?:cjs|mjs|js|jsx|ts|tsx|py|rb|pl|sh|bash|zsh|fish|ps1|cmd|bat|lua))$/i;
export const PACKAGE_ROOT_MARKERS = [
  "SKILL.md",
  "plugin.json",
  ".codex-plugin",
  ".claude-plugin",
  "package.json",
  "skills",
  "prompts",
  "commands",
  ".mcp.json",
];
export const PACKAGE_UNSUPPORTED_LABELS: ReadonlyMap<string, string> = new Map([
  ["apps", "应用集成"],
  [".app.json", "应用集成"],
  ["hooks", "钩子"],
  ["hooks/hooks.json", "钩子"],
  ["agents", "子 Agent"],
  ["commands", "命令"],
  ["lspServers", "语言服务器"],
  [".lsp.json", "语言服务器"],
  ["outputStyles", "输出样式"],
  ["workflows", "工作流"],
  ["themes", "主题"],
  ["monitors", "监视器"],
]);
