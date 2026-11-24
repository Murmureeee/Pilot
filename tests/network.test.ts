// @env node
import type { Session } from "electron";
import { expect, it, vi } from "vitest";

import { createDesktopNetwork } from "../src/main/network";

function fixtureSession() {
  const request = vi.fn<Session["fetch"]>().mockImplementation(async () => new Response("ok"));
  const setProxy = vi.fn<Session["setProxy"]>().mockResolvedValue(undefined);
  const session = { fetch: request, setProxy };
  return { session, request, setProxy };
}

it("inherits the system configuration and isolates requests from session cookies", async () => {
  const { session, request, setProxy } = fixtureSession();
  const network = createDesktopNetwork(session, {});
  const input = new Request("https://example.test/", {
    headers: { Authorization: "Bearer fixture" },
  });
  expect(await network.fetch(input)).toBeInstanceOf(Response);
  expect(setProxy).not.toHaveBeenCalled();
  expect(request).toHaveBeenCalledExactlyOnceWith(input, {
    credentials: "omit",
    bypassCustomProtocolHandlers: true,
  });
});

it("configures each session once with protocol-specific environment rules and bypasses", async () => {
  const { session, request, setProxy } = fixtureSession();
  const update = fixtureSession();
  const network = createDesktopNetwork(session, {
    HTTP_PROXY: "127.0.0.1:1234",
    https_proxy: "https://secure-proxy.test:9443",
    HTTPS_PROXY: "http://other-proxy.test:7777",
    NO_PROXY: "localhost, .internal.test, 192.0.2.1:8080",
  });
  await Promise.all([
    network.fetch(new URL("https://example.test/")),
    network.fetch("http://example.test/"),
    network.configureProxy(update.session),
  ]);
  const rules = {
    mode: "fixed_servers",
    proxyRules: "http=http://127.0.0.1:1234;https=https://secure-proxy.test:9443",
    proxyBypassRules: "localhost,*.internal.test,192.0.2.1:8080",
  };
  expect(setProxy).toHaveBeenCalledExactlyOnceWith(rules);
  expect(update.setProxy).toHaveBeenCalledExactlyOnceWith(rules);
  expect(request.mock.calls.map(([url]) => url)).toEqual([
    "https://example.test/",
    "http://example.test/",
  ]);
});

it("keeps cancelled requests off the wire while the proxy session is being configured", async () => {
  const { session, request, setProxy } = fixtureSession();
  const pending = Promise.withResolvers<void>();
  setProxy.mockReturnValueOnce(pending.promise);
  const network = createDesktopNetwork(session, { HTTPS_PROXY: "http://127.0.0.1:1234" });
  const controller = new AbortController();
  const result = network.fetch("https://example.test/", { signal: controller.signal });
  await vi.waitFor(() => expect(setProxy).toHaveBeenCalledOnce());
  controller.abort();
  pending.resolve();
  await expect(result).rejects.toMatchObject({ name: "AbortError" });
  expect(request).not.toHaveBeenCalled();
});

it("rejects invalid proxy addresses and non-HTTP requests before contacting the network", async () => {
  const { session, request, setProxy } = fixtureSession();
  const network = createDesktopNetwork(session, { HTTPS_PROXY: "ftp://proxy.test" });
  await expect(network.fetch("https://example.test/")).rejects.toThrow(
    "无法使用环境变量中的代理地址",
  );
  await expect(network.fetch("file:///tmp/private")).rejects.toThrow("Only HTTP and HTTPS");
  expect(setProxy).not.toHaveBeenCalled();
  expect(request).not.toHaveBeenCalled();
});
