// @env node
import { loadBuffer } from "cheerio";

import type { WebSource } from "../../shared/contract";
import { WEB_SOURCE_LIMIT, webLink } from "../../shared/web";
import {
  WEB_EMPTY_PAGE,
  WEB_PAGE_TEXT_LIMIT,
  WEB_SEARCH_UNAVAILABLE,
  WEB_SNIPPET_LIMIT,
} from "./constants";
import { publicWebUrl } from "./targets";
import type { WebDocument, WebHit } from "./types";

function charset(contentType: string): string | undefined {
  return /;\s*charset\s*=\s*"?([^";\s]+)/i.exec(contentType)?.[1];
}

function clean(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/(?![\n\t])\p{Cc}/gu, "")
    .replace(/[^\S\n]+/g, " ")
    .replace(/ *\n */g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function decodeText(document: WebDocument): string {
  let decoder: TextDecoder;
  try {
    decoder = new TextDecoder(charset(document.contentType) ?? "utf-8");
  } catch {
    decoder = new TextDecoder();
  }
  return decoder.decode(document.bytes);
}

function fragmentId(fragment: string): string {
  try {
    return decodeURIComponent(fragment.slice(1));
  } catch {
    return "";
  }
}

export function pageContent(
  document: WebDocument,
  requestedFragment = "",
): {
  source: WebSource;
  sections: WebSource[];
  text: string;
  truncated: boolean;
} {
  let title = "";
  let text: string;
  const sections: WebSource[] = [];
  if (document.contentType.toLowerCase().startsWith("text/plain")) {
    text = clean(decodeText(document));
  } else {
    const $ = loadBuffer(document.bytes, {
      encoding: { transportLayerEncodingLabel: charset(document.contentType) ?? "utf-8" },
    });
    title = clean($("title").first().text()).slice(0, 200);
    $(
      "script, style, template, noscript, svg, nav, header, footer, aside, form, [hidden], [aria-hidden=true]",
    ).remove();
    $("p, h1, h2, h3, h4, h5, h6, li, blockquote, pre, div, tr, br").append("\n");
    $("td, th").append(" ");
    const primary = $("main, [role=main], article").first();
    const body = clean(primary.text()) ? primary : $("body");
    text = clean(body.text());
    const visibleText = text.slice(0, WEB_PAGE_TEXT_LIMIT);
    const requestedId = fragmentId(requestedFragment);
    const elements = body.find("[id], a[name]").addBack("[id]").toArray();
    const requested = requestedId
      ? elements.find(
          (element) => ($(element).attr("id") ?? $(element).attr("name")) === requestedId,
        )
      : undefined;
    const headings = elements.filter((element) => $(element).is("h1, h2, h3, h4, h5, h6"));
    const seen = new Set<string>();
    for (const element of requested ? [requested, ...headings] : headings) {
      const target = $(element);
      const id = target.attr("id") ?? target.attr("name");
      const section = clean(target.text()).slice(0, 200);
      if (!id || seen.has(id) || (element !== requested && !visibleText.includes(section)))
        continue;
      if (!section && element !== requested) continue;
      const link = new URL(document.url);
      link.hash = encodeURIComponent(id);
      if (!webLink(link.href)) continue;
      seen.add(id);
      sections.push({
        title: title || document.url.hostname,
        url: link.href,
        section: section || id,
      });
      if (sections.length >= WEB_SOURCE_LIMIT - 1) break;
    }
  }
  if (!text) throw new Error(WEB_EMPTY_PAGE);
  return {
    source: { title: title || document.url.hostname, url: document.url.href },
    sections,
    text: text.slice(0, WEB_PAGE_TEXT_LIMIT).replace(/[\ud800-\udbff]$/, ""),
    truncated: document.truncated || text.length > WEB_PAGE_TEXT_LIMIT,
  };
}

function resultUrl(value: string, base: URL): string | undefined {
  const link = URL.parse(value, base);
  if (!link) return undefined;
  const wrapper =
    [base.hostname, "duckduckgo.com"].includes(link.hostname) && link.pathname === "/l/";
  try {
    const target = wrapper ? (link.searchParams.get("uddg") ?? "") : link.href;
    const url = publicWebUrl(target);
    url.hash = webLink(target)?.hash ?? "";
    return webLink(url.href)?.href;
  } catch {
    return undefined;
  }
}

export function searchContent(document: WebDocument): WebHit[] {
  const $ = loadBuffer(document.bytes, {
    encoding: { transportLayerEncodingLabel: charset(document.contentType) ?? "utf-8" },
  });
  const seen = new Set<string>();
  const hits: WebHit[] = [];
  for (const element of $(".result").toArray()) {
    const result = $(element);
    if (result.hasClass("result--ad") || result.find(".badge--ad, .result__badge--ad").length)
      continue;
    const link = result.find("a.result__a").first();
    const href = link.attr("href");
    const url = href && resultUrl(href, document.url);
    if (!url || seen.has(url)) continue;
    seen.add(url);
    hits.push({
      url,
      title: clean(link.text()).slice(0, 200) || new URL(url).hostname,
      snippet: clean(result.find(".result__snippet").first().text()).slice(0, WEB_SNIPPET_LIMIT),
    });
    if (hits.length >= WEB_SOURCE_LIMIT) break;
  }
  if (!hits.length && !$(".no-results, .result--no-result").length)
    throw new Error(WEB_SEARCH_UNAVAILABLE);
  return hits;
}
