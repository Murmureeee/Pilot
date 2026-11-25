import { describe, expect, it } from "vitest";

import { mergeSettingsInput, toPublicSettings } from "../src/main/settings";
import { parseSettings } from "../src/main/settings/schema";
import { fillPromptTemplate, promptParameters } from "../src/renderer/src/lib/prompt-templates";

describe("prompt templates", () => {
  it("fills repeated named parameters literally and preserves other braces", () => {
    const text = "Check {{ 文件 }} against {{rule}} twice in {{文件}}. Keep {{ raw values }}.";
    expect(promptParameters(text)).toEqual(["文件", "rule"]);
    const values = new Map([
      ["文件", "src/index.ts"],
      ["rule", "$& and {{文件}}"],
    ]);
    expect(fillPromptTemplate(text, values)).toBe(
      "Check src/index.ts against $& and {{文件}} twice in src/index.ts. Keep {{ raw values }}.",
    );
  });

  it("reads older profiles and preserves saved templates through unrelated settings changes", () => {
    const legacy = { providers: [], activeProviderId: "" };
    expect(
      toPublicSettings(parseSettings(Buffer.from(JSON.stringify(legacy)))!).promptTemplates,
    ).toEqual([]);
    const promptTemplates = [{ name: "audit", text: "Inspect {{file}}" }];
    const loaded = parseSettings(Buffer.from(JSON.stringify({ ...legacy, promptTemplates })));
    expect(loaded).toBeDefined();
    expect(
      toPublicSettings(mergeSettingsInput(loaded!, { ...legacy, persona: "Updated" }))
        .promptTemplates,
    ).toEqual(promptTemplates);
  });
});
