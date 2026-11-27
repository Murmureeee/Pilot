// @env node
import { createHmac, randomBytes } from "node:crypto";

import type { StreamableHttpTransportOptions } from "@earendil-works/pi-mcp";
import {
  authorizeMcp,
  listenForLoopbackSignIn,
  McpOAuthAuthorizationRequiredError,
  McpOAuthProvider,
  MemoryOAuthStateStore,
  parseWwwAuthenticate,
  stepUpScope,
  waitForLoopbackSignIn,
  type OAuthChallenge,
  type McpOAuthState,
  type OAuthCallbackPage,
} from "@earendil-works/pi-mcp/oauth";

import type { Locale } from "@shared/contract";
import type { McpOAuthInfo } from "@shared/mcp";

import { LOCALE_DETAILS } from "../../../../shared/constants";
import { APP_NAME } from "../../../../shared/constants";
import { isLoopbackHost } from "../../../../shared/mcp";
import { mcpConnectionBinding } from "../../../settings/mcp";
import { decryptSecret, encryptSecret } from "../../../settings/secrets";
import type { McpServerConfig, Settings } from "../../../settings/types";
import {
  MCP_OAUTH_BROWSER_FAILED,
  MCP_OAUTH_BUSY,
  MCP_OAUTH_CHANGED,
  MCP_OAUTH_FAILED,
  MCP_OAUTH_REFRESH_SKEW_MS,
  MCP_OAUTH_REQUEST_TIMEOUT_MS,
  MCP_OAUTH_SIGN_IN_TIMEOUT_MS,
  MCP_OAUTH_TIMEOUT,
} from "./constants";
import type { McpOAuthAttempt, McpOAuthEndpoint, McpOAuthOptions, McpOAuthStored } from "./types";

const revisionKey = randomBytes(32);
type OAuthTransportProvider = NonNullable<StreamableHttpTransportOptions["authProvider"]>;
type OAuthFetch = NonNullable<StreamableHttpTransportOptions["fetch"]>;

function mayUseUrl(url: URL, loopback: boolean): boolean {
  if (url.username || url.password) return false;
  if (isLoopbackHost(url.hostname)) {
    return loopback && (url.protocol === "http:" || url.protocol === "https:");
  }
  return url.protocol === "https:";
}

export function mcpOAuthEndpoint(
  config: McpServerConfig,
  url: string,
  headers: Record<string, string> | undefined,
): McpOAuthEndpoint | undefined {
  const endpoint = URL.parse(url);
  if (
    !endpoint ||
    !mayUseUrl(endpoint, isLoopbackHost(endpoint.hostname)) ||
    new Headers(headers).has("Authorization")
  )
    return;
  const binding = mcpConnectionBinding(config);
  return {
    id: config.id,
    revision: createHmac("sha256", revisionKey)
      .update(JSON.stringify([config.id, binding, endpoint.href]))
      .digest("hex"),
    url: endpoint,
    binding,
    project: config.project?.directory,
    client: config.oauthClient,
  };
}

function bearerChallenge(value: string | null): OAuthChallenge | undefined {
  return !value || /^\s*Bearer(?:\s|$)/i.test(value) ? parseWwwAuthenticate(value) : undefined;
}

const OAUTH_CALLBACK_COPY = {
  zh: { success: "已收到授权响应。请返回 Pilot。", error: "授权未完成。请返回 Pilot 重试。" },
  "zh-TW": { success: "已收到授權回應。請返回 Pilot。", error: "授權未完成。請返回 Pilot 重試。" },
  en: {
    success: "Authorization received. Return to Pilot.",
    error: "Authorization failed. Return to Pilot to try again.",
  },
} satisfies Record<Locale, { success: string; error: string }>;

