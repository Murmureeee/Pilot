// @env node
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { once } from "node:events";
import { createServer } from "node:http";

export async function startMcpOAuthFixture() {
  let origin;
  let access;
  let refresh;
  let rejectedRefresh = false;
  const clients = new Map();
  const codes = new Map();
  const seen = { registered: 0, authorized: 0, refreshed: 0, authenticated: 0 };
  const reply = (response, value, status = 200) => {
    response.writeHead(status, { "Content-Type": "application/json" });
    response.end(JSON.stringify(value));
  };
  const grant = (response) => {
    access = "fixture-access-" + randomUUID();
    refresh = "fixture-refresh-" + randomUUID();
    reply(response, { access_token: access, refresh_token: refresh, expires_in: 3600, token_type: "Bearer" });
  };
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url, origin);
      const resource = origin + "/mcp";
      if (url.pathname === "/.well-known/oauth-protected-resource/mcp") {
        reply(response, { resource, authorization_servers: [origin], scopes_supported: ["tools"] });
        return;
      }
      if (url.pathname === "/.well-known/oauth-authorization-server") {
        reply(response, {
          issuer: origin,
          authorization_endpoint: origin + "/authorize",
          registration_endpoint: origin + "/register",
          token_endpoint: origin + "/token",
          response_types_supported: ["code"],
          code_challenge_methods_supported: ["S256"],
          token_endpoint_auth_methods_supported: ["none"],
          authorization_response_iss_parameter_supported: true,
        });
        return;
      }
      if (url.pathname === "/authorize" && request.method === "GET") {
        const { searchParams } = url;
        const client = searchParams.get("client_id");
        const redirect = searchParams.get("redirect_uri");
        assert.ok(clients.get(client)?.includes(redirect));
        assert.equal(searchParams.get("response_type"), "code");
        assert.equal(searchParams.get("code_challenge_method"), "S256");
        assert.equal(searchParams.get("resource"), resource);
        const code = randomUUID();
        codes.set(code, { client, redirect, challenge: searchParams.get("code_challenge") });
        const location = new URL(redirect);
        location.searchParams.set("state", searchParams.get("state"));
        location.searchParams.set("code", code);
        location.searchParams.set("iss", origin);
        seen.authorized++;
        response.writeHead(302, { Location: location.href }).end();
        return;
      }
      if (request.method !== "POST") {
        response.writeHead(405).end();
        return;
      }
      const chunks = [];
      for await (const chunk of request) chunks.push(chunk);
      const body = Buffer.concat(chunks).toString("utf8");
      if (url.pathname === "/register") {
        const metadata = JSON.parse(body);
        const id = randomUUID();
        clients.set(id, metadata.redirect_uris);
        seen.registered++;
        reply(response, { ...metadata, client_id: id });
      } else if (url.pathname === "/token") {
        const params = new URLSearchParams(body);
        assert.equal(params.get("resource"), resource);
        if (params.get("grant_type") === "refresh_token") {
          seen.refreshed++;
          if (rejectedRefresh || params.get("refresh_token") !== refresh) {
            reply(response, { error: "invalid_grant" }, 400);
            return;
          }
        } else {
          const code = params.get("code");
          const authorization = codes.get(code);
          assert.ok(authorization && codes.delete(code));
          assert.equal(params.get("client_id"), authorization.client);
          assert.equal(params.get("redirect_uri"), authorization.redirect);
          assert.equal(createHash("sha256").update(params.get("code_verifier")).digest("base64url"), authorization.challenge);
        }
        grant(response);
      } else if (url.pathname === "/mcp") {
        if (!access || request.headers.authorization !== "Bearer " + access) {
          response.writeHead(401, {
            "WWW-Authenticate": `Bearer resource_metadata="${origin}/.well-known/oauth-protected-resource/mcp", scope="tools"`,
          }).end();
          return;
        }
        seen.authenticated++;
        const message = JSON.parse(body);
        if (message.id === undefined) {
          response.writeHead(202).end();
          return;
        }
        const results = {
          initialize: {
            protocolVersion: message.params?.protocolVersion,
            capabilities: { tools: {} },
            serverInfo: { name: "Authenticated fixture", version: "1.0" },
          },
          "tools/list": { tools: [{ name: "identity", description: "Read signed-in fixture", inputSchema: { type: "object" } }] },
          "tools/call": { content: [{ type: "text", text: "Signed-in MCP tool executed" }] },
        };
        reply(response, { jsonrpc: "2.0", id: message.id, result: results[message.method] ?? {} });
      } else {
        response.writeHead(404).end();
      }
    } catch {
      response.writeHead(400).end();
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  origin = "http://127.0.0.1:" + server.address().port;
  return {
    url: origin + "/mcp",
    seen,
    expire(revoke = false) {
      access = undefined;
      rejectedRefresh = revoke;
    },
    async close() {
      const closed = once(server, "close");
      server.close();
      server.closeAllConnections();
      await closed;
    },
  };
}
