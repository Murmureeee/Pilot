// @env node
export const MCP_OAUTH_REQUEST_TIMEOUT_MS = 10_000;
export const MCP_OAUTH_SIGN_IN_TIMEOUT_MS = 5 * 60_000;
export const MCP_OAUTH_REFRESH_SKEW_MS = 30_000;
export const MCP_OAUTH_CHANGED = "MCP 服务配置已更改。请刷新列表后重试。";
export const MCP_OAUTH_REQUIRED = "此 MCP 服务需要登录。请在 MCP 服务设置中登录后重试。";
export const MCP_OAUTH_BUSY = "此 MCP 服务正在登录。请返回当前登录窗口。";
export const MCP_OAUTH_TIMEOUT = "MCP 登录已超时。请重新登录。";
export const MCP_OAUTH_BROWSER_FAILED = "无法打开系统浏览器。请检查默认浏览器后重试。";
export const MCP_OAUTH_FAILED = "MCP 授权失败。请检查服务的 OAuth 配置后重试。";