function callbackPage(locale: Locale, { ok }: OAuthCallbackPage): string {
  const copy = OAUTH_CALLBACK_COPY[locale];
  const label = ok ? copy.success : copy.error;
  return `<!doctype html><html lang="${LOCALE_DETAILS[locale].htmlLang}"><meta charset="utf-8"><title>Pilot</title><p>${label}</p></html>`;
}

function browserSignInError(error: unknown, timedOut: boolean): Error {
  if (timedOut) return new Error(MCP_OAUTH_TIMEOUT);
  if (
    error instanceof Error &&
    (error.message === MCP_OAUTH_CHANGED || error.message === MCP_OAUTH_BROWSER_FAILED)
  )
    return error;
  // OAuth error descriptions may contain credentials or response bodies.
  return new Error(MCP_OAUTH_FAILED);
}

function oauthProvider(
  endpoint: McpOAuthEndpoint,
  store: MemoryOAuthStateStore,
  redirectUrl: string,
  onRedirect: (url: URL) => void,
): McpOAuthProvider {
  return new McpOAuthProvider({
    serverUrl: endpoint.url,
    store,
    redirectUrl,
    clientId: endpoint.client?.clientId,
    clientMetadata: { client_name: APP_NAME, application_type: "native" },
    onRedirect,
  });
}

export class McpOAuth {
  private readonly attempts = new Map<string, McpOAuthAttempt>();
  private readonly challenges = new Map<string, OAuthChallenge>();
  private readonly refreshes = new Map<string, Promise<boolean>>();

  constructor(private readonly options: McpOAuthOptions) {}

  private read(endpoint: McpOAuthEndpoint): McpOAuthStored | undefined {
    const record = this.options.getSettings().mcpOAuth?.[endpoint.id];
    if (record?.binding !== endpoint.binding) return;
    const raw = decryptSecret(record.encryptedState, true);
    if (!raw) return { record };
    try {
      const state = JSON.parse(raw) as McpOAuthState;
      if (state?.serverUrl === endpoint.url.href) return { record, state };
    } catch {
      // An unreadable grant requires a new sign-in.
    }
    return;
  }

  private async save(
    endpoint: McpOAuthEndpoint,
    state: McpOAuthState,
    isCurrent: (settings: Settings) => boolean,
  ): Promise<boolean> {
    const { codeVerifier: _codeVerifier, oauthState: _oauthState, ...grant } = state;
    const encryptedState = await encryptSecret(JSON.stringify(grant), true);
    const settings = this.options.getSettings();
    if (!isCurrent(settings)) return false;
    this.options.saveSettings({
      ...settings,
      mcpOAuth: {
        ...settings.mcpOAuth,
        [endpoint.id]: {
          binding: endpoint.binding,
          project: endpoint.project,
          encryptedState,
        },
      },
    });
    return true;
  }

  info(endpoint: McpOAuthEndpoint): McpOAuthInfo {
    const saved = this.read(endpoint);
    const state = saved?.state;
    const expired = state?.tokensExpireAt !== undefined && state.tokensExpireAt <= Date.now();
    return {
      id: endpoint.id,
      revision: endpoint.revision,
      origin: endpoint.url.origin,
      hasCredentials: Boolean(saved),
      status:
        this.challenges.has(endpoint.revision) ||
        (saved && (!state?.tokens || (expired && !state.tokens.refresh_token)))
          ? "required"
          : state?.tokens
            ? "signed-in"
            : "available",
    };
  }

  private requestFor(endpoint: McpOAuthEndpoint): OAuthFetch {
    const loopback = isLoopbackHost(endpoint.url.hostname);
    return (input, init) => {
      const url = new URL(input);
      if (!mayUseUrl(url, loopback)) throw new Error(MCP_OAUTH_FAILED);
      const timeout = AbortSignal.timeout(MCP_OAUTH_REQUEST_TIMEOUT_MS);
      return this.options.request(url, {
        ...init,
        redirect: "error",
        credentials: "omit",
        signal: init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout,
      });
    };
  }

