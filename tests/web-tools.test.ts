// @env node
import { promises as dns, type LookupAddress } from "node:dns";
import { Readable } from "node:stream";

import { request as httpRequest, type Dispatcher } from "undici";
import { afterEach, expect, it, vi } from "vitest";

import { WEB_PAGE_TEXT_LIMIT, WEB_RESPONSE_LIMIT } from "../src/main/web/constants";
import { pageContent, searchContent } from "../src/main/web/content";
import { createSearchRequest, createWebRequest } from "../src/main/web/request";
import { publicWebUrl, webTarget } from "../src/main/web/targets";
import { webSources } from "../src/shared/web";

vi.mock("undici", async (importOriginal) => {
  const undici = await importOriginal<typeof import("undici")>();
  return { ...undici, request: vi.fn<typeof undici.request>() };
});

const pageUrl = "https://www.example.com/docs";
const searchUrl = "https://html.duckduckgo.com/html/";

function document(body: string, url = pageUrl, contentType = "text/html; charset=UTF-8") {
  return { url: new URL(url), contentType, bytes: Buffer.from(body), truncated: false };
}

function response(
  body = "",
  statusCode = 200,
  headers: Record<string, string> = {},
): Dispatcher.ResponseData {
  return {
    statusCode,
    statusText: "",
    headers,
    body: Readable.from([Buffer.from(body)]) as Dispatcher.ResponseData["body"],
    trailers: {},
    opaque: null,
    context: {},
  };
}

function publicDns() {
  const resolver: { lookup(hostname: string, options: { all: true }): Promise<LookupAddress[]> } =
    dns;
  return vi.spyOn(resolver, "lookup").mockResolvedValue([{ address: "93.184.215.14", family: 4 }]);
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.mocked(httpRequest).mockReset();
});

it("normalizes DNS names and exposes exactly the query sent to the search provider", () => {
  expect(publicWebUrl("https://Bücher.example./a#section").href).toBe(
    "https://xn--bcher-kva.example/a",
  );
  for (const url of [
    "file:///tmp/readme",
    "https://account:secret@example.com/",
    "http://localhost/",
    "http://service.internal/",
    "http://127.0.0.1/",
    "http://[::1]/",
  ])
    expect(() => publicWebUrl(url)).toThrow("请输入公开网页的 HTTP 或 HTTPS 地址");
  const target = webTarget("web_search", { query: "  网页 & q=literal  " })!;
  const url = new URL(target.url);
  expect(target).toMatchObject({ domain: "html.duckduckgo.com", query: "网页 & q=literal" });
  expect([...url.searchParams]).toEqual([["q", target.query]]);
});

it("limits the browser transport to the fixed search endpoint and stops on a redirect", async () => {
  const request = vi.fn<typeof fetch>().mockResolvedValue(
    new Response(null, {
      status: 302,
      headers: { location: "https://www.example.com/" },
    }),
  );
  const search = createSearchRequest(request);
  await expect(search(new URL(pageUrl))).rejects.toThrow("DuckDuckGo 暂未返回");
  expect(request).not.toHaveBeenCalled();
  const url = new URL(searchUrl + "?q=fixture");
  await expect(search(url)).rejects.toThrow("DuckDuckGo 暂未返回");
  expect(request).toHaveBeenCalledExactlyOnceWith(
    url,
    expect.objectContaining({ redirect: "manual" }),
  );
});

it("keeps the approved host and connects to its checked address", async () => {
  publicDns();
  vi.mocked(httpRequest).mockResolvedValue(
    response("public body", 200, { "content-type": "text/plain" }),
  );
  const proxy = vi.fn<(url: URL) => Promise<string>>().mockResolvedValue("DIRECT");
  const request = createWebRequest(proxy);
  const target = new URL(pageUrl);
  const result = await request(target);
  expect(result.bytes.toString()).toBe("public body");
  expect(result.url.href).toBe(pageUrl);
  expect(proxy).toHaveBeenCalledExactlyOnceWith(target);
  const [sent, init] = vi.mocked(httpRequest).mock.calls[0];
  expect(String(sent)).toBe("https://93.184.215.14/docs");
  expect(init).toMatchObject({
    headers: { Host: target.host },
  });
});

