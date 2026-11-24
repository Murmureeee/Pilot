import * as fs from "node:fs";
import { mkdtempDisposableSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  loadSettings,
  mergeSettingsInput,
  saveSettings,
  toPublicSettings,
  validateSettingsInput,
} from "../src/main/settings";
import type { Settings } from "../src/main/settings/types";
import { updateActiveModel } from "../src/main/settings/models";

vi.mock("electron", () => ({ safeStorage: { isEncryptionAvailable: () => false } }));
vi.mock("node:fs", { spy: true });

describe("settings recovery", () => {
  it.each([
    Buffer.from('{"providers":[{"apiKey":"saved"}'),
    Buffer.from('{"providers":[null],"activeProviderId":"saved"}'),
  ])("backs up invalid settings and keeps the notice through saves and reloads", (original) => {
    using profile = mkdtempDisposableSync(join(tmpdir(), "pilot-settings-recovery-"));
    const path = join(profile.path, "settings.json");
    fs.writeFileSync(path, original);

    const recovered = loadSettings(profile.path);
    expect(recovered.providers.map(({ id }) => id)).toEqual(["faux-default"]);
    const backup = recovered.recoveredFrom!;
    expect(backup).toMatch(/settings\.corrupt-\d{8}-\d{6}\.json$/);
    expect(fs.readFileSync(backup)).toEqual(original);
    expect(toPublicSettings(recovered).recovery).toEqual({ status: "recovered", path: backup });

    const edited = mergeSettingsInput(recovered, {
      providers: recovered.providers,
      activeProviderId: recovered.activeProviderId,
      persona: "saved after recovery",
    });
    saveSettings(profile.path, edited);
    expect(loadSettings(profile.path)).toMatchObject({
      recoveredFrom: backup,
      persona: edited.persona,
    });
    expect(fs.readdirSync(profile.path)).toHaveLength(2);
  });

  it("leaves the original intact and blocks saves until it can be backed up", () => {
    using profile = mkdtempDisposableSync(join(tmpdir(), "pilot-settings-blocked-"));
    const path = join(profile.path, "settings.json");
    const original = Buffer.from([0x7b, 0xff]);
    fs.writeFileSync(path, original);
    const backup = vi.mocked(fs.copyFileSync).mockImplementationOnce(() => {
      throw new Error("Simulated backup failure");
    });
    try {
      const defaults = loadSettings(profile.path);
      expect(toPublicSettings(defaults).recovery).toEqual({ status: "blocked", path });
      expect(() => saveSettings(profile.path, { providers: [], activeProviderId: "" })).toThrow(
        /无法保存设置/,
      );
      expect(fs.readFileSync(path)).toEqual(original);
      expect(fs.readdirSync(profile.path)).toEqual(["settings.json"]);
    } finally {
      backup.mockReset();
    }
    const recovered = loadSettings(profile.path);
    expect(fs.readFileSync(recovered.recoveredFrom!)).toEqual(original);
  });
});

