// @env node
import type { BrowserWindow, Notification } from "electron";

import type { Locale, SessionMeta } from "../../shared/contract";

export type NoticeKind = "approval" | "plan" | "success" | "failed";

export interface PendingApproval {
  sessionId: string;
  requests: Set<string>;
  announced: boolean;
}

export interface ActiveNotice {
  kind: NoticeKind;
  notification: Notification;
}

export interface TaskNotificationOptions {
  enabled: boolean;
  getWindow(): BrowserWindow | undefined;
  getLocale(): Locale;
  getVisibleSessionId(): string | null;
  getSession(id: string): SessionMeta | null;
  setUnread(id: string, unread: boolean): void;
  openSession(id: string): void;
  reportError(action: "show" | "open" | "unread"): void;
}
