// @env browser
import type { Dispatch, SetStateAction } from "react";
import type { LucideIcon } from "lucide-react";
import type {
  FileChangeSummary,
  PromptMention,
  UiMessage,
  UiPart,
  WorkspaceEntry,
  WorkspaceReferencePreview,
  WorkspaceReferenceRequest,
} from "@shared/contract";

export interface ComposerTrigger {
  kind: "command" | "mention";
  start: number;
  end: number;
  query: string;
}

export type ComposerDraft = (string | PromptMention)[];

interface ComposerCommandActions {
  newChat(): Promise<void>;
  archiveChat(): Promise<void>;
  openMenu(menu: ComposerToolbarMenu): void;
  openSettings(section: SettingsSection): void;
}

export interface ComposerCommand {
  id: string;
  label: string;
  description: string;
  icon: LucideIcon;
  requiresSession?: boolean;
  action(actions: ComposerCommandActions): void | Promise<void>;
}

export interface ComposerSuggestion {
  id: string;
  label: string;
  detail?: string;
  group?: string;
  shortcut?: string;
  icon: LucideIcon;
  attached?: boolean;
  select(): void;
}

export type ComposerToolbarMenu = "permissions" | "model" | "thinking";

export interface ComposerModelControlsProps {
  menu: ComposerToolbarMenu | null;
  setMenu: Dispatch<SetStateAction<ComposerToolbarMenu | null>>;
  onError(message: string | null): void;
}

export interface WorkspaceSearchResult {
  workingDirectory: string;
  query: string;
  entries: WorkspaceEntry[];
  error?: string;
}

export interface WorkspaceLink {
  path: string;
  kind: WorkspaceEntry["kind"];
  line?: number;
}

export interface ToolStackFrame {
  text: string;
  name?: string;
  reference?: WorkspaceLink;
  framework: boolean;
}

export interface ToolFailure {
  summary: string;
  message: string;
  frames: ToolStackFrame[];
}

export interface WorkspaceReferenceTab extends WorkspaceReferenceRequest, WorkspaceLink {
  sessionId: string;
}

export interface WorkspaceReferenceStore {
  reference: WorkspaceReferenceTab | null;
  open(reference: WorkspaceReferenceTab): void;
  close(): void;
}

export type WorkspaceReferenceLoad =
  | { reference: WorkspaceReferenceTab; preview: WorkspaceReferencePreview }
  | { reference: WorkspaceReferenceTab; error: string };

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

export type ChatRow =
  | { role: "user"; id: string; message: UiMessage }
  | { role: "assistant"; id: string; messages: UiMessage[] };

export interface ReplyEntry {
  key: string;
  part: UiPart;
  streaming: boolean;
}

export interface OpenFileChanges {
  sessionId: string;
  replyId: string;
  changeId?: string;
  changePath?: string;
  confirmUndo?: boolean;
}

export interface FileChangesReview {
  sessionId: string;
  replyId: string;
  expanded: string[];
  collapsedFolders: string[];
  selectedId?: string;
  jump: { changeId?: string };
  undoChangeId: string | null;
}

export type FileChangeNode =
  | { kind: "directory"; name: string; path: string; children: FileChangeNode[] }
  | { kind: "file"; name: string; change: FileChangeSummary };

export interface FileChangesStore {
  review: FileChangesReview | null;
  open(request: OpenFileChanges): void;
  close(): void;
  toggleFile(id: string): void;
  collapseFiles(): void;
  setFolderOpen(path: string, open: boolean): void;
  confirmUndo(id: string): void;
  cancelUndo(id: string): void;
}
