// @env node
import type { ProxyConfig, Session } from "electron";

import { INVALID_ENVIRONMENT_PROXY } from "./constants";
import type { DesktopNetwork } from "./types";

function proxyAddress(value: string): string {
  let url: URL;
  try {
    url = new URL(value.includes("://") ? value : "http://" + value);
  } catch {
    throw new Error(INVALID_ENVIRONMENT_PROXY);
  }
  if (
    !["http:", "https:", "socks4:", "socks5:"].includes(url.protocol) ||
    !url.hostname ||
    url.username ||
    url.password ||
    (url.pathname && url.pathname !== "/") ||
    url.search ||
    url.hash
  ) {
    throw new Error(INVALID_ENVIRONMENT_PROXY);
  }
  return url.protocol + "//" + url.host;
}

function environmentProxy(env: NodeJS.ProcessEnv): ProxyConfig | undefined {
  const http = env.http_proxy?.trim() || env.HTTP_PROXY?.trim();
  const https = env.https_proxy?.trim() || env.HTTPS_PROXY?.trim() || http;
  if (!http && !https) return undefined;
  const bypass = env.no_proxy?.trim() || env.NO_PROXY?.trim() || "";
  return {
    mode: "fixed_servers",
    proxyRules: [http && "http=" + proxyAddress(http), https && "https=" + proxyAddress(https)]
      .filter(Boolean)
      .join(";"),
    proxyBypassRules: bypass
      .split(",")
      .map((rule) => rule.trim())
      .filter(Boolean)
      .map((rule) => (rule.startsWith(".") ? "*" + rule : rule))
      .join(","),
  };
}

export function createDesktopNetwork(
  networkSession: Pick<Session, "fetch" | "setProxy">,
  env = process.env,
): DesktopNetwork {
  const configured = new WeakMap<Pick<Session, "setProxy">, Promise<void>>();
  const configureProxy: DesktopNetwork["configureProxy"] = (target) => {
    const existing = configured.get(target);
    if (existing) return existing;
    const pending = Promise.resolve()
      .then(async () => {
        const proxy = environmentProxy(env);
        if (proxy) await target.setProxy(proxy);
      })
      .catch((error: unknown) => {
        configured.delete(target);
        throw error;
      });
    configured.set(target, pending);
    return pending;
  };
  return {
    configureProxy,
    fetch: async (input, init) => {
      const request = input instanceof URL ? input.href : input;
      const url = new URL(typeof request === "string" ? request : request.url);
      if (url.protocol !== "https:" && url.protocol !== "http:")
        throw new TypeError("Only HTTP and HTTPS requests are supported");
      const signal = init?.signal ?? (typeof request === "string" ? undefined : request.signal);
      signal?.throwIfAborted();
      await configureProxy(networkSession);
      signal?.throwIfAborted();
      return networkSession.fetch(request, {
        ...init,
        credentials: "omit",
        bypassCustomProtocolHandlers: true,
      });
    },
  };
}
