import { EventEmitter } from "node:events";
import type { IpcMainInvokeEvent, WebContents } from "electron";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { registerIpc } from "../src/main/ipc";
import { handle, registerRenderer, sendToRenderers } from "../src/main/ipc/transport";
import type { IpcContext } from "../src/main/ipc/types";
import { AGENT_EVENT_CHANNEL, IPC, type UiAgentEvent } from "../src/shared/contract";

const { ipcHandle } = vi.hoisted(() => ({
  ipcHandle:
    vi.fn<
      (channel: string, handler: (event: IpcMainInvokeEvent, ...args: unknown[]) => unknown) => void
    >(),
}));

vi.mock("electron", () => ({
  ipcMain: { handle: ipcHandle },
  app: {},
  BrowserWindow: {},
  dialog: {},
  nativeTheme: {},
  safeStorage: {},
  shell: {},
}));

describe("main IPC routes", () => {
  beforeEach(() => ipcHandle.mockClear());

  it("registers every invoke channel exactly once", () => {
    registerIpc({} as IpcContext);
    expect(ipcHandle.mock.calls.map(([channel]) => channel).sort()).toEqual(
      Object.values(IPC).sort(),
    );
  });

  it("checks the registered top-level frame before validating or invoking a handler", () => {
    const frame = {};
    const renderer = Object.assign(new EventEmitter(), {
      mainFrame: frame,
      send: vi.fn<(channel: string, payload: unknown) => void>(),
    });
    const sender = renderer as unknown as WebContents;
    const listener = vi.fn<() => string>(() => "handled");
    const invokeFrom = (contents: object, senderFrame: object | null, args: object): unknown =>
      ipcHandle.mock.calls[0][1]({ sender: contents, senderFrame } as IpcMainInvokeEvent, args);
    const event: UiAgentEvent = { type: "sessions", sessions: [], recentProjects: [] };

    registerRenderer(sender);
    try {
      handle(IPC.ping, listener);
      expect(() => invokeFrom({ mainFrame: frame }, frame, { payload: "ping" })).toThrow(
        /Invalid IPC sender/,
      );
      expect(() => invokeFrom(sender, {}, { payload: "ping" })).toThrow(/Invalid IPC sender/);
      expect(() => invokeFrom(sender, null, { payload: "ping" })).toThrow(/Invalid IPC sender/);
      expect(() => invokeFrom(sender, frame, { payload: 1 })).toThrow(/Invalid IPC arguments/);
      expect(listener).not.toHaveBeenCalled();
      expect(invokeFrom(sender, frame, { payload: "ping" })).toBe("handled");
      sendToRenderers(AGENT_EVENT_CHANNEL, event);
      expect(renderer.send).toHaveBeenCalledExactlyOnceWith(AGENT_EVENT_CHANNEL, event);
    } finally {
      renderer.emit("destroyed");
    }
    sendToRenderers(AGENT_EVENT_CHANNEL, event);
    expect(renderer.send).toHaveBeenCalledTimes(1);
    expect(() => invokeFrom(sender, frame, { payload: "ping" })).toThrow(/Invalid IPC sender/);
  });
});
