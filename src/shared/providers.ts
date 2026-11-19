// @env all
import type { ProviderInput } from "./contract";

export const LOCAL_OPENAI_PRESETS = [
  { name: "Ollama", baseUrl: "http://127.0.0.1:11434/v1" },
  { name: "LM Studio", baseUrl: "http://127.0.0.1:1234/v1" },
] as const;

export function isLocalOpenAiProvider(provider: Pick<ProviderInput, "kind" | "baseUrl">): boolean {
  if (provider.kind !== "openai-compatible" || !provider.baseUrl) return false;
  const url = URL.parse(provider.baseUrl);
  return (
    url !== null &&
    (url.protocol === "http:" || url.protocol === "https:") &&
    ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
  );
}