it("rejects private or mixed DNS responses before fetching anything", async () => {
  const lookup = publicDns();
  const request = createWebRequest(async () => "DIRECT");
  lookup.mockResolvedValueOnce([
    { address: "93.184.215.14", family: 4 },
    { address: "172.16.1.2", family: 4 },
  ]);
  await expect(request(new URL(pageUrl))).rejects.toThrow("该域名未解析到公开地址");
  lookup.mockResolvedValueOnce([{ address: "fd00::2", family: 6 }]);
  await expect(request(new URL(pageUrl))).rejects.toThrow("该域名未解析到公开地址");
  expect(httpRequest).not.toHaveBeenCalled();
});

it("follows same-domain redirects and hands cross-domain targets back for a fresh call", async () => {
  publicDns();
  vi.mocked(httpRequest)
    .mockResolvedValueOnce(response("", 302, { location: "/articles" }))
    .mockResolvedValueOnce(response("", 302, { location: "https://other.example.com/final" }));
  const request = createWebRequest(async () => "DIRECT");
  await expect(request(new URL(pageUrl))).rejects.toThrow(
    /另一个域名[\s\S]*https:\/\/other\.example\.com\/final/,
  );
  expect(vi.mocked(httpRequest).mock.calls.map(([url]) => new URL(String(url)).pathname)).toEqual([
    "/docs",
    "/articles",
  ]);
});

it("caps response bytes and stops before sending a cancelled request", async () => {
  publicDns();
  vi.mocked(httpRequest).mockResolvedValueOnce(response("x".repeat(WEB_RESPONSE_LIMIT + 2)));
  const request = createWebRequest(async () => "DIRECT");
  const result = await request(new URL(pageUrl));
  expect(result.bytes).toHaveLength(WEB_RESPONSE_LIMIT);
  expect(result.truncated).toBe(true);
  await expect(request(new URL(pageUrl), AbortSignal.abort())).rejects.toMatchObject({
    name: "AbortError",
  });
  expect(httpRequest).toHaveBeenCalledTimes(1);
});

it("extracts the page text, decodes entities, drops page chrome and caps model context", () => {
  const result = pageContent(
    document(
      "<title>网页 &amp; 文档</title><nav>menu</nav><main><p>正文 &copy;。</p>" +
        "<script>browserScript()</script><div hidden>hidden text</div><p>" +
        "文".repeat(14_000) +
        "</p></main><footer>footer</footer>",
    ),
  );
  expect(result.source).toEqual({ url: pageUrl, title: "网页 & 文档" });
  expect(result.text.startsWith("正文 ©。")).toBe(true);
  expect(result.text).not.toMatch(/browserScript|hidden text|menu|footer/);
  expect(result.text).toHaveLength(WEB_PAGE_TEXT_LIMIT);
  expect(result.truncated).toBe(true);
});

it("extracts organic search hits, unwraps result URLs and handles empty or unavailable searches", () => {
  const link = "https://www.example.com/article?view=full";
  const row = (title: string, url: string, css = ""): string =>
    '<div class="result ' +
    css +
    '"><a class="result__a" href="' +
    url +
    '">' +
    title +
    '</a><span class="result__snippet">Text &amp; evidence</span></div>';
  const hits = searchContent(
    document(
      row("Ad", "https://ads.example.com/", "result--ad") +
        row("Example docs", "//duckduckgo.com/l/?uddg=" + encodeURIComponent(link)) +
        row("Duplicate", link) +
        row("Bad URL", "javascript:demo"),
      searchUrl,
    ),
  );
  expect(hits).toEqual([{ url: link, title: "Example docs", snippet: "Text & evidence" }]);
  expect(searchContent(document('<div class="no-results"></div>', searchUrl))).toEqual([]);
  expect(() => searchContent(document("<form>Unavailable</form>", searchUrl))).toThrow(
    "DuckDuckGo 暂未返回可读取的搜索结果",
  );
  expect(webSources({ webSources: [...hits, { url: "file:///tmp/example" }] })).toEqual([
    { url: link, title: "Example docs" },
  ]);
});
