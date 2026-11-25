// @env node
export const WEB_SEARCH_ENDPOINT = "https://html.duckduckgo.com/html/";
export const WEB_QUERY_LIMIT = 500;
export const WEB_RESPONSE_LIMIT = 2 * 1024 * 1024;
export const WEB_PAGE_TEXT_LIMIT = 12_000;
export const WEB_SNIPPET_LIMIT = 320;
export const WEB_REDIRECT_LIMIT = 4;
export const WEB_TIMEOUT_MS = 15_000;
export const WEB_INVALID_URL = "请输入公开网页的 HTTP 或 HTTPS 地址。";
export const WEB_PRIVATE_ADDRESS = "该域名未解析到公开地址。请选择其他网页。";
export const WEB_CONNECTION_FAILED = "无法连接该网站。请检查网络或代理后重试。";
export const WEB_UNSUPPORTED_PROXY =
  "当前代理协议不支持网页工具。请使用 HTTP、HTTPS 或 SOCKS5 代理。";
export const WEB_TIMEOUT = "网页请求超时。请检查网络后重试。";
export const WEB_REDIRECT_DOMAIN = "网页跳转到了另一个域名。请对目标网址发起新的请求。";
export const WEB_REDIRECT_FAILED = "无法继续网页跳转。请检查网址后重试。";
export const WEB_UNSUPPORTED_CONTENT = "此地址未返回 HTML 或纯文本。请提供可读取的网页地址。";
export const WEB_EMPTY_PAGE = "未提取到网页正文。请尝试提供其他来源。";
export const WEB_SEARCH_UNAVAILABLE =
  "DuckDuckGo 暂未返回可读取的搜索结果。请稍后重试或提供网页地址。";
