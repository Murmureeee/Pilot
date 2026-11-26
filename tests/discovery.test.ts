// @env node
import { describe, expect, it, vi } from "vitest";

import { searchMcpRegistry } from "../src/main/discovery/registry";

describe("MCP Registry discovery", () => {
  it("uses the official latest-version search and forwards the pagination cursor", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValue(Response.json({ servers: [], metadata: { nextCursor: "next entry" } }));
    await expect(searchMcpRegistry("tools & docs", "after item+1", fetch)).resolves.toEqual({
      entries: [],
      cursor: "next entry",
    });
    const [target, options] = fetch.mock.calls[0];
    const url = new URL(String(target));
    expect(url.origin).toBe("https://registry.modelcontextprotocol.io");
    expect(url.pathname).toBe("/v0.1/servers");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      version: "latest",
      limit: "24",
      search: "tools & docs",
      cursor: "after item+1",
    });
    expect(options).toMatchObject({ redirect: "error", signal: expect.any(AbortSignal) });
  });

  it("prefills standard transports and leaves required secrets and unresolved values for review", async () => {
    const fetch = vi.fn<typeof globalThis.fetch>().mockResolvedValue(
      Response.json({
        servers: [
          {
            server: {
              name: "io.github.Fixture/example",
              title: "Example",
              version: "1.2.3",
              description: "Example service",
              repository: { url: "https://github.com/Fixture/example" },
              remotes: [
                { type: "sse", url: "https://example.test/sse" },
                {
                  type: "streamable-http",
                  url: "https://{tenant}.example.test/{endpoint}",
                  variables: { endpoint: { default: "mcp" } },
                  headers: [
                    {
                      name: "Authorization",
                      isRequired: true,
                      value: "Bearer {key}",
                      variables: { key: { isSecret: true, default: "fixture-private" } },
                    },
                  ],
                },
              ],
              packages: [
                {
                  registryType: "npm",
                  transport: { type: "stdio" },
                  identifier: "@example/fixture",
                  version: "2.0.0",
                  runtimeHint: "npx",
                  runtimeArguments: [{ type: "positional", value: "-y" }],
                  packageArguments: [
                    { type: "named", name: "--config", isRequired: true },
                    {
                      type: "positional",
                      value: "{mode}",
                      variables: { mode: { default: "normal" } },
                    },
                  ],
                  environmentVariables: [
                    { name: "API_KEY", isRequired: true, isSecret: true, value: "fixture-secret" },
                  ],
                },
                {
                  registryType: "pypi",
                  transport: { type: "stdio" },
                  identifier: "fixture-py",
                  version: "1.2.3",
                  registryBaseUrl: "https://pypi.org/simple/",
                },
                {
                  registryType: "mcpb",
                  transport: { type: "stdio" },
                  identifier: "https://example.test/fixture.mcpb",
                },
                {
                  registryType: "npm",
                  transport: { type: "stdio" },
                  identifier: "fixture",
                  version: "1.0.0",
                  runtimeHint: "alternative",
                },
                {
                  registryType: "npm",
                  transport: { type: "stdio" },
                  identifier: "fixture",
                  version: "1.0.0",
                  fileSha256: "deadbeef",
                },
              ],
            },
          },
          {
            server: { name: "example.test/removed", version: "1" },
            _meta: { "io.modelcontextprotocol.registry/official": { status: "deleted" } },
          },
          {
            server: {
              name: "example.test/sse",
              version: "1",
              remotes: [{ type: "sse", url: "https://example.test/sse" }],
            },
          },
        ],
        metadata: {},
      }),
    );
    const result = await searchMcpRegistry("", undefined, fetch);
    expect(result.entries).toEqual([
      {
        id: "io.github.Fixture/example",
        name: "Example",
        description: "Example service",
        publisher: "Fixture",
        version: "1.2.3",
        repository: "https://github.com/Fixture/example",
        connections: [
          {
            transport: { type: "http", url: "https://{tenant}.example.test/mcp" },
            values: [["Authorization", "Bearer {key}"]],
            required: ["Authorization"],
          },
          {
            transport: {
              type: "stdio",
              command: "npx",
              args: ["-y", "@example/fixture@2.0.0", "--config", "{config}", "normal"],
            },
            values: [["API_KEY", ""]],
            required: ["API_KEY"],
          },
          {
            transport: { type: "stdio", command: "uvx", args: ["fixture-py==1.2.3"] },
            values: [],
            required: [],
          },
        ],
      },
      {
        id: "example.test/sse",
        name: "example.test/sse",
        publisher: "example.test",
        version: "1",
        description: "",
        repository: undefined,
        connections: [],
      },
    ]);
    expect(JSON.stringify(result)).not.toContain("fixture-private");
    expect(JSON.stringify(result)).not.toContain("fixture-secret");
  });

  it("reports retryable service and response errors", async () => {
    const fetch = vi
      .fn<typeof globalThis.fetch>()
      .mockResolvedValueOnce(new Response("", { status: 503 }))
      .mockResolvedValueOnce(Response.json({ status: "missing" }))
      .mockResolvedValueOnce(new Response(" ".repeat(4 * 1024 * 1024 + 1)));
    await expect(searchMcpRegistry("example", undefined, fetch)).rejects.toThrow(
      /无法读取 MCP Registry/,
    );
    await expect(searchMcpRegistry("example", undefined, fetch)).rejects.toThrow(
      /返回了无法读取的目录/,
    );
    await expect(searchMcpRegistry("example", undefined, fetch)).rejects.toThrow(
      /返回了无法读取的目录/,
    );
  });
});
