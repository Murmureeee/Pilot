import * as fs from "node:fs";
import { mkdtempDisposableSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it, vi } from "vitest";

import { SETTINGS_FORMAT_VERSION } from "../src/main/constants";
import {
  loadSettings,
  prepareSettingsInput,
  saveSettings,
  toPublicSettings,
  validateSettingsInput,
} from "../src/main/settings";
import { updateActiveModel } from "../src/main/settings/models";
import type { Settings } from "../src/main/settings/types";
import type { ExternalEditor, SettingsInput } from "../src/shared/contract";
import { effectiveModelCapabilities } from "../src/shared/model-capabilities";
import { modelCatalogInput } from "../src/shared/providers";

vi.mock("electron", () => ({ safeStorage: { isEncryptionAvailable: () => false } }));
vi.mock("node:fs", { spy: true });

async function mergeSettingsInput(current: Settings, input: SettingsInput): Promise<Settings> {
  return (await prepareSettingsInput(input))(current);
}

it("persists an auxiliary selection and clears it when its catalog entry is removed", async () => {
  using profile = mkdtempDisposableSync(join(tmpdir(), "pilot-aux-model-"));
  const defaults = loadSettings(profile.path);
  expect(toPublicSettings(defaults).auxiliaryModel).toBeNull();
  const selection = { providerId: "utility", modelId: "small" };
  const primary = defaults.providers[0]!;
  const settings = {
    activeProviderId: primary.id,
    providers: [
      primary,
      {
        id: "utility",
        name: "Utility",
        kind: "openai-compatible" as const,
        baseUrl: "http://127.0.0.1:8000/v1",
        modelId: "small",
      },
    ],
    auxiliaryModel: selection,
  };
  expect(validateSettingsInput(settings)).toBeUndefined();
  saveSettings(profile.path, await mergeSettingsInput(defaults, settings));
  const current = loadSettings(profile.path);
  expect(toPublicSettings(current).auxiliaryModel).toEqual(selection);
  const { auxiliaryModel: _selection, ...other } = settings;
  expect((await mergeSettingsInput(current, other)).auxiliaryModel).toEqual(selection);
  expect(
    (await mergeSettingsInput(current, { ...settings, auxiliaryModel: null })).auxiliaryModel,
  ).toBeUndefined();
  expect(
    (await mergeSettingsInput(current, { ...other, providers: [primary] })).auxiliaryModel,
  ).toBeUndefined();
  expect(validateSettingsInput({ ...settings, providers: [primary] })).toContain("辅助模型");
});

it("defaults older settings to VS Code and preserves a saved editor on other settings saves", async () => {
  using profile = mkdtempDisposableSync(join(tmpdir(), "pilot-editor-settings-"));
  const settings = loadSettings(profile.path);
  saveSettings(profile.path, settings);
  expect(toPublicSettings(loadSettings(profile.path)).externalEditor).toEqual({ kind: "vscode" });

  const externalEditor: ExternalEditor = {
    kind: "custom",
    command: "editor",
    args: ["--go", "{file}:{line}"],
  };
  saveSettings(profile.path, { ...settings, externalEditor });
  const reopened = loadSettings(profile.path);
  expect(toPublicSettings(reopened).externalEditor).toEqual(externalEditor);
  const updated = await mergeSettingsInput(reopened, {
    providers: reopened.providers,
    activeProviderId: reopened.activeProviderId,
    persona: "Keep the editor preference.",
  });
  saveSettings(profile.path, updated);
  expect(loadSettings(profile.path).externalEditor).toEqual(externalEditor);
});

it("defaults to automatic update downloads and preserves an explicit opt-out", async () => {
  using profile = mkdtempDisposableSync(join(tmpdir(), "pilot-update-settings-"));
  const settings = loadSettings(profile.path);
  saveSettings(profile.path, settings);
  expect(toPublicSettings(loadSettings(profile.path)).autoDownloadUpdates).toBe(true);

  saveSettings(profile.path, { ...settings, autoDownloadUpdates: false });
  const reopened = loadSettings(profile.path);
  expect(toPublicSettings(reopened).autoDownloadUpdates).toBe(false);
  saveSettings(
    profile.path,
    await mergeSettingsInput(reopened, {
      providers: reopened.providers,
      activeProviderId: reopened.activeProviderId,
      persona: "Keep the update preference.",
    }),
  );
  expect(toPublicSettings(loadSettings(profile.path)).autoDownloadUpdates).toBe(false);
});

