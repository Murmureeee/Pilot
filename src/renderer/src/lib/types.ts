// @env browser
export type SettingsSection =
  | "general"
  | "providers"
  | "persona"
  | "data"
  | "skills"
  | "mcp"
  | "imports";

export interface TurnPreview {
  id: string;
  question: string;
  answer: string;
}

export interface VisibleTurns {
  first: number;
  last: number;
  current: number;
}