  recordChallenge(endpoint: McpOAuthEndpoint, header: string | null): boolean {
    const challenge = bearerChallenge(header);
    if (!challenge) return false;
    this.challenges.set(endpoint.revision, challenge);
    return true;
  }

  provider(endpoint: McpOAuthEndpoint): OAuthTransportProvider {
    return {
      token: async () => {
        const state = this.read(endpoint)?.state;
        const token = state?.tokens?.access_token;
        const expires = state?.tokensExpireAt;
        if (
          token &&
          state?.tokens?.refresh_token &&
          expires !== undefined &&
          expires <= Date.now() + MCP_OAUTH_REFRESH_SKEW_MS
        )
          await this.refresh(endpoint, token).catch(() => false);
        const latest = this.read(endpoint)?.state;
        return latest?.tokensExpireAt !== undefined && latest.tokensExpireAt <= Date.now()
          ? undefined
          : latest?.tokens?.access_token;
      },
      onUnauthorized: async ({ response, token }) => {
        const challenge = bearerChallenge(response.headers.get("www-authenticate"));
        if (!challenge) return;
        if (
          challenge.error !== "insufficient_scope" &&
          (await this.refresh(endpoint, token).catch(() => false))
        )
          return;
        this.challenges.set(endpoint.revision, challenge);
        throw new McpOAuthAuthorizationRequiredError();
      },
    };
  }

  private refresh(endpoint: McpOAuthEndpoint, token: string | undefined): Promise<boolean> {
    const key = endpoint.revision;
    const existing = this.refreshes.get(key);
    if (existing) return existing;
    const pending = this.refreshCurrent(endpoint, token).finally(() => this.refreshes.delete(key));
    this.refreshes.set(key, pending);
    return pending;
  }

  private async refreshCurrent(
    endpoint: McpOAuthEndpoint,
    token: string | undefined,
  ): Promise<boolean> {
    const saved = this.read(endpoint);
    const state = saved?.state;
    if (!state?.tokens || !saved) return false;
    if (token && state.tokens.access_token !== token) return true;
    if (!state.tokens.refresh_token) return false;
    const store = new MemoryOAuthStateStore();
    store.save(state);
    const provider = oauthProvider(endpoint, store, "http://127.0.0.1/callback", () => {});
    const result = await authorizeMcp(provider, {
      serverUrl: endpoint.url,
      fetch: this.requestFor(endpoint),
      refreshOnly: true,
    });
    const latest = this.read(endpoint);
    // A sign-out or a new grant invalidates an in-flight refresh's write.
    if (latest?.record.encryptedState !== saved.record.encryptedState)
      return Boolean(latest?.state?.tokens);
    const next = store.load();
    if (next && (result === "AUTHORIZED" || !next.tokens)) {
      const updated = await this.save(endpoint, next, (settings) => {
        const record = settings.mcpOAuth?.[endpoint.id];
        return (
          record?.binding === endpoint.binding &&
          record.encryptedState === saved.record.encryptedState
        );
      });
      if (!updated) return Boolean(this.read(endpoint)?.state?.tokens);
    }
    if (result === "AUTHORIZED") this.challenges.delete(endpoint.revision);
    return result === "AUTHORIZED";
  }

  signIn(
    endpoint: McpOAuthEndpoint,
    requestId: string,
    locale: Locale,
    isCurrent: () => boolean,
  ): Promise<boolean> {
    if (this.attempts.has(endpoint.id)) throw new Error(MCP_OAUTH_BUSY);
    const controller = new AbortController();
    const done = this.browserSignIn(endpoint, locale, controller.signal, isCurrent).finally(() =>
      this.attempts.delete(endpoint.id),
    );
    this.attempts.set(endpoint.id, { requestId, controller, done });
    return done;
  }

