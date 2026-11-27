// @env node
import { createHash, randomUUID } from "node:crypto";

import { McpOAuthAuthorizationRequiredError } from "@earendil-works/pi-mcp/oauth";
import { describe, expect, it, vi } from "vitest";

import { McpOAuth, mcpOAuthEndpoint } from "../src/main/agent-host/mcp/oauth";
import { MCP_OAUTH_CHANGED } from "../src/main/agent-host/mcp/oauth/constants";
import type { McpOAuthOptions } from "../src/main/agent-host/mcp/oauth/types";
import { pruneMcpOAuth } from "../src/main/settings/mcp";
import type { McpServerConfig, Settings } from "../src/main/settings/types";

vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => true,
    isAsyncEncryptionAvailable: async () => true,
    encryptStringAsync: async (plain: string) => Buffer.from(plain, "utf8"),
    getSelectedStorageBackend: () => "gnome_libsecret",
    encryptString: (plain: string) => Buffer.from(plain, "utf8"),
    decryptString: (cipher: Buffer) => cipher.toString("utf8"),
  },
}));

const issuer = "https://identity.example.test";
const resource = "https://mcp.example.test/api";
const tokenUrl = issuer + "/token";
const bearer =
  'Bearer resource_metadata="https://mcp.example.test/.well-known/oauth-protected-resource/api"';

function server(): McpServerConfig {
  return {
    id: randomUUID(),
    name: "Example",
    enabled: true,
    policy: "confirm",
    transport: { type: "http", url: resource },
  };
}

function setup(): {
  config: McpServerConfig;
  oauth: McpOAuth;
  request: ReturnType<typeof vi.fn<McpOAuthOptions["request"]>>;
  openBrowser: ReturnType<typeof vi.fn<McpOAuthOptions["openBrowser"]>>;
  settings(): Settings;
  setSettings(next: Settings): void;
  callback(url: string): URL;
  tokenRequests: URLSearchParams[];
  setRefresh(handler: (params: URLSearchParams) => Promise<Response>): void;
} {
  const config = server();
  let settings: Settings = { providers: [], activeProviderId: "", mcpServers: [config] };
  const tokenRequests: URLSearchParams[] = [];
  let receipt: URL;
  const grant = (suffix: string): Response =>
    Response.json({
      access_token: "access-" + suffix,
      refresh_token: "refresh-" + suffix,
      token_type: "Bearer",
      expires_in: 3600,
    });
  let refresh: (params: URLSearchParams) => Promise<Response> = async () => grant("rotated");
  const request = vi.fn<McpOAuthOptions["request"]>(async (input, init) => {
    expect(init?.redirect).toBe("error");
    const url = new URL(String(input));
    if (url.hostname === "mcp.example.test")
      return Response.json({ resource, authorization_servers: [issuer] });
    if (url.pathname === "/.well-known/oauth-authorization-server")
      return Response.json({
        issuer,
        authorization_endpoint: issuer + "/authorize",
        token_endpoint: tokenUrl,
        registration_endpoint: issuer + "/register",
        response_types_supported: ["code"],
        code_challenge_methods_supported: ["S256"],
        authorization_response_iss_parameter_supported: true,
      });
    if (url.pathname === "/register") {
      const body = JSON.parse(String(init?.body)) as { redirect_uris: string[] };
      return Response.json({ ...body, client_id: "fixture-client" });
    }
    expect(url.href).toBe(tokenUrl);
    const params = new URLSearchParams(String(init?.body));
    tokenRequests.push(params);
    if (params.get("grant_type") === "refresh_token") return refresh(params);
    const verifier = params.get("code_verifier") ?? "";
    expect(createHash("sha256").update(verifier).digest("base64url")).toBe(
      receipt.searchParams.get("code_challenge"),
    );
    expect(params.get("redirect_uri")).toBe(receipt.searchParams.get("redirect_uri"));
    expect(params.get("code")).toBe("fixture-code");
    expect(params.get("resource")).toBe(resource);
    return grant("initial");
  });
  const callback = (input: string): URL => {
    receipt = new URL(input);
    expect(receipt.origin).toBe(issuer);
    expect(receipt.searchParams.get("code_challenge_method")).toBe("S256");
    expect(receipt.searchParams.get("resource")).toBe(resource);
    const redirect = new URL(receipt.searchParams.get("redirect_uri")!);
    redirect.searchParams.set("code", "fixture-code");
    redirect.searchParams.set("state", receipt.searchParams.get("state")!);
    redirect.searchParams.set("iss", issuer);
    return redirect;
  };
  const openBrowser = vi.fn<McpOAuthOptions["openBrowser"]>(async (url) => {
    const response = await fetch(callback(url));
    expect(response.status).toBe(200);
    await response.text();
  });
  const setSettings = (next: Settings): void => {
    settings = pruneMcpOAuth(next);
  };
  return {
    config,
    request,
    openBrowser,
    callback,
    tokenRequests,
    setSettings,
    settings: () => settings,
    setRefresh: (handler) => {
      refresh = handler;
    },
    oauth: new McpOAuth({
      getSettings: () => settings,
      saveSettings: setSettings,
      request,
      openBrowser,
    }),
  };
}

function unauthorized(): Parameters<
  NonNullable<ReturnType<McpOAuth["provider"]>["onUnauthorized"]>
>[0] {
  return {
    response: new Response(null, { status: 401, headers: { "WWW-Authenticate": bearer } }),
    serverUrl: new URL(resource),
    fetch,
    token: "access-initial",
  };
}

