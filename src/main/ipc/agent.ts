// @env node
import { app, BrowserWindow, dialog } from "electron";
import { IPC } from "../../shared/contract";
import { runAgentSmoke } from "../agent-host/smoke";
import { NATIVE_DIALOG_TITLES } from "../constants";
import { readProjectGitHead } from "../workspace/git";
import { previewWorkspaceReference } from "../workspace/reference";
import { searchWorkspace } from "../workspace/search";
import { handle } from "./transport";
import type { IpcContext } from "./types";

export function registerAgentRoutes({ host }: Pick<IpcContext, "host">): void {
  handle(IPC.runAgentSmoke, () => runAgentSmoke());
  handle(IPC.agentGetSnapshot, () => host.getSnapshot());
  handle(IPC.agentSearchWorkspace, (_event, query, expectedDirectory) => {
    if (expectedDirectory !== undefined) host.checkWorkingDirectory(expectedDirectory);
    return searchWorkspace(host.getWorkingDirectory(), query);
  });
  handle(IPC.agentPreviewWorkspaceReference, (_event, reference) =>
    previewWorkspaceReference(host.getWorkingDirectory(), reference),
  );
  handle(IPC.agentPrompt, (_event, input, expectedDirectory) => {
    if (expectedDirectory !== undefined) host.checkWorkingDirectory(expectedDirectory);
    const prompt = host.preparePrompt(input);
    // 不 await：结果通过事件流推送
    void host.prompt(prompt);
  });
  handle(IPC.agentAbort, () => host.abort());

  handle(IPC.sessionNew, () => host.newSession());
  handle(IPC.sessionSelectProject, async (event, locale, sessionId) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    const title = NATIVE_DIALOG_TITLES[locale][sessionId ? "bindProject" : "openProject"];
    const options = {
      title,
      defaultPath: host.getWorkingDirectory() ?? app.getPath("home"),
      properties: ["openDirectory" as const],
    };
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options);
    const directory = result.canceled ? undefined : result.filePaths[0];
    if (!directory) return null;
    return sessionId ? host.bindProject(sessionId, directory) : host.openProject(directory);
  });
  handle(IPC.sessionUseRecentProject, (_event, directory, sessionId) =>
    host.useRecentProject(directory, sessionId),
  );
  handle(IPC.sessionGitHead, (_event, directory) =>
    directory === host.getProjectDirectory() ? readProjectGitHead(directory) : null,
  );
  handle(IPC.sessionLoad, (_event, id) => host.loadSession(id));
  handle(IPC.sessionRename, (_event, id, title) =>
    host.renameSession(id, title.trim().slice(0, 100)),
  );
  handle(IPC.sessionDelete, (_event, id) => host.deleteSession(id));
  handle(IPC.sessionPin, (_event, id, pinned) => host.pinSession(id, pinned));
  handle(IPC.sessionArchive, (_event, id, archived) => host.archiveSession(id, archived));
  handle(IPC.sessionUnread, (_event, id, unread) => host.unreadSession(id, unread));
  handle(IPC.sessionFork, (_event, id) => host.forkSession(id));
  handle(IPC.sessionCopy, (_event, id) => host.copySession(id));
  handle(IPC.sessionPersona, (_event, id, persona) => host.setSessionPersona(id, persona));
  handle(IPC.sessionFileDiff, (_event, id, changeId) => host.getFileDiff(id, changeId));
  handle(IPC.sessionUndoFileChange, (_event, id, changeId) => host.undoFileChange(id, changeId));
  handle(IPC.agentClearQueue, () => host.clearQueue());

  handle(IPC.toolPermissionRespond, (_event, requestId, decision) =>
    host.respondPermission(requestId, decision),
  );
}
