// @env node
import { promises as dns } from "node:dns";
import { BlockList, isIP } from "node:net";

import { Agent, ProxyAgent, request, type Dispatcher } from "undici";

import {
  WEB_CONNECTION_FAILED,
  WEB_PRIVATE_ADDRESS,
  WEB_REDIRECT_DOMAIN,
  WEB_REDIRECT_FAILED,
  WEB_REDIRECT_LIMIT,
  WEB_RESPONSE_LIMIT,
  WEB_SEARCH_ENDPOINT,
  WEB_SEARCH_UNAVAILABLE,
  WEB_TIMEOUT,
  WEB_TIMEOUT_MS,
  WEB_UNSUPPORTED_CONTENT,
  WEB_UNSUPPORTED_PROXY,
} from "./constants";
import { publicWebUrl } from "./targets";
import type { ResolveWebProxy, WebDocument, WebRequest } from "./types";

const nonPublic = new BlockList();
for (const [address, prefix] of [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.0.2.0", 24],
  ["192.88.99.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["198.51.100.0", 24],
  ["203.0.113.0", 24],
  ["224.0.0.0", 3],
] as const)
  nonPublic.addSubnet(address, prefix);

const globalIpv6 = new BlockList();
globalIpv6.addSubnet("2000::", 3, "ipv6");
for (const [address, prefix] of [
  ["2001::", 23],
  ["2001:db8::", 32],
  ["2002::", 16],
  ["3fff::", 20],
] as const)
  nonPublic.addSubnet(address, prefix, "ipv6");

const proxySchemes = { PROXY: "http", HTTPS: "https", SOCKS5: "socks5" } as const;
const redirectCodes = new Set([301, 302, 303, 307, 308]);

function publicAddress(address: string): boolean {
  const family = isIP(address);
  if (family === 4) return !nonPublic.check(address, "ipv4");
  return family === 6 && globalIpv6.check(address, "ipv6") && !nonPublic.check(address, "ipv6");
}

function dispatcherFor(route: string, servername: string): Dispatcher {
  const [type, endpoint] = route.split(/\s+/);
  if (type === "DIRECT") return new Agent({ connect: { servername } });
  if (!endpoint || !Object.hasOwn(proxySchemes, type)) throw new Error(WEB_UNSUPPORTED_PROXY);
  const scheme = proxySchemes[type as keyof typeof proxySchemes];
  return new ProxyAgent({ uri: scheme + "://" + endpoint, requestTls: { servername } });
}

async function readBody(
  body: AsyncIterable<Uint8Array> | null,
): Promise<Pick<WebDocument, "bytes" | "truncated">> {
  if (!body) return { bytes: Buffer.alloc(0), truncated: false };
  const chunks: Uint8Array[] = [];
  let length = 0;
  let truncated = false;
  for await (const value of body) {
    const remaining = WEB_RESPONSE_LIMIT - length;
    const chunk = value.subarray(0, remaining);
    chunks.push(chunk);
    length += chunk.length;
    if (value.length > remaining) {
      truncated = true;
      break;
    }
  }
  return { bytes: Buffer.concat(chunks, length), truncated };
}

function responseHeader(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

function redirect(location: string | undefined, url: URL): URL {
  const next = location && URL.parse(location, url);
  if (!next) throw new Error(WEB_REDIRECT_FAILED);
  const target = publicWebUrl(next.href);
  if (target.hostname !== url.hostname) throw new Error(WEB_REDIRECT_DOMAIN + "\n" + target.href);
  if (url.protocol === "https:" && target.protocol !== "https:")
    throw new Error(WEB_REDIRECT_FAILED);
  return target;
}

async function requestPage(
  url: URL,
  signal: AbortSignal,
  resolveProxy: ResolveWebProxy,
  userAgent: string,
): Promise<WebDocument | URL> {
  const [addresses, proxy] = await Promise.all([
    dns.lookup(url.hostname, { all: true }).catch(() => {
      throw new Error(WEB_CONNECTION_FAILED);
    }),
    resolveProxy(url).catch(() => {
      throw new Error(WEB_CONNECTION_FAILED);
    }),
  ]);
  signal.throwIfAborted();
  if (!addresses.length || addresses.some(({ address }) => !publicAddress(address)))
    throw new Error(WEB_PRIVATE_ADDRESS);

  // Connect to the checked IP while preserving the approved HTTP host and TLS identity.
  const route = proxy.split(";", 1)[0].trim();
  const selected = addresses.find(({ family }) => family === 4) ?? addresses[0];
  const destination = new URL(url.href);
  destination.hostname = selected.family === 6 ? "[" + selected.address + "]" : selected.address;
  const dispatcher = dispatcherFor(route, url.hostname);
  try {
    const response = await request(destination, {
      headers: {
        Host: url.host,
        Accept: "text/html, application/xhtml+xml, text/plain",
        "Accept-Encoding": "identity",
        "User-Agent": userAgent,
      },
      signal,
      dispatcher,
    }).catch((error: unknown) => {
      signal.throwIfAborted();
      throw new Error(WEB_CONNECTION_FAILED, { cause: error });
    });
    response.body.on("error", () => {});
    const { statusCode, headers } = response;
    if (redirectCodes.has(statusCode)) return redirect(responseHeader(headers.location), url);
    if (statusCode < 200 || statusCode >= 300)
      throw new Error("网页请求失败。请检查网址后重试。\nHTTP " + statusCode);
    const contentType = responseHeader(headers["content-type"]) ?? "text/html";
    const encoding = responseHeader(headers["content-encoding"]);
    if (!/^(text\/(?:html|plain)|application\/xhtml\+xml)(?:\s*;|$)/i.test(contentType))
      throw new Error(WEB_UNSUPPORTED_CONTENT);
    if (encoding && encoding.toLowerCase() !== "identity") throw new Error(WEB_UNSUPPORTED_CONTENT);
    return { url, contentType, ...(await readBody(response.body)) };
  } finally {
    await dispatcher.destroy();
  }
}

export function createWebRequest(resolveProxy: ResolveWebProxy, userAgent = "Pilot"): WebRequest {
  return async (url, parent) => {
    const lifetime = new AbortController();
    const timer = setTimeout(() => lifetime.abort(new Error(WEB_TIMEOUT)), WEB_TIMEOUT_MS);
    const signal = parent ? AbortSignal.any([parent, lifetime.signal]) : lifetime.signal;
    const aborted = Promise.withResolvers<never>();
    const cancel = (): void => aborted.reject(signal.reason);
    try {
      signal.throwIfAborted();
      signal.addEventListener("abort", cancel, { once: true });
      let target = url;
      for (let hop = 0; hop <= WEB_REDIRECT_LIMIT; hop++) {
        const result = await Promise.race([
          requestPage(target, signal, resolveProxy, userAgent),
          aborted.promise,
        ]);
        if (!(result instanceof URL)) return result;
        target = result;
      }
      throw new Error(WEB_REDIRECT_FAILED);
    } finally {
      clearTimeout(timer);
      signal.removeEventListener("abort", cancel);
    }
  };
}

export function createSearchRequest(browserFetch: typeof globalThis.fetch): WebRequest {
  return async (url, parent) => {
    if (url.origin + url.pathname !== WEB_SEARCH_ENDPOINT) throw new Error(WEB_SEARCH_UNAVAILABLE);
    const timeout = AbortSignal.timeout(WEB_TIMEOUT_MS);
    const signal = parent ? AbortSignal.any([parent, timeout]) : timeout;
    try {
      const response = await browserFetch(url, { redirect: "manual", signal });
      const contentType = response.headers.get("content-type") ?? "";
      if (!response.ok || !/^text\/html(?:\s*;|$)/i.test(contentType)) {
        await response.body?.cancel();
        throw new Error(WEB_SEARCH_UNAVAILABLE);
      }
      return { url, contentType, ...(await readBody(response.body)) };
    } catch (error) {
      parent?.throwIfAborted();
      if (timeout.aborted) throw new Error(WEB_TIMEOUT, { cause: error });
      throw new Error(WEB_SEARCH_UNAVAILABLE, { cause: error });
    }
  };
}
