// @env browser
import type { LucideIcon } from "lucide-react";
import type { Dispatch, SetStateAction } from "react";

import type {
  ComposerDraft,
  FileDiff,
  FileChangeSummary,
  GitBranchOptions,
  GitChange,
  GitChangesView,
  GitDiffPaths,
  GitFileDiff,
  GitPullRequestPreview,
  GitPushPreview,
  GitPushResult,
  ImageAttachment,
  PromptMention,
  PromptTemplate,
  TranscriptLocation,
  UiMessage,
  UiPart,
  UpdateStatus,
  VerificationRun,
  WorkspaceEntry,
  WorkspaceReferencePreview,
  WorkspaceReferenceRequest,
} from "@shared/contract";

export interface ComposerImages {
  images: ImageAttachment[];
  pending: boolean;
  error: string | null;
  add(files: File[]): Promise<void>;
  remove(index: number): Promise<void>;
  replace(images: ImageAttachment[]): Promise<void>;
}

export interface UpdateStore {
  status: UpdateStatus | null;
  actionFailed: boolean;
  dialog: "about" | "update" | null;
  setDialog(dialog: UpdateStore["dialog"]): void;
  subscribe(): () => void;
  check(): Promise<void>;
  download(): Promise<void>;
  install(): Promise<void>;
  showPackage(): Promise<void>;
}

export interface ComposerTrigger {
  kind: "command" | "mention";
  start: number;
  end: number;
  query: string;
}

export interface WorkbenchCommand {
  id: string;
  label: string;
  description?: string;
  icon: LucideIcon;
  slash?: string;
  slashAliases?: readonly string[];
  shortcut?: string;
  checked?: boolean;
  attention?: boolean;
  palette?: false;
  insertsPrompt?: boolean;
  run(input?: { argument?: string; insert?: (text: string) => void }): void | Promise<void>;
}

export interface PromptTemplateRequest {
  template: PromptTemplate;
  insert(text: string): void;
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

export type ComposerShortcut =
  | "focus-composer"
  | "find-chat"
  | "cycle-approval-mode"
  | "recall-message"
  | "stop-run";

export interface ComposerShortcuts {
  cycleMode(): void;
  recallMessage(): void;
  openMenu(menu: ComposerToolbarMenu): void;
  appendPrompt(text: string): void;
  appendDraft(draft: ComposerDraft): boolean;
}

export type ComposerAction =
  | { shortcut: Exclude<ComposerShortcut, "stop-run" | "find-chat"> }
  | { menu: ComposerToolbarMenu; composerId: string }
  | { prompt: string; composerId: string }
  | {
      draft: ComposerDraft;
      composerId: string;
      workingDirectory: string;
      onInserted(): void;
    };

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
}

export type WorkspaceReferenceLoad =
  | { reference: WorkspaceReferenceTab; preview: WorkspaceReferencePreview }
  | { reference: WorkspaceReferenceTab; error: string };

export type SettingsSection =
  | "scheduledTasks"
  | "general"
  | "appearance"
  | "permissions"
  | "providers"
  | "persona"
  | "shortcuts"
  | "archived"
  | "usage"
  | "data"
  | "about"
  | "skills"
  | "mcp"
  | "imports";

export type SendKey = "enter" | "mod-enter";

export type SessionRowStatus =
  | "approval"
  | "plan"
  | "running"
  | "stopping"
  | "failed"
  | "interrupted"
  | "unread";
export type ProjectRowAction = "open" | "remove";

export interface ShortcutGroup {
  label: string;
  items: { label: string; keys: string }[];
}

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
  | {
      role: "compaction";
      id: string;
      partIndex: number;
      part: Extract<UiPart, { type: "compaction" }>;
    }
  | { role: "assistant"; id: string; messages: UiMessage[] };

export interface ReplyEntry {
  key: string;
  location: string;
  part: UiPart;
  streaming: boolean;
}

export interface ChatFind {
  sessionId: string;
  query: string;
  location?: TranscriptLocation;
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

export type ReviewTab = "changes" | "files" | "verification" | "terminal" | "preview";

export interface ReviewStore {
  composerId: string | null;
  open: boolean;
  tab: ReviewTab;
  focusRequest: number;
  trigger: HTMLElement | null;
  show(composerId: string, tab?: ReviewTab, trigger?: HTMLElement): void;
  selectTab(tab: ReviewTab): void;
  close(): void;
}

export type ReviewResizeRange = { min: number; max: number };
export type VerificationIndicator = Pick<
  VerificationRun,
  "runId" | "startedAt" | "revision" | "status"
>;

export interface GitReview {
  view: GitChangesView | null | undefined;
  error: string | null;
  refresh(): void;
}

export interface GitAnnotationSource {
  id: string;
  area: GitChange["area"];
  paths: GitDiffPaths;
  diff: FileDiff;
  canOpen: boolean;
  lineTargets?: GitFileDiff["lineTargets"];
  workingDirectory: string;
  trigger: HTMLButtonElement;
}

export interface GitAnnotation {
  id: string;
  reference: Extract<PromptMention, { type: "file" }>;
  message: string;
  excerpt: string;
}

export interface GitAnnotationStore {
  drafts: Record<string, GitAnnotation[]>;
  save(scope: string, annotation: GitAnnotation): void;
  remove(scope: string, ids: string[]): void;
}

export type AppendGitAnnotations = (draft: ComposerDraft, onInserted: () => void) => void;

export type GitBranchDialogMode = "branch" | "push" | "pull-request";

export type GitBranchDialogPreview =
  | { kind: "branch"; data: GitBranchOptions }
  | { kind: "push"; data: GitPushPreview }
  | { kind: "pull-request"; data: GitPullRequestPreview };

export type GitBranchFeedback =
  | { kind: "branch"; branch: string }
  | { kind: "push"; destination: string; trackingFailed: GitPushResult["trackingFailed"] }
  | { kind: "pull-request"; url: string };

export interface ProjectSelection {
  target?: "wsl";
  sessionId?: string;
  directory?: string;
}
