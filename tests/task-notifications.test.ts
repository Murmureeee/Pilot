// @env node
import { EventEmitter } from "node:events";

import type { BrowserWindow, NotificationConstructorOptions } from "electron";
import { beforeEach, expect, it, vi } from "vitest";

import { TaskNotifications } from "../src/main/task-notifications";
import type { NoticeKind, TaskNotificationOptions } from "../src/main/task-notifications/types";
import type { Locale, SessionMeta, UiAgentEvent } from "../src/shared/contract";

const native = vi.hoisted(() => ({
  supported: true,
  items: [] as (EventEmitter & { options: NotificationConstructorOptions; close: () => void })[],
}));

vi.mock("electron", async () => {
  const { EventEmitter: NativeEvents } = await import("node:events");
  return {
    Notification: class extends NativeEvents {
      static isSupported(): boolean {
        return native.supported;
      }

      constructor(readonly options: NotificationConstructorOptions) {
        super();
      }

      show(): void {
        native.items.push(this);
      }

      close = vi.fn<() => void>();
    },
  };
});

beforeEach(() => {
  native.items.length = 0;
  native.supported = true;
});

const run = { sessionId: "a", runId: "run-a" };
const isWindows = process.platform === "win32";

const request = (requestId: string): UiAgentEvent => ({
  type: "permission_request",
  run,
  requestId,
  toolName: "write_file",
  label: "Write file",
  inputSummary: "Do not include input details in the notice",
  danger: false,
});

function idle(result?: Exclude<NoticeKind, "approval"> | "stopped"): UiAgentEvent {
  return { type: "status", status: "idle", run, result };
}

function fixture(locale: Locale = "zh") {
  const session: SessionMeta = {
    id: run.sessionId,
    title: "Working chat",
    updatedAt: 1,
    createdAt: 1,
  };
  const view: { visible: string | null } = { visible: run.sessionId };
  const window = Object.assign(new EventEmitter(), {
    webContents: new EventEmitter(),
    isDestroyed: (): boolean => false,
    flashFrame: vi.fn<(flag: boolean) => void>(),
  });
  const openSession = vi.fn<(id: string) => void>();
  const setUnread = vi.fn<(id: string, unread: boolean) => void>((_id, unread) => {
    session.unread = unread;
  });
  const controller = new TaskNotifications({
    enabled: true,
    getWindow: () => window as unknown as BrowserWindow,
    getLocale: () => locale,
    getVisibleSessionId: () => view.visible,
    getSession: (id) => (id === session.id ? session : null),
    setUnread,
    openSession,
    reportError: vi.fn<TaskNotificationOptions["reportError"]>(),
  });
  controller.watchWindow(window as unknown as BrowserWindow);
  return { controller, view, openSession, setUnread, window };
}

it("alerts once for a pending approval when the user leaves its chat", () => {
  const { controller, view, openSession, window } = fixture();
  controller.handleEvent(request("one"));
  expect(native.items).toHaveLength(0);
  view.visible = null;
  window.emit("blur");
  controller.handleEvent(request("two"));
  expect(native.items).toHaveLength(1);
  const notice = native.items[0];
  expect(notice.options).toEqual({ title: "等待审批", body: "Working chat" });
  controller.handleEvent({ type: "permission_resolved", run, requestId: "one" });
  expect(notice.close).not.toHaveBeenCalled();
  expect(window.flashFrame.mock.calls).toEqual(isWindows ? [[true]] : []);
  notice.emit("close", { reason: "timedOut" });
  notice.emit("click");
  expect(openSession).toHaveBeenCalledExactlyOnceWith("a");
  expect(window.flashFrame.mock.calls).toEqual(isWindows ? [[true], [false]] : []);
  controller.handleEvent({ type: "permission_resolved", run, requestId: "two" });
  expect(native.items).toHaveLength(1);
});

it("only announces terminal results outside the chat and reads a completion on return", () => {
  const { controller, view, setUnread, window } = fixture("en");
  controller.handleEvent(idle("success"));
  expect(setUnread).not.toHaveBeenCalled();
  expect(native.items).toHaveLength(0);
  view.visible = "other-chat";
  controller.handleEvent(idle());
  controller.handleEvent(idle("stopped"));
  expect(native.items).toHaveLength(0);
  controller.handleEvent(idle("success"));
  expect(native.items[0].options.title).toBe("Task completed");
  expect(setUnread).toHaveBeenCalledExactlyOnceWith("a", true);
  view.visible = "a";
  window.emit("focus");
  expect(setUnread).toHaveBeenLastCalledWith("a", false);
  view.visible = null;
  controller.handleEvent(idle("failed"));
  expect(native.items[1].options.title).toBe("Task failed");
  expect(native.items[0].close).toHaveBeenCalledOnce();
  expect(setUnread).toHaveBeenCalledTimes(2);
});

it("keeps unread state active with desktop notifications disabled", () => {
  const { controller, view, setUnread, window } = fixture();
  view.visible = null;
  controller.handleEvent(request("one"));
  controller.setEnabled(false);
  expect(native.items[0].close).toHaveBeenCalledOnce();
  expect(window.flashFrame.mock.calls).toEqual(isWindows ? [[true], [false]] : []);
  const previousFlashes = window.flashFrame.mock.calls.length;
  controller.handleEvent(idle("success"));
  expect(native.items).toHaveLength(1);
  expect(window.flashFrame).toHaveBeenCalledTimes(previousFlashes);
  expect(setUnread).toHaveBeenCalledExactlyOnceWith("a", true);
});

it("still asks the Windows taskbar for attention when native notifications are unavailable", () => {
  const { controller, view, window } = fixture();
  native.supported = false;
  view.visible = null;
  controller.handleEvent(request("one"));
  controller.handleEvent({ type: "permission_resolved", run, requestId: "one" });
  expect(native.items).toHaveLength(0);
  expect(window.flashFrame.mock.calls).toEqual(isWindows ? [[true], [false]] : []);
});
