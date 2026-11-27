// @env all
import type { WebSource } from "./contract";

export const WEB_FETCH_TOOL = "web_fetch";
export const WEB_SEARCH_TOOL = "web_search";
export const WEB_DOMAIN_PATTERN =
  /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
export const WEB_SOURCE_LIMIT = 5;
const WEB_URL_LIMIT = 2048;

export function isWebTool(name: string): boolean {
  return name === WEB_FETCH_TOOL || name === WEB_SEARCH_TOOL;
}

export function webLink(value: string): URL | undefined {
  if (value.length > WEB_URL_LIMIT || /\p{Cc}/u.test(value)) return undefined;
  const url = URL.parse(value);
  if (
    !url ||
    url.href.length > WEB_URL_LIMIT ||
    !["https:", "http:"].includes(url.protocol) ||
    url.username ||
    url.password
  )
    return undefined;
  return url;
}

export function webSources(details: unknown): WebSource[] | undefined {
  if (!details || typeof details !== "object" || !("webSources" in details)) return undefined;
  if (!Array.isArray(details.webSources)) return undefined;
  const sources: WebSource[] = [];
  const seen = new Set<string>();
  for (const source of details.webSources.slice(0, WEB_SOURCE_LIMIT)) {
    if (!source || typeof source !== "object" || typeof source.url !== "string") continue;
    const url = webLink(source.url);
    if (url && !seen.has(url.href)) {
      seen.add(url.href);
      const title = typeof source.title === "string" ? source.title.trim().slice(0, 200) : "";
      const section =
        url.hash && typeof source.section === "string" ? source.section.trim().slice(0, 200) : "";
      sources.push({
        title: title || url.hostname,
        url: url.href,
        ...(section ? { section } : {}),
      });
    }
  }
  return sources.length ? sources : undefined;
}
