// @env node
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { gzipSync } from "node:zlib";

import { afterEach, beforeEach, expect, it } from "vitest";

import { unpackArchive, writeArchive } from "../src/main/backup/archive";
import { RESTORE_DIRECTORY } from "../src/main/backup/constants";
import { checkExportDestination, collectProfileFiles } from "../src/main/backup/files";
import { inspectProfile, prepareRestoredCredentials } from "../src/main/backup/profile";
import { applyPendingBackup, armRestore } from "../src/main/backup/restore";
import type { Settings } from "../src/main/settings/types";
import { NewerFormatError } from "../src/main/storage-format";

let scratch: string;
let profile: string;
let stage: string;
let incoming: string;
let original: string;
let archive: string;

function put(path: string, text: string | Buffer): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

beforeEach(() => {
  scratch = mkdtempSync(join(tmpdir(), "pilot-backup-test-"));
  profile = join(scratch, "profile");
  stage = join(profile, RESTORE_DIRECTORY);
  incoming = join(stage, "incoming");
  original = join(stage, "original");
  archive = join(scratch, "profile.pilot-backup");
  mkdirSync(profile);
});

afterEach(() => {
  rmSync(scratch, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});

const credentials = { providers: 1, services: 2 };

it("round-trips multi-chunk binary data, legacy settings and the session index", async () => {
  const plugin = "imported-plugins/example/资产.bin";
  const bytes = Buffer.alloc(150_001, 0xd4);
  const settings = '{"providers":[],"toolRules":[{"toolName":"read_file"}]}';
  put(join(profile, plugin), bytes);
  put(join(profile, "settings.json"), settings);
  put(join(profile, "sessions", "index.json"), '{"sessions":[]}');
  put(join(profile, "skills", "主题", "SKILL.md"), "# Example");
  await writeArchive(profile, collectProfileFiles(profile), archive, () => {});
  await expect(unpackArchive(archive, incoming)).resolves.toEqual({ providers: 0, services: 0 });
  expect(readFileSync(join(incoming, plugin))).toEqual(bytes);
  const { contents } = inspectProfile(incoming, collectProfileFiles(incoming), true);
  expect(contents).toEqual({
    settings: true,
    skills: 1,
    chats: 0,
    drafts: 0,
    plugins: 0,
    rules: 1,
  });
});

it("does not replace an existing backup when the live profile changes during export", async () => {
  put(archive, "previous backup");
  put(join(profile, "settings.json"), "{}");
  await expect(
    writeArchive(profile, collectProfileFiles(profile), archive, () => {
      throw new Error("Profile changed");
    }),
  ).rejects.toThrow("Profile changed");
  expect(readFileSync(archive, "utf8")).toBe("previous backup");
});

it("does not save a backup inside a data root, including a child whose name starts with two dots", () => {
  const inside = join(profile, "skills", "..notes");
  mkdirSync(inside, { recursive: true });
  expect(() => checkExportDestination(profile, join(inside, "example.pilot-backup"))).toThrow(
    "请选择备份数据目录以外的位置",
  );
  expect(checkExportDestination(profile, archive)).toBe(archive);
});

it("rejects a backup inside a data root when the profile is reached through a directory alias", () => {
  const alias = join(scratch, "profile-alias");
  symlinkSync(profile, alias, "junction");
  mkdirSync(join(profile, "skills"));

  expect(() =>
    checkExportDestination(alias, join(alias, "skills", "example.pilot-backup")),
  ).toThrow("请选择备份数据目录以外的位置");
});

it.each([
  ['{"type":"pilot-backup","formatVersion":2}\nend\n', /较新版/],
  [
    '{"type":"pilot-backup","formatVersion":1}\n{"path":"unknown/data","size":0,"mode":384}\nend\n',
    /有效的 Pilot 备份/,
  ],
  [
    '{"type":"pilot-backup","formatVersion":1}\n{"path":"skills/demo/entry","size":3,"mode":384}\nYg==\nend\n',
    /有效的 Pilot 备份/,
  ],
])("rejects unsupported or inconsistent backup records", async (contents, message) => {
  put(archive, gzipSync(contents));
  await expect(unpackArchive(archive, incoming)).rejects.toThrow(message);
});

it("recognizes a newer persisted transcript version before replacing live data", () => {
  put(join(incoming, "sessions", "chat.jsonl"), '{"type":"pilot_transcript","formatVersion":2}\n');
  expect(() => inspectProfile(incoming, collectProfileFiles(incoming), true)).toThrow(
    NewerFormatError,
  );
});

it("keeps readable encrypted credentials and clears unavailable credentials once per service", async () => {
  const settings: Settings = {
    providers: [
      {
        id: "local",
        name: "Local",
        kind: "openai-compatible",
        modelId: "local",
        apiKey: "readable",
      },
      { id: "remote", name: "Remote", kind: "anthropic", modelId: "remote", apiKey: "unreadable" },
    ],
    activeProviderId: "local",
    mcpServers: [
      {
        id: "remote",
        name: "Remote",
        enabled: true,
        policy: "confirm",
        transport: { type: "http", url: "https://example.test/" },
        encryptedHeaders: "unreadable",
        encryptedImport: "unreadable",
      },
    ],
    mcpOAuth: { remote: { binding: "binding", encryptedState: "unreadable" } },
  };
  await expect(
    prepareRestoredCredentials(settings, async (value) => value === "readable"),
  ).resolves.toEqual({ providers: 1, services: 1 });
  expect(settings.providers.map(({ apiKey }) => apiKey)).toEqual(["readable", undefined]);
  expect(settings.mcpServers?.[0]).toMatchObject({ enabled: false });
  expect(settings.mcpServers?.[0]).not.toHaveProperty("encryptedHeaders");
  expect(settings.mcpOAuth).toEqual({});
});

it("applies only a confirmed backup and replaces absent roots without touching other profile data", () => {
  put(join(profile, "settings.json"), "original");
  put(join(profile, "skills", "only-local", "SKILL.md"), "original");
  put(join(profile, "logs", "pilot.log"), "separate");
  put(join(incoming, "settings.json"), "unconfirmed");
  expect(applyPendingBackup(profile)).toBeUndefined();
  expect(readFileSync(join(profile, "settings.json"), "utf8")).toBe("original");
  expect(existsSync(stage)).toBe(false);

  put(join(incoming, "settings.json"), "from backup");
  armRestore(stage, { phase: "pending", locale: "en", credentials });
  expect(applyPendingBackup(profile)).toEqual({ status: "applied", locale: "en", credentials });
  expect(readFileSync(join(profile, "settings.json"), "utf8")).toBe("from backup");
  expect(readFileSync(join(profile, "logs", "pilot.log"), "utf8")).toBe("separate");
  expect(existsSync(join(profile, "skills"))).toBe(false);
  expect(existsSync(stage)).toBe(false);
});

it.each(["saving", "replacing", "rolling-back"] as const)(
  "rolls back an interrupted %s phase",
  (phase) => {
    put(join(profile, "settings.json"), phase === "replacing" ? "incoming" : "local");
    put(join(original, "sessions", "chat.jsonl"), "local chat");
    put(join(incoming, "skills", "incoming", "SKILL.md"), "incoming skill");
    if (phase === "replacing") put(join(original, "settings.json"), "local");
    armRestore(stage, { phase, locale: "zh", credentials });
    expect(applyPendingBackup(profile)?.status).toBe("rolled-back");
    expect(readFileSync(join(profile, "settings.json"), "utf8")).toBe("local");
    expect(readFileSync(join(profile, "sessions", "chat.jsonl"), "utf8")).toBe("local chat");
    expect(existsSync(join(profile, "skills"))).toBe(false);
    expect(existsSync(stage)).toBe(false);
  },
);

it("preserves original data when rollback is blocked and retries on the next start", () => {
  put(join(profile, "settings.json"), "blocking file");
  put(join(original, "settings.json"), "local");
  armRestore(stage, { phase: "rolling-back", locale: "en", credentials });
  expect(applyPendingBackup(profile)?.status).toBe("blocked");
  expect(readFileSync(join(original, "settings.json"), "utf8")).toBe("local");
  renameSync(join(profile, "settings.json"), join(scratch, "blocking file"));
  expect(applyPendingBackup(profile)?.status).toBe("rolled-back");
  expect(readFileSync(join(profile, "settings.json"), "utf8")).toBe("local");
  expect(existsSync(stage)).toBe(false);
});
