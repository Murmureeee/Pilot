// @env node
export const OFFICIAL_MARKETPLACE = {
  location: "https://github.com/anthropics/claude-plugins-official.git",
  name: "Claude Code 官方市场",
};
export const MARKETPLACE_FILE = ".claude-plugin/marketplace.json";
export const MARKETPLACE_UNAVAILABLE = "无法读取插件市场。请核对 Git 地址和连接后重试。";
export const MARKETPLACE_INVALID = "插件市场清单无效。请检查 .claude-plugin/marketplace.json。";
export const MARKETPLACE_LIMIT = 25;
export const MARKETPLACE_LIST_FULL = "已达到插件市场数量上限。请先移除一个来源。";
export const REGISTRY_PAGE_SIZE = 24;
export const REGISTRY_MAX_BYTES = 4 * 1024 * 1024;
export const REGISTRY_TIMEOUT = 12_000;
export const REGISTRY_UNAVAILABLE = "无法读取 MCP Registry。请检查连接后重试。";
export const REGISTRY_INVALID = "MCP Registry 返回了无法读取的目录。请重试。";
export const REGISTRY_METADATA = "io.modelcontextprotocol.registry/official";