it("keeps a project's after-turn command and shell through ordinary settings saves", async () => {
  using profile = mkdtempDisposableSync(join(tmpdir(), "pilot-after-turn-settings-"));
  const settings = loadSettings(profile.path);
  const afterTurnVerification = {
    [profile.path]: { kind: "test", command: "node check.cjs", shell: "bash" },
  } as const;
  saveSettings(profile.path, { ...settings, afterTurnVerification });
  const reopened = loadSettings(profile.path);
  const updated = await mergeSettingsInput(reopened, {
    providers: reopened.providers,
    activeProviderId: reopened.activeProviderId,
    persona: "Keep the project settings.",
  });
  saveSettings(profile.path, updated);
  expect(loadSettings(profile.path).afterTurnVerification).toEqual(afterTurnVerification);
});

describe("settings recovery", () => {
  it("migrates unversioned settings on save while preserving credentials and authorization rules", () => {
    using profile = mkdtempDisposableSync(join(tmpdir(), "pilot-settings-version-"));
    const path = join(profile.path, "settings.json");
    const initial = {
      activeProviderId: "example",
      providers: [
        {
          id: "example",
          kind: "openai-compatible",
          name: "Example",
          baseUrl: "https://example.test/v1",
          modelId: "sample",
          apiKey: "fixture-ciphertext",
        },
      ],
      toolRules: [{ toolName: "read_file" }],
    };
    const bytes = JSON.stringify(initial);
    fs.writeFileSync(path, bytes);

    const loaded = loadSettings(profile.path);
    expect(fs.readFileSync(path, "utf8")).toBe(bytes);
    expect(loaded.providers[0].apiKey).toBe("fixture-ciphertext");
    saveSettings(profile.path, { ...loaded, logLevel: "warn" });
    expect(JSON.parse(fs.readFileSync(path, "utf8"))).toMatchObject({
      ...initial,
      formatVersion: SETTINGS_FORMAT_VERSION,
      logLevel: "warn",
    });
    expect(toPublicSettings(loadSettings(profile.path)).recovery).toBeUndefined();
  });

  it("does not recover, replace or back up newer settings even when the payload is unrecognized", () => {
    using profile = mkdtempDisposableSync(join(tmpdir(), "pilot-settings-version-"));
    const path = join(profile.path, "settings.json");
    const stale = loadSettings(profile.path);
    const version = SETTINGS_FORMAT_VERSION + 1;
    const bytes = JSON.stringify({
      formatVersion: version,
      newerSettings: { models: ["fixture"] },
    });
    fs.writeFileSync(path, bytes);

    const loaded = loadSettings(profile.path);
    expect(toPublicSettings(loaded).recovery).toEqual({ status: "upgrade", path, version });
    expect(() => saveSettings(profile.path, loaded)).toThrow(/升级 Pilot/);
    expect(() => saveSettings(profile.path, stale)).toThrow(/升级 Pilot/);
    expect(fs.readFileSync(path, "utf8")).toBe(bytes);
    expect(fs.readdirSync(profile.path)).toEqual(["settings.json"]);
  });

  it.each([
    Buffer.from('{"providers":[{"apiKey":"saved"}'),
    Buffer.from('{"providers":[null],"activeProviderId":"saved"}'),
  ])(
    "backs up invalid settings and keeps the notice through saves and reloads",
    async (original) => {
      using profile = mkdtempDisposableSync(join(tmpdir(), "pilot-settings-recovery-"));
      const path = join(profile.path, "settings.json");
      fs.writeFileSync(path, original);

      const recovered = loadSettings(profile.path);
      expect(recovered.providers.map(({ id }) => id)).toEqual(["faux-default"]);
      const backup = recovered.recoveredFrom!;
      expect(backup).toMatch(/settings\.corrupt-\d{8}-\d{6}\.json$/);
      expect(fs.readFileSync(backup)).toEqual(original);
      expect(toPublicSettings(recovered).recovery).toEqual({ status: "recovered", path: backup });

      const edited = await mergeSettingsInput(recovered, {
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
    },
  );

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
  it("loads old settings, persists the folder and preserves it on unrelated saves", async () => {
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
    const configured = await mergeSettingsInput(current, {
      ...legacy,
      workingDirectory: project.path,
      commandShell: "bash",
    });
    saveSettings(appData.path, configured);
    const edited = await mergeSettingsInput(loadSettings(appData.path), {
      ...legacy,
      persona: "hello",
    });
    expect(toPublicSettings(edited)).toMatchObject({
      workingDirectory: realpathSync(project.path),
      commandShell: "bash",
    });
    expect(
      (await mergeSettingsInput(edited, { ...legacy, workingDirectory: null })).workingDirectory,
    ).toBeUndefined();
    await expect(
      mergeSettingsInput(edited, { ...legacy, workingDirectory: "relative" }),
    ).rejects.toThrow(/无法使用该工作目录/);
    expect(validateSettingsInput({ ...legacy, commandShell: "unknown" as never })).toBe(
      "不支持此命令环境。",
    );
  });

  it("keeps the saved log level when other preferences are updated", async () => {
    using appData = mkdtempDisposableSync(join(tmpdir(), "pilot-log-settings-"));
    const legacy = { providers: [], activeProviderId: "" };
    saveSettings(appData.path, { ...legacy, logLevel: "off" });
    const edited = await mergeSettingsInput(loadSettings(appData.path), {
      ...legacy,
      persona: "hello",
    });
    expect(toPublicSettings(edited).logLevel).toBe("off");
    expect(toPublicSettings({ ...legacy, logLevel: "invalid" as never }).logLevel).toBe("info");
  });

  it("round-trips shell-specific approvals and keeps legacy entries available to revoke", async () => {
    using profile = mkdtempDisposableSync(join(tmpdir(), "pilot-command-rules-"));
    const settings: Settings = {
      providers: [],
      activeProviderId: "",
      toolRules: [
        { toolName: "bash" },
        { toolName: "bash", commandPrefix: { shell: "powershell", args: ["pnpm", "test"] } },
        { toolName: "bash", commandPrefix: { shell: "bash", args: ["git", "status"] } },
        { toolName: "edit_file", pathPrefix: "src/" },
      ],
    };
    saveSettings(profile.path, settings);
    const edited = await mergeSettingsInput(loadSettings(profile.path), {
      ...settings,
      persona: "updated",
    });
    saveSettings(profile.path, edited);
    expect(toPublicSettings(loadSettings(profile.path)).toolRules).toEqual(settings.toolRules);
  });

  it("preserves a saved credential only while the provider type and endpoint stay the same", async () => {
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
      (
        await mergeSettingsInput(original, {
          ...original,
          providers: [{ ...provider, modelId: "next" }],
        })
      ).providers[0].apiKey,
    ).toBe("saved-ciphertext");
    expect(
      (
        await mergeSettingsInput(original, {
          ...original,
          providers: [{ ...provider, baseUrl: "http://127.0.0.1:11434/v1" }],
        })
      ).providers[0].apiKey,
    ).toBeUndefined();
  });

  it("requires system encryption for new API keys and only exposes credential presence", async () => {
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
    await expect(
      mergeSettingsInput(previous, {
        ...previous,
        providers: [{ ...provider, apiKey: "new-secret" }],
      }),
    ).rejects.toThrow("系统密钥服务不可用，无法保存密钥。");
    expect(previous.providers[0].apiKey).toBe("existing-ciphertext");
    expect(toPublicSettings(previous).providers[0]).toMatchObject({ hasKey: true });
    expect(toPublicSettings(previous).providers[0]).not.toHaveProperty("apiKey");
  });
});

describe("saved models and thinking levels", () => {
  it("migrates legacy single-model providers and persists a multi-model selection", async () => {
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
      {
        id: "legacy",
        name: "legacy",
        automatic: {
          contextWindow: 128000,
          maxTokens: 8192,
          supportsImages: false,
          supportsThinking: false,
        },
      },
    ]);
    const updated = await mergeSettingsInput(legacy, {
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

  it("keeps model lists through unrelated changes and requires a model for the active provider", async () => {
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
    const edited = await mergeSettingsInput(current, {
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

  it("persists reported capabilities separately from explicit overrides and clearing them", async () => {
    using profile = mkdtempDisposableSync(join(tmpdir(), "pilot-capability-settings-"));
    const model = {
      id: "vision",
      name: "Vision",
      contextWindow: 32_768,
      maxTokens: 4096,
      supportsImages: true,
      supportsThinking: true,
      cost: { input: 1.5 },
      overrides: { contextWindow: 8192, supportsImages: false },
    };
    const settings: Settings = {
      activeProviderId: "local",
      providers: [
        {
          id: "local",
          kind: "openai-compatible",
          baseUrl: "http://localhost:1234/v1",
          modelId: model.id,
          name: "Local",
          models: [model],
        },
      ],
    };
    saveSettings(profile.path, settings);
    const loaded = loadSettings(profile.path);
    const publicModel = toPublicSettings(loaded).providers[0].models[0];
    expect(effectiveModelCapabilities(publicModel.automatic, publicModel.overrides)).toEqual({
      contextWindow: 8192,
      maxTokens: 4096,
      supportsImages: false,
      supportsThinking: true,
    });
    expect(modelCatalogInput([publicModel])).toEqual([model]);
    const cleared = await mergeSettingsInput(loaded, {
      activeProviderId: "local",
      providers: [{ ...loaded.providers[0], models: [{ ...model, overrides: undefined }] }],
    });
    saveSettings(profile.path, cleared);
    const restored = toPublicSettings(loadSettings(profile.path)).providers[0].models[0];
    expect(restored.overrides).toBeUndefined();
    expect(restored.automatic).toEqual({
      contextWindow: 32_768,
      maxTokens: 4096,
      supportsImages: true,
      supportsThinking: true,
    });
    expect(restored.cost).toEqual({ input: 1.5 });
  });
});
