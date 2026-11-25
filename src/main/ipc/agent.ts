// @env node
import { app, BrowserWindow, dialog, shell } from "electron";

import { IPC } from "../../shared/contract";
import { runAgentSmoke } from "../agent-host/smoke";
import { NATIVE_DIALOG_TITLES } from "../constants";
import { openVsCodeAtLine } from "../workspace/editor";
import { readProjectGitHead } from "../workspace/git";
import { previewWorkspaceReference } from "../workspace/reference";
import { searchWorkspace } from "../workspace/search";
import { getCommandShell } from "../workspace/shell";
import { handle } from "./transport";
import type { IpcContext } from "./types";

export function registerAgentRoutes({
  host,
  verification,
  getSettings,
  exit,
}: Pick<IpcContext, "host" | "verification" | "getSettings" | "exit">): void {
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
    exit.checkWorkAllowed();
    const result = host.prompt(input, composerId, expectedDirectory);
    return result instanceof Promise ? null : result;
  });
  handle(IPC.agentResume, (_event, run, compact) => {
    exit.checkWorkAllowed();
    const result = host.resume(run, compact);
    return result instanceof Promise ? null : result;
  });
  handle(IPC.agentCompact, (_event, composerId, focus) => {
    exit.checkWorkAllowed();
    void host.compact(composerId, focus);
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
  handle(IPC.sessionOpenProjectFolder, async (_event, directory) => {
    const error = await shell.openPath(host.projectFolder(directory));
    if (error) throw new Error("无法在文件管理器中打开该项目。", { cause: error });
  });
  handle(IPC.sessionRemoveRecentProject, (_event, directory) =>
    host.removeRecentProject(directory),
  );
  handle(IPC.sessionGitHead, (_event, directory) =>
    directory === host.getProjectDirectory() ? readProjectGitHead(directory) : null,
  );
  handle(IPC.sessionGitChanges, (_event, composerId, live) => host.getGitChanges(composerId, live));
  handle(IPC.sessionGitDiff, (_event, composerId, request) =>
    host.getGitFileDiff(composerId, request),
  );
  handle(IPC.sessionStageGit, (_event, composerId, selection) =>
    host.stageGit(composerId, selection),
  );
  handle(IPC.sessionPreviewGitCommit, (_event, composerId, selections) =>
    host.previewGitCommit(composerId, selections),
  );
  handle(IPC.sessionCommitGit, (_event, composerId, token, message) =>
    host.commitGit(composerId, token, message),
  );
  handle(IPC.sessionGitCheckpointDiff, (_event, composerId, id, path) =>
    host.getGitCheckpointDiff(composerId, id, path),
  );
  handle(IPC.sessionPreviewGitRollback, (_event, composerId, selection) =>
    host.previewGitRollback(composerId, selection),
  );
  handle(IPC.sessionApplyGitRollback, (_event, composerId, token) =>
    host.applyGitRollback(composerId, token),
  );
  handle(IPC.sessionOpenGitLine, async (_event, composerId, request, line) => {
    const path = await host.getGitEditorPath(composerId, request, line);
    await openVsCodeAtLine(path, line);
  });
  handle(IPC.sessionLoad, (_event, id, record) => host.loadSession(id, record));
  handle(IPC.sessionRename, (_event, id, title) =>
    host.renameSession(id, title.trim().slice(0, 100)),
  );
  handle(IPC.sessionDelete, async (_event, id) => {
    const snapshot = await host.deleteSession(id);
    await verification.remove(id);
    return snapshot;
  });
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
  handle(IPC.sessionVerification, (_event, composerId) => {
    const { sessionId, workingDirectory } = host.verificationScope(composerId);
    return verification.state(sessionId, workingDirectory);
  });
  const verificationRef = (
    composerId: string,
    runId: string,
  ): { sessionId: string; runId: string } => {
    const { sessionId } = host.verificationScope(composerId);
    if (!sessionId) throw new Error("找不到这次验证。");
    return { sessionId, runId };
  };
  handle(IPC.sessionVerificationRun, (_event, composerId, runId) =>
    verification.result(verificationRef(composerId, runId)),
  );
  handle(IPC.sessionStartVerification, (_event, composerId, request) => {
    exit.checkWorkAllowed();
    const { sessionId, task } = host.verificationScope(composerId, request.workingDirectory);
    if (!sessionId) throw new Error("请先选择工作目录。");
    return verification.start({
      ...request,
      sessionId,
      task,
      shell: getCommandShell(getSettings().commandShell),
    });
  });
  handle(IPC.sessionStopVerification, (_event, composerId, runId) =>
    verification.stop(verificationRef(composerId, runId)),
  );
  handle(IPC.sessionRerunVerification, (_event, composerId, runId) => {
    exit.checkWorkAllowed();
    return verification.rerun(verificationRef(composerId, runId));
  });
  handle(IPC.agentClearQueue, (_event, run) => host.clearQueue(run));

  handle(IPC.toolPermissionRespond, (_event, run, requestId, decision) =>
    host.respondPermission(run, requestId, decision),
  );
}
