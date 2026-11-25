// @env node
import { Notification, type BrowserWindow } from "electron";

import type { UiAgentEvent } from "../../shared/contract";
import { TASK_NOTICE_TITLES } from "./constants";
import type { ActiveNotice, NoticeKind, PendingApproval, TaskNotificationOptions } from "./types";

export class TaskNotifications {
  private enabled: boolean;
  private readonly approvals = new Map<string, PendingApproval>();
  private readonly notices = new Map<string, ActiveNotice>();
  private flashing?: { window: BrowserWindow; sessionId: string };

  constructor(private readonly options: TaskNotificationOptions) {
    this.enabled = options.enabled;
  }

  setEnabled(enabled: boolean): void {
    if (this.enabled === enabled) return;
    this.enabled = enabled;
    if (enabled) this.sync();
    else this.clearNotices();
  }

  watchWindow(window: BrowserWindow): void {
    window.on("focus", () => {
      this.stopFlash();
      this.sync();
    });
    window.on("blur", () => this.sync());
    window.on("minimize", () => this.sync());
    window.webContents.on("did-stop-loading", () => this.sync());
  }

  sync(): void {
    const visible = this.options.getVisibleSessionId();
    if (visible) {
      this.markUnread(visible, false);
      if (this.flashing?.sessionId === visible) this.stopFlash();
    }
    for (const approval of this.approvals.values()) this.announceApproval(approval, visible);
  }

  handleEvent(event: UiAgentEvent): void {
    if (event.type === "snapshot") {
      this.sync();
      return;
    }
    if (event.type === "sessions") {
      for (const id of this.notices.keys()) {
        if (!this.options.getSession(id)) this.closeNotice(id);
      }
      return;
    }
    if (!("run" in event)) return;
    const { runId, sessionId } = event.run;
    if (event.type === "run_started") this.closeNotice(sessionId);
    if (event.type === "permission_request") {
      const approval = this.approvals.get(runId) ?? {
        sessionId,
        requests: new Set(),
        announced: false,
      };
      approval.requests.add(event.requestId);
      this.approvals.set(runId, approval);
      this.announceApproval(approval, this.options.getVisibleSessionId());
    }
    if (event.type === "permission_resolved") {
      const approval = this.approvals.get(runId);
      if (approval?.requests.delete(event.requestId) && approval.requests.size === 0)
        this.clearApproval(runId, sessionId);
    }
    if (event.type === "status" && event.status === "idle") {
      this.clearApproval(runId, sessionId);
      if (sessionId === this.options.getVisibleSessionId()) return;
      if (event.result === "success") this.markUnread(sessionId, true);
      if (this.enabled && (event.result === "success" || event.result === "failed"))
        this.show(sessionId, event.result);
    }
  }

  dispose(): void {
    this.enabled = false;
    this.approvals.clear();
    this.clearNotices();
  }

  private announceApproval(approval: PendingApproval, visible: string | null): void {
    if (!this.enabled || approval.announced || approval.sessionId === visible) return;
    approval.announced = true;
    this.show(approval.sessionId, "approval");
  }

  private markUnread(id: string, unread: boolean): void {
    const session = this.options.getSession(id);
    if (!session || Boolean(session.unread) === unread) return;
    try {
      this.options.setUnread(id, unread);
    } catch {
      this.options.reportError("unread");
    }
  }

  private show(id: string, kind: NoticeKind): void {
    const session = this.options.getSession(id);
    if (!session) return;
    this.closeNotice(id);
    const window = this.options.getWindow();
    if (process.platform === "win32" && window && !window.isDestroyed()) {
      window.flashFrame(true);
      this.flashing = { window, sessionId: id };
    }
    try {
      if (!Notification.isSupported()) return;
      const title = TASK_NOTICE_TITLES[this.options.getLocale()][kind];
      const notification = new Notification({
        title,
        body: session.title.replace(/\s+/g, " ").trim().slice(0, 100),
      });
      const notice: ActiveNotice = { kind, notification };
      this.notices.set(id, notice);
      const forget = (): void => {
        if (this.notices.get(id) === notice) this.notices.delete(id);
      };
      notification.on("close", (details) => {
        // Windows keeps timed-out banners clickable in Notification Center.
        if (details.reason !== "timedOut") forget();
      });
      notification.once("failed", () => {
        forget();
        this.options.reportError("show");
      });
      notification.once("click", () => {
        if (this.notices.get(id) !== notice) return;
        this.closeNotice(id);
        this.stopFlash();
        try {
          this.options.openSession(id);
        } catch {
          this.options.reportError("open");
        }
      });
      notification.show();
    } catch {
      this.notices.delete(id);
      this.options.reportError("show");
    }
  }

  private clearApproval(runId: string, id: string): void {
    if (!this.approvals.delete(runId)) return;
    if (this.notices.get(id)?.kind === "approval") this.closeNotice(id);
    if (this.flashing?.sessionId === id) this.stopFlash();
  }

  private stopFlash(): void {
    const flashing = this.flashing;
    this.flashing = undefined;
    if (flashing && !flashing.window.isDestroyed()) flashing.window.flashFrame(false);
  }

  private closeNotice(id: string): void {
    const notice = this.notices.get(id);
    this.notices.delete(id);
    notice?.notification.close();
  }

  private clearNotices(): void {
    for (const id of this.notices.keys()) this.closeNotice(id);
    this.stopFlash();
  }
}