describe("tool environment settings", () => {
  it("loads old settings, persists the folder and preserves it on unrelated saves", () => {
    using appData = mkdtempDisposableSync(join(tmpdir(), "pi-settings-"));
    using project = mkdtempDisposableSync(join(tmpdir(), "pi-project-"));
    const legacy = { providers: [], activeProviderId: "" };
    saveSettings(appData.path, legacy);
    const current = loadSettings(appData.path);
    expect(toPublicSettings(current)).toMatchObject({
      workingDirectory: null,
      commandShell: process.platform === "win32" ? "powershell" : "bash",
      logLevel: "info",
    });
    const configured = mergeSettingsInput(current, {
      ...legacy,
      workingDirectory: project.path,
      commandShell: "bash",
    });
    saveSettings(appData.path, configured);
    const edited = mergeSettingsInput(loadSettings(appData.path), { ...legacy, persona: "hello" });
    expect(toPublicSettings(edited)).toMatchObject({
      workingDirectory: realpathSync(project.path),
      commandShell: "bash",
    });
    expect(
      mergeSettingsInput(edited, { ...legacy, workingDirectory: null }).workingDirectory,
    ).toBeUndefined();
    expect(() => mergeSettingsInput(edited, { ...legacy, workingDirectory: "relative" })).toThrow(
      /无法使用该工作目录/,
    );
    expect(validateSettingsInput({ ...legacy, commandShell: "unknown" as never })).toBe(
      "不支持此命令环境。",
    );
  });

  it("keeps the saved log level when other preferences are updated", () => {
    using appData = mkdtempDisposableSync(join(tmpdir(), "pilot-log-settings-"));
    const legacy = { providers: [], activeProviderId: "" };
    saveSettings(appData.path, { ...legacy, logLevel: "off" });
    const edited = mergeSettingsInput(loadSettings(appData.path), { ...legacy, persona: "hello" });
    expect(toPublicSettings(edited).logLevel).toBe("off");
    expect(toPublicSettings({ ...legacy, logLevel: "invalid" as never }).logLevel).toBe("info");
  });

  it("preserves a saved credential only while the provider type and endpoint stay the same", () => {
    const original: Settings = {
      activeProviderId: "compatible",
      providers: [
        {
          id: "compatible",
          name: "Original endpoint",
          kind: "openai-compatible",
          baseUrl: "https://example.test/v1",
          modelId: "sample",
          apiKey: "saved-ciphertext",
        },
      ],
    };
    const { apiKey: _savedKey, ...provider } = original.providers[0];
    expect(
      mergeSettingsInput(original, { ...original, providers: [{ ...provider, modelId: "next" }] })
        .providers[0].apiKey,
    ).toBe("saved-ciphertext");
    expect(
      mergeSettingsInput(original, {
        ...original,
        providers: [{ ...provider, baseUrl: "http://127.0.0.1:11434/v1" }],
      }).providers[0].apiKey,
    ).toBeUndefined();
  });

  it("requires system encryption for new API keys and only exposes credential presence", () => {
    const previous: Settings = {
      activeProviderId: "example",
      providers: [
        {
          id: "example",
          name: "Example",
          kind: "openai-responses",
          modelId: "sample",
          baseUrl: "https://example.test/v1",
          apiKey: "existing-ciphertext",
        },
      ],
    };
    const [provider] = previous.providers;
    expect(() =>
      mergeSettingsInput(previous, {
        ...previous,
        providers: [{ ...provider, apiKey: "new-secret" }],
      }),
    ).toThrow("系统密钥服务不可用，无法保存密钥。");
    expect(previous.providers[0].apiKey).toBe("existing-ciphertext");
    expect(toPublicSettings(previous).providers[0]).toMatchObject({ hasKey: true });
    expect(toPublicSettings(previous).providers[0]).not.toHaveProperty("apiKey");
  });
});

describe("saved models and thinking levels", () => {
  it("migrates legacy single-model providers and persists a multi-model selection", () => {
    using appData = mkdtempDisposableSync(join(tmpdir(), "pilot-model-settings-"));
    const provider = {
      id: "local",
      kind: "openai-compatible" as const,
      name: "Local",
      baseUrl: "http://localhost:11434/v1",
      modelId: "legacy",
    };
    const other = { ...provider, id: "other", modelId: "other-model" };
    saveSettings(appData.path, {
      providers: [{ ...provider, apiKey: "ciphertext" }, other],
      activeProviderId: "local",
    });
    const legacy = loadSettings(appData.path);
    expect(toPublicSettings(legacy).providers[0].models).toEqual([
      { id: "legacy", name: "legacy" },
    ]);
    const updated = mergeSettingsInput(legacy, {
      providers: [
        {
          ...provider,
          models: [
            { id: "legacy", name: "Legacy" },
            { id: "next", name: "New model" },
          ],
        },
        other,
      ],
      activeProviderId: "local",
      thinkingLevels: ["max", "high", "high"],
    });
    const selected = updateActiveModel(updated, "local", "next");
    saveSettings(appData.path, selected);
    const restored = loadSettings(appData.path);
    expect(restored.activeProviderId).toBe("local");
    expect(restored.providers[0]).toMatchObject({ modelId: "next", apiKey: "ciphertext" });
    expect(restored.providers[1].modelId).toBe("other-model");
    expect(toPublicSettings(restored)).toMatchObject({
      thinkingLevels: ["high", "max"],
      thinkingLevel: "high",
    });
    expect(toPublicSettings(restored).providers[0].models).toHaveLength(2);
    expect(toPublicSettings(restored).providers[0]).not.toHaveProperty("apiKey");
    expect(() => updateActiveModel(restored, "other", "other-model")).toThrow(/当前提供方/);
    expect(() => updateActiveModel(restored, "local", "other-model")).toThrow(/当前提供方/);
  });

  it("keeps model lists through unrelated changes and requires a model for the active provider", () => {
    const provider = {
      id: "s",
      kind: "faux" as const,
      name: "Demo",
      modelId: "current",
      models: [
        { id: "current", name: "Current" },
        { id: "second", name: "Second" },
      ],
    };
    const current = { providers: [provider], activeProviderId: "s" };
    const edited = mergeSettingsInput(current, {
      providers: [{ ...provider, models: undefined }],
      activeProviderId: "s",
      persona: "sample",
    });
    expect(edited.providers[0].models).toEqual(provider.models);
    expect(
      validateSettingsInput({
        providers: [{ ...provider, modelId: "", models: [] }],
        activeProviderId: "s",
      }),
    ).toMatch(/至少一个模型/);
  });
});
