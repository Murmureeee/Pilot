// @env node
import { IPC } from "../../shared/contract";
import { runAgentSmoke } from "../agent-host/smoke";
import { searchWorkspace } from "../workspace/search";
import { handle } from "./transport";
import type { IpcContext } from "./types";

export function registerAgentRoutes(ctx: Pick<IpcContext, "host" | "getSettings">): void {
  handle(IPC.runAgentSmoke, () => runAgentSmoke());
  handle(IPC.agentGetSnapshot, () => ctx.host.getSnapshot());
  handle(IPC.agentSearchWorkspace, (_event, query) =>
    searchWorkspace(ctx.getSettings().workingDirectory, query),
  );
  handle(IPC.agentPrompt, (_event, text, referenceDirectory) => {
    if (
      referenceDirectory !== undefined &&
      !ctx.host.acceptsReferenceDirectory(referenceDirectory)
    ) {
      throw new Error("工作目录已变更，请重新选择文件引用。");
    }
    // 不 await：结果通过事件流推送
    void ctx.host.prompt(text);
  });
  handle(IPC.agentAbort, () => ctx.host.abort());

  handle(IPC.sessionNew, () => ctx.host.newSession());
  handle(IPC.sessionLoad, (_event, id) => ctx.host.loadSession(id));
  handle(IPC.sessionRename, (_event, id, title) =>
    ctx.host.renameSession(id, title.trim().slice(0, 100)),
  );
  handle(IPC.sessionDelete, (_event, id) => ctx.host.deleteSession(id));
  handle(IPC.sessionPin, (_event, id, pinned) => ctx.host.pinSession(id, pinned));
  handle(IPC.sessionArchive, (_event, id, archived) => ctx.host.archiveSession(id, archived));
  handle(IPC.sessionUnread, (_event, id, unread) => ctx.host.unreadSession(id, unread));
  handle(IPC.sessionFork, (_event, id) => ctx.host.forkSession(id));
  handle(IPC.sessionCopy, (_event, id) => ctx.host.copySession(id));
  handle(IPC.sessionPersona, (_event, id, persona) => ctx.host.setSessionPersona(id, persona));
  handle(IPC.agentClearQueue, () => ctx.host.clearQueue());

  handle(IPC.toolPermissionRespond, (_event, requestId, decision) =>
    ctx.host.respondPermission(requestId, decision),
  );
}
