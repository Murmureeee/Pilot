// @env node
import { isIP } from "node:net";

import type { PermissionRequest } from "../../shared/contract";
import { WEB_DOMAIN_PATTERN, WEB_FETCH_TOOL, WEB_SEARCH_TOOL, webLink } from "../../shared/web";
import { WEB_INVALID_URL, WEB_QUERY_LIMIT, WEB_SEARCH_ENDPOINT } from "./constants";

const PRIVATE_SUFFIX = /\.(?:localhost|local|internal|home\.arpa|onion)$/;

export function publicWebUrl(value: string): URL {
  const url = webLink(value);
  const domain = url?.hostname.replace(/\.$/, "");
  if (
    !url ||
    !domain ||
    isIP(domain) ||
    !WEB_DOMAIN_PATTERN.test(domain) ||
    PRIVATE_SUFFIX.test(domain)
  )
    throw new Error(WEB_INVALID_URL);
  url.hostname = domain;
  url.hash = "";
  return url;
}

export function webTarget(toolName: string, args: unknown): PermissionRequest["web"] {
  const inputs = args && typeof args === "object" ? (args as Record<string, unknown>) : {};
  if (toolName === WEB_FETCH_TOOL) {
    const url = publicWebUrl(typeof inputs.url === "string" ? inputs.url.trim() : "");
    return { domain: url.hostname, url: url.href };
  }
  if (toolName === WEB_SEARCH_TOOL) {
    const query = typeof inputs.query === "string" ? inputs.query.trim() : "";
    if (!query || query.length > WEB_QUERY_LIMIT) throw new Error("请输入有效的搜索词。");
    const url = new URL(WEB_SEARCH_ENDPOINT);
    url.searchParams.set("q", query);
    return { domain: url.hostname, url: url.href, query };
  }
  return undefined;
}
