import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import {
  afterTurnVerificationFor,
  loadProjectConfig,
  projectConfigInfo,
  projectTrustState,
  revokeProjectTrust,
  trustProjectRevision,
} from "../src/main/project-config";
import type { Settings } from "../src/main/settings/types";

function makeTempDir(): string {
  return mkdtempSync(join(tmpdir(), "pilot-test-"));
}

function cleanup(dir: string): void {
  try {
    rmSync(dir, { recursive: true, force: true });
  } catch {}
}

function ensureDir(path: string): void {
  try {
    mkdirSync(path, { recursive: true });
  } catch {}
}

describe("loadProjectConfig", () => {
  it("loads MCP servers from .mcp.json", () => {
    const dir = makeTempDir();
    try {
      writeFileSync(
        join(dir, ".mcp.json"),
        JSON.stringify({
          mcpServers: {
            filesystem: {
              command: "npx",
              args: ["-y", "@modelcontextprotocol/server-filesystem", dir],
            },
          },
        }),
      );
      const config = loadProjectConfig(dir);
      expect(config.servers).toHaveLength(1);
      expect(config.servers[0]).toMatchObject({
        name: "filesystem",
        file: ".mcp.json",
        policy: "confirm",
      });
      expect(config.servers[0].transport).toEqual({
        type: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-filesystem", dir],
      });
    } finally {
      cleanup(dir);
    }
  });

  it("loads MCP servers from .pilot/config.json with policy", () => {
    const dir = makeTempDir();
    try {
      const pilotDir = join(dir, ".pilot");
      ensureDir(pilotDir);
      writeFileSync(
        join(pilotDir, "config.json"),
        JSON.stringify({
          mcpServers: {
            brave: {
              command: "npx",
              args: ["-y", "@modelcontextprotocol/server-brave-search"],
              env: { BRAVE_API_KEY: "test" },
              policy: "inherit",
            },
          },
        }),
      );
      const config = loadProjectConfig(dir);
      expect(config.servers).toHaveLength(1);
      expect(config.servers[0]).toMatchObject({
        name: "brave",
        file: ".pilot/config.json",
        policy: "inherit",
      });
      expect(config.servers[0].envNames).toEqual(["BRAVE_API_KEY"]);
    } finally {
      cleanup(dir);
    }
  });

  it("loads tool rules from .pilot/config.json permissions.allow", () => {
    const dir = makeTempDir();
    try {
      const pilotDir = join(dir, ".pilot");
      ensureDir(pilotDir);
      writeFileSync(
        join(pilotDir, "config.json"),
        JSON.stringify({
          permissions: {
            allow: [
              { tool: "bash", command: ["pnpm", "test"] },
              { tool: "write_file", path: "src/index.ts" },
              { tool: "web_fetch", domain: "docs.example.com" },
            ],
          },
        }),
      );
      const config = loadProjectConfig(dir);
      expect(config.rules).toHaveLength(3);
      expect(config.rules[0]).toEqual({ tool: "bash", command: ["pnpm", "test"] });
      expect(config.rules[1]).toEqual({ tool: "write_file", path: "src/index.ts" });
      expect(config.rules[2]).toEqual({ tool: "web_fetch", domain: "docs.example.com" });
    } finally {
      cleanup(dir);
    }
  });

  it("loads verification commands", () => {
    const dir = makeTempDir();
    try {
      const pilotDir = join(dir, ".pilot");
      ensureDir(pilotDir);
      writeFileSync(
        join(pilotDir, "config.json"),
        JSON.stringify({
          verification: {
            test: "pnpm test",
            build: "pnpm build",
            afterTurn: "test",
          },
        }),
      );
      const config = loadProjectConfig(dir);
      expect(config.verification).toEqual({
        test: "pnpm test",
        build: "pnpm build",
      });
      expect(config.afterTurn).toBe("test");
    } finally {
      cleanup(dir);
    }
  });

  it("rejects absolute paths in file rules", () => {
    const dir = makeTempDir();
    try {
      const pilotDir = join(dir, ".pilot");
      ensureDir(pilotDir);
      writeFileSync(
        join(pilotDir, "config.json"),
        JSON.stringify({
          permissions: {
            allow: [
              { tool: "write_file", path: "/etc/hosts" },
              { tool: "edit_file", path: "C:\\Windows\\System32\\drivers\\etc\\hosts" },
            ],
          },
        }),
      );
      const config = loadProjectConfig(dir);
      expect(config.rules).toHaveLength(0);
      expect(config.issues).toHaveLength(2);
      expect(config.issues.every((i) => i.reason === "unsupported-rule")).toBe(true);
    } finally {
      cleanup(dir);
    }
  });

  it("rejects rules with parent directory traversal", () => {
    const dir = makeTempDir();
    try {
      const pilotDir = join(dir, ".pilot");
      ensureDir(pilotDir);
      writeFileSync(
        join(pilotDir, "config.json"),
        JSON.stringify({
          permissions: {
            allow: [{ tool: "write_file", path: "../outside.txt" }],
          },
        }),
      );
      const config = loadProjectConfig(dir);
      expect(config.rules).toHaveLength(0);
      expect(config.issues).toHaveLength(1);
      expect(config.issues[0].reason).toBe("unsupported-rule");
    } finally {
      cleanup(dir);
    }
  });

  it("computes stable fingerprint for trust decisions", () => {
    const dir = makeTempDir();
    try {
      const pilotDir = join(dir, ".pilot");
      ensureDir(pilotDir);
      writeFileSync(
        join(pilotDir, "config.json"),
        JSON.stringify({
          mcpServers: { test: { command: "node", args: ["server.js"] } },
          permissions: { allow: [{ tool: "bash", command: ["echo", "test"] }] },
        }),
      );
      const config1 = loadProjectConfig(dir);
      const config2 = loadProjectConfig(dir);
      expect(config1.fingerprint).toBe(config2.fingerprint);
      expect(config1.fingerprint).toHaveLength(64);
    } finally {
      cleanup(dir);
    }
  });
});