  private async browserSignIn(
    endpoint: McpOAuthEndpoint,
    locale: Locale,
    cancelled: AbortSignal,
    isCurrent: () => boolean,
  ): Promise<boolean> {
    const timeout = AbortSignal.timeout(MCP_OAUTH_SIGN_IN_TIMEOUT_MS);
    const signal = AbortSignal.any([cancelled, timeout]);
    const store = new MemoryOAuthStateStore();
    const challenge = this.challenges.get(endpoint.revision);
    try {
      const { callback, redirectUrl } = await listenForLoopbackSignIn({
        serverUrl: endpoint.url.href,
        settings: endpoint.client ?? {},
        store,
        renderPage: (page) => callbackPage(locale, page),
      });
      try {
        let authorizationUrl: URL | undefined;
        const provider = oauthProvider(endpoint, store, redirectUrl, (url) => {
          authorizationUrl = url;
        });
        const scopes = [
          endpoint.client?.scope,
          stepUpScope(
            challenge?.error === "insufficient_scope"
              ? this.read(endpoint)?.state?.tokens?.scope
              : undefined,
            challenge?.scope,
          ),
        ];
        const scope = [
          ...new Set(scopes.flatMap((item) => item?.split(/\s+/).filter(Boolean) ?? [])),
        ].join(" ");
        const flow = {
          serverUrl: endpoint.url,
          fetch: this.requestFor(endpoint),
          signal,
          resourceMetadataUrl: challenge?.resourceMetadataUrl,
          scope,
        };
        await authorizeMcp(provider, { ...flow, skipRefresh: true });
        const url = authorizationUrl;
        if (!url || !mayUseUrl(url, isLoopbackHost(endpoint.url.hostname)))
          throw new Error(MCP_OAUTH_FAILED);
        const state = await provider.state();
        if (!isCurrent()) throw new Error(MCP_OAUTH_CHANGED);
        signal.throwIfAborted();
        const response = waitForLoopbackSignIn({
          callback,
          authorization: { kind: "redirect", authorizationUrl: url.href, redirectUrl, state },
          signal,
        });
        void response.catch(() => {});
        await this.options.openBrowser(url.href).catch(() => {
          throw new Error(MCP_OAUTH_BROWSER_FAILED);
        });
        const code = await response;
        if (!isCurrent()) throw new Error(MCP_OAUTH_CHANGED);
        await authorizeMcp(provider, {
          ...flow,
          scope: url.searchParams.get("scope") ?? scope,
          authorizationCode: code.code,
          authorizationRedirectUrl: redirectUrl,
          iss: code.iss,
        });
      } finally {
        await callback.close();
      }
    } catch (error) {
      if (cancelled.aborted) return false;
      throw browserSignInError(error, timeout.aborted);
    }
    if (cancelled.aborted) return false;
    if (!isCurrent()) throw new Error(MCP_OAUTH_CHANGED);
    const grant = store.load();
    if (!grant?.tokens) throw new Error(MCP_OAUTH_FAILED);
    const saved = await this.save(endpoint, grant, () => {
      if (cancelled.aborted) return false;
      if (!isCurrent()) throw new Error(MCP_OAUTH_CHANGED);
      return true;
    });
    if (!saved) return false;
    this.challenges.delete(endpoint.revision);
    return true;
  }

  cancel(requestId?: string): void {
    for (const attempt of this.attempts.values()) {
      if (requestId === undefined || attempt.requestId === requestId) attempt.controller.abort();
    }
  }

  signOut(endpoint: McpOAuthEndpoint): void {
    this.attempts.get(endpoint.id)?.controller.abort();
    this.challenges.delete(endpoint.revision);
    const settings = this.options.getSettings();
    const grants = { ...settings.mcpOAuth };
    delete grants[endpoint.id];
    this.options.saveSettings({ ...settings, mcpOAuth: grants });
  }

  async close(): Promise<void> {
    this.cancel();
    await Promise.allSettled([
      ...[...this.attempts.values()].map(({ done }) => done),
      ...this.refreshes.values(),
    ]);
  }
}
