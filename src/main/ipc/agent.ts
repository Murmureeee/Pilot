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
  handle(IPC.agentGetSnapshot, () => host.publishSnapshot());
  handle(IPC.agentSearchWorkspace, (_event, query, expectedDirectory) => {
    if (expectedDirectory !== undefined) host.checkWorkingDirectory(expectedDirectory);
    return searchWorkspace(host.getWorkingDirectory(), query);
  });
  handle(IPC.agentPreviewWorkspaceReference, (_event, reference) =>
    previewWorkspaceReference(host.getWorkingDirectory(), reference),
  );
  handle(IPC.agentPrompt, (_event, input, expectedDirectory, composerId) => {
    const result = host.prompt(input, composerId, expectedDirectory);
    return result instanceof Promise ? null : result;
  });
  handle(IPC.agentResume, (_event, run) => {
    const result = host.resume(run);
    return result instanceof Promise ? null : result;
  });
  handle(IPC.agentAbort, (_event, run) => host.abort(run));

  handle(IPC.sessionNew, () => host.newSession());
  handle(IPC.sessionSaveDraft, (_event, composerId, draft) =>
    host.saveSessionDraft(composerId, draft),
  );
  handle(IPC.sessionUpdateSettings, (_event, composerId, input) =>
    host.updateSessionSettings(composerId, input),
  );
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
  handle(IPC.sessionLoad, (_event, id, record) => host.loadSession(id, record));
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
  handle(IPC.sessionInstructionSources, (_event, composerId) =>
    host.getInstructionSources(composerId),
  );
  handle(IPC.sessionFileDiff, (_event, id, changeId) => host.getFileDiff(id, changeId));
  handle(IPC.sessionUndoFileChange, (_event, id, changeId) => host.undoFileChange(id, changeId));
  handle(IPC.agentClearQueue, (_event, run) => host.clearQueue(run));

  handle(IPC.toolPermissionRespond, (_event, run, requestId, decision) =>
    host.respondPermission(run, requestId, decision),
  );
}
