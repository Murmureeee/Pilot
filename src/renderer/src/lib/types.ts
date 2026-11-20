// @env browser
import type { LucideIcon } from "lucide-react";
import type { WorkspaceEntry } from "@shared/contract";

export interface ComposerTrigger {
  kind: "command" | "reference";
  start: number;
  end: number;
  query: string;
}

export interface ComposerSuggestion {
  id: string;
  label: string;
  detail?: string;
  icon: LucideIcon;
  attached?: boolean;
  select(): void;
}

export interface WorkspaceSearchResult {
  workingDirectory: string;
  query: string;
  entries: WorkspaceEntry[];
  error?: string;
}

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