describe("MCP OAuth", () => {
  it("validates the browser callback state, encrypts the grant and refreshes a rotating token once", async () => {
    const fixture = setup();
    const { oauth, config, openBrowser } = fixture;
    const endpoint = mcpOAuthEndpoint(config, resource, undefined)!;
    try {
      openBrowser.mockImplementationOnce(async (url) => {
        const redirect = fixture.callback(url);
        const wrong = new URL(redirect);
        wrong.searchParams.set("state", "wrong");
        expect((await fetch(wrong)).status).toBe(400);
        expect(fixture.tokenRequests).toHaveLength(0);
        expect((await fetch(redirect)).status).toBe(200);
      });
      expect(await oauth.signIn(endpoint, randomUUID(), "en", () => true)).toBe(true);
      const registration = fixture.request.mock.calls.find(
        ([url]) => String(url) === issuer + "/register",
      );
      expect(JSON.parse(String(registration?.[1]?.body)).redirect_uris[0]).toMatch(
        /^http:\/\/127\.0\.0\.1:\d+\/callback$/,
      );
      expect(oauth.info(endpoint).status).toBe("signed-in");
      const sealed = fixture.settings().mcpOAuth?.[config.id]?.encryptedState;
      expect(sealed).toBeTruthy();
      expect(JSON.stringify(fixture.settings())).not.toContain("access-initial");
      const stored = JSON.parse(Buffer.from(sealed!, "base64").toString("utf8")) as object;
      expect(stored).not.toHaveProperty("codeVerifier");
      expect(stored).not.toHaveProperty("oauthState");
      const provider = oauth.provider(endpoint);
      expect(await provider.token()).toBe("access-initial");
      await Promise.all([
        provider.onUnauthorized!(unauthorized()),
        provider.onUnauthorized!(unauthorized()),
      ]);
      expect(fixture.tokenRequests.map((params) => params.get("grant_type"))).toEqual([
        "authorization_code",
        "refresh_token",
      ]);
      expect(await provider.token()).toBe("access-rotated");
      expect(openBrowser).toHaveBeenCalledOnce();
    } finally {
      await oauth.close();
    }
  });

  it("cancels the listener, rejects a stale connection and preserves credentials on cancellation", async () => {
    const fixture = setup();
    const { oauth, config, openBrowser } = fixture;
    const endpoint = mcpOAuthEndpoint(config, resource, undefined)!;
    try {
      expect(await oauth.signIn(endpoint, randomUUID(), "en", () => true)).toBe(true);
      const original = fixture.settings().mcpOAuth;
      const opened = Promise.withResolvers<URL>();
      openBrowser.mockImplementationOnce(async (url) => {
        opened.resolve(fixture.callback(url));
      });
      const id = randomUUID();
      const pending = oauth.signIn(endpoint, id, "zh", () => true);
      const redirect = await opened.promise;
      oauth.cancel(id);
      expect(await pending).toBe(false);
      await expect(fetch(redirect)).rejects.toThrow(/fetch failed/);
      expect(fixture.settings().mcpOAuth).toEqual(original);
      await expect(oauth.signIn(endpoint, randomUUID(), "en", () => false)).rejects.toThrow(
        MCP_OAUTH_CHANGED,
      );
      expect(openBrowser).toHaveBeenCalledTimes(2);
    } finally {
      await oauth.close();
    }
  });

  it("requires a new sign-in when the refresh grant is revoked and never restores a signed-out grant", async () => {
    const fixture = setup();
    const { oauth, config } = fixture;
    const endpoint = mcpOAuthEndpoint(config, resource, undefined)!;
    try {
      await oauth.signIn(endpoint, randomUUID(), "en", () => true);
      const provider = oauth.provider(endpoint);
      fixture.setRefresh(async () => Response.json({ error: "invalid_grant" }, { status: 400 }));
      await expect(provider.onUnauthorized!(unauthorized())).rejects.toBeInstanceOf(
        McpOAuthAuthorizationRequiredError,
      );
      expect(oauth.info(endpoint)).toMatchObject({ status: "required", hasCredentials: true });
      expect(await provider.token()).toBeUndefined();

      await oauth.signIn(endpoint, randomUUID(), "en", () => true);
      const requested = Promise.withResolvers<void>();
      const returned = Promise.withResolvers<Response>();
      fixture.setRefresh(() => {
        requested.resolve();
        return returned.promise;
      });
      await Promise.all([
        expect(provider.onUnauthorized!(unauthorized())).rejects.toBeInstanceOf(
          McpOAuthAuthorizationRequiredError,
        ),
        requested.promise.then(() => {
          oauth.signOut(endpoint);
          returned.resolve(Response.json({ access_token: "late-access", token_type: "Bearer" }));
        }),
      ]);
      expect(fixture.settings().mcpOAuth).toBeUndefined();
      expect(await provider.token()).toBeUndefined();
    } finally {
      await oauth.close();
    }
  });

  it("keeps secrets scoped to the exact configuration and lets existing Authorization headers take precedence", async () => {
    const fixture = setup();
    const { config, oauth } = fixture;
    try {
      expect(mcpOAuthEndpoint(config, "http://mcp.example.test/api", undefined)).toBeUndefined();
      expect(
        mcpOAuthEndpoint(config, resource, { authorization: "Bearer static" }),
      ).toBeUndefined();
      const endpoint = mcpOAuthEndpoint(config, resource, undefined)!;
      await oauth.signIn(endpoint, randomUUID(), "en", () => true);
      const redirected = mcpOAuthEndpoint(config, "https://elsewhere.example.test/api", undefined)!;
      expect(await oauth.provider(redirected).token()).toBeUndefined();
      fixture.setSettings({
        ...fixture.settings(),
        mcpServers: [{ ...config, oauthClient: { clientId: "different" } }],
      });
      expect(fixture.settings().mcpOAuth).toBeUndefined();
      expect(await oauth.provider(endpoint).token()).toBeUndefined();
    } finally {
      await oauth.close();
    }
  });
});
