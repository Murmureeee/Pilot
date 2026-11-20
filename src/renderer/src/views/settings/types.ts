// @env browser
import type { ProviderKind } from "@shared/contract";

export interface DraftProvider {
  id: string;
  kind: ProviderKind;
  name: string;
  baseUrl: string;
  modelId: string;
  hasKey: boolean;
  apiKeyInput: string;
}
