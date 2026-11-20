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

vi.mock("electron", () => ({ safeStorage: { isEncryptionAvailable: () => false } }));

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