describe("projectTrustState", () => {
  it('returns "not-needed" for empty config', () => {
    const dir = makeTempDir();
    try {
      const config = loadProjectConfig(dir);
      const state = projectTrustState({} as Settings, config);
      expect(state).toBe("not-needed");
    } finally {
      cleanup(dir);
    }
  });

  it('returns "untrusted" for config with MCP but no saved trust', () => {
    const dir = makeTempDir();
    try {
      writeFileSync(
        join(dir, ".mcp.json"),
        JSON.stringify({ mcpServers: { test: { command: "node", args: [] } } }),
      );
      const config = loadProjectConfig(dir);
      const state = projectTrustState({} as Settings, config);
      expect(state).toBe("untrusted");
    } finally {
      cleanup(dir);
    }
  });

  it('returns "trusted" when fingerprint matches', () => {
    const dir = makeTempDir();
    try {
      writeFileSync(
        join(dir, ".mcp.json"),
        JSON.stringify({ mcpServers: { test: { command: "node", args: [] } } }),
      );
      const config = loadProjectConfig(dir);
      const settings: Settings = {
        projectTrust: { [dir]: { fingerprint: config.fingerprint, trustedAt: Date.now() } },
      } as Settings;
      const state = projectTrustState(settings, config);
      expect(state).toBe("trusted");
    } finally {
      cleanup(dir);
    }
  });

  it('returns "changed" when fingerprint differs', () => {
    const dir = makeTempDir();
    try {
      writeFileSync(
        join(dir, ".mcp.json"),
        JSON.stringify({ mcpServers: { test: { command: "node", args: [] } } }),
      );
      const config = loadProjectConfig(dir);
      const settings: Settings = {
        projectTrust: { [dir]: { fingerprint: "0".repeat(64), trustedAt: Date.now() } },
      } as Settings;
      const state = projectTrustState(settings, config);
      expect(state).toBe("changed");
    } finally {
      cleanup(dir);
    }
  });
});

describe("afterTurnVerificationFor", () => {
  it("returns undefined when no verification configured", () => {
    const dir = makeTempDir();
    try {
      const result = afterTurnVerificationFor({} as Settings, dir);
      expect(result).toBeUndefined();
    } finally {
      cleanup(dir);
    }
  });

  it("returns saved verification when present", () => {
    const dir = makeTempDir();
    try {
      const saved = { kind: "test" as const, command: "pnpm test", shell: "bash" as const };
      const settings: Settings = {
        afterTurnVerification: { [dir]: saved },
      } as Settings;
      const result = afterTurnVerificationFor(settings, dir);
      expect(result).toEqual(saved);
    } finally {
      cleanup(dir);
    }
  });

  it("returns project verification when trusted", () => {
    const dir = makeTempDir();
    try {
      const pilotDir = join(dir, ".pilot");
      ensureDir(pilotDir);
      writeFileSync(
        join(pilotDir, "config.json"),
        JSON.stringify({
          verification: {
            test: "pnpm test",
            afterTurn: "test",
          },
        }),
      );
      const config = loadProjectConfig(dir);
      const settings: Settings = {
        commandShell: "bash",
        projectTrust: { [dir]: { fingerprint: config.fingerprint, trustedAt: Date.now() } },
      } as Settings;
      const result = afterTurnVerificationFor(settings, dir, config.fingerprint);
      expect(result).toMatchObject({
        kind: "test",
        command: "pnpm test",
        shell: "bash",
      });
      expect(afterTurnVerificationFor(settings, dir)).toBeUndefined();
      expect(
        afterTurnVerificationFor(revokeProjectTrust(settings, dir), dir, config.fingerprint),
      ).toBeUndefined();
      settings.afterTurnVerification = { [dir]: null };
      expect(afterTurnVerificationFor(settings, dir, config.fingerprint)).toBeUndefined();
    } finally {
      cleanup(dir);
    }
  });

  it("returns undefined for project verification when untrusted", () => {
    const dir = makeTempDir();
    try {
      const pilotDir = join(dir, ".pilot");
      ensureDir(pilotDir);
      writeFileSync(
        join(pilotDir, "config.json"),
        JSON.stringify({
          verification: {
            test: "pnpm test",
            afterTurn: "test",
          },
        }),
      );
      const settings: Settings = { commandShell: "bash" } as Settings;
      const result = afterTurnVerificationFor(settings, dir);
      expect(result).toBeUndefined();
    } finally {
      cleanup(dir);
    }
  });
});

it("requires a fresh preview to trust changed verification commands", () => {
  const dir = makeTempDir();
  try {
    const pilot = join(dir, ".pilot");
    ensureDir(pilot);
    const path = join(pilot, "config.json");
    writeFileSync(path, JSON.stringify({ verification: { build: "node checks.cjs" } }));
    const settings: Settings = { providers: [], activeProviderId: "" };
    const preview = projectConfigInfo(settings, dir);
    expect(preview.trust).toBe("untrusted");
    const trusted = trustProjectRevision(settings, dir, preview.revision);
    expect(projectConfigInfo(trusted, dir).trust).toBe("trusted");
    writeFileSync(path, JSON.stringify({ verification: { build: "node checks.cjs --new" } }));
    expect(projectConfigInfo(trusted, dir).trust).toBe("changed");
    expect(() => trustProjectRevision(settings, dir, preview.revision)).toThrow("项目配置已更改");
  } finally {
    cleanup(dir);
  }
});
