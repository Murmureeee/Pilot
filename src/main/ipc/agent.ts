// @env node
import { writeFile } from "node:fs/promises";

import { app, BrowserWindow, dialog, shell } from "electron";

import { IPC } from "../../shared/contract";
import { MemoryChanges } from "../agent-host/memory";
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
  saveSettings,
  exit,
}: Pick<IpcContext, "host" | "verification" | "getSettings" | "saveSettings" | "exit">): void {
  const memory = new MemoryChanges({ getSettings, saveSettings });
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
  handle(IPC.sessionSaveDraftImages, (_event, composerId, images) =>
    host.saveSessionDraftImages(composerId, images),
  );
  handle(IPC.agentResolveDroppedPaths, (_event, composerId, workingDirectory, paths) =>
    host.resolveDroppedPaths(composerId, workingDirectory, paths),
  );
  handle(IPC.sessionUpdateSettings, (_event, composerId, input) =>
    host.updateSessionSettings(composerId, input),
  );
  handle(IPC.sessionSetPlanMode, (_event, composerId, enabled) =>
    host.setPlanMode(composerId, enabled),
  );
  handle(IPC.sessionReviewPlan, (_event, composerId, proposalId, decision) => {
    if (decision.type === "execute") exit.checkWorkAllowed();
    void host.reviewPlan(composerId, proposalId, decision);
  });
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
  handle(IPC.sessionBranchMessage, (_event, id, messageId, action) => {
    if (action === "retry") exit.checkWorkAllowed();
    return host.branchMessage(id, messageId, action);
  });
  handle(IPC.sessionPreviewMessageRollback, (_event, id, messageId) => {
    exit.checkWorkAllowed();
    if (verification.hasActiveRuns()) throw new Error("请等待验证完成后再撤销。");
    return host.previewMessageRollback(id, messageId);
  });
  handle(IPC.sessionApplyMessageRollback, (_event, id, token) => {
    exit.checkWorkAllowed();
    if (verification.hasActiveRuns()) throw new Error("请等待验证完成后再撤销。");
    return host.applyMessageRollback(id, token);
  });
  handle(IPC.sessionCopy, (_event, id) => host.copySession(id));
  handle(IPC.sessionSearch, (_event, query, project) => host.searchSessions(query, project));
  handle(IPC.sessionExportMarkdown, async (event, id, locale) => {
    const { filename, markdown } = host.exportSessionMarkdown(id, locale);
    const options = {
      title: NATIVE_DIALOG_TITLES[locale].exportMarkdown,
      defaultPath: filename,
      filters: [{ name: "Markdown", extensions: ["md"] }],
    };
    const window = BrowserWindow.fromWebContents(event.sender);
    const result = window
      ? await dialog.showSaveDialog(window, options)
      : await dialog.showSaveDialog(options);
    if (result.canceled || !result.filePath) return null;
    await writeFile(result.filePath, markdown, "utf8");
    return result.filePath;
  });
  handle(IPC.sessionPersona, (_event, id, persona) => host.setSessionPersona(id, persona));
  handle(IPC.sessionInstructionSources, (_event, composerId) =>
    host.getInstructionSources(composerId),
  );
  handle(IPC.sessionPreviewMemory, (_event, composerId, expectedDirectory, scope, text) => {
    host.checkComposerId(composerId);
    const directory = host.getProjectDirectory();
    if (scope === "project" && (directory ?? null) !== expectedDirectory)
      throw new Error("项目已切换。请重新打开记忆审阅。");
    return memory.preview(composerId, directory, scope, text);
  });
  handle(IPC.sessionSaveMemory, (_event, composerId, token) => {
    exit.checkWorkAllowed();
    host.checkComposerId(composerId);
    memory.save(composerId, token, host.getProjectDirectory());
    host.publishSnapshot();
  });
  handle(IPC.sessionUndoMemory, (_event, composerId, token) => {
    exit.checkWorkAllowed();
    host.checkComposerId(composerId);
    memory.undo(composerId, token, host.getProjectDirectory());
    host.publishSnapshot();
  });
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
    return { sessionId, runId };
  };
  handle(IPC.sessionVerificationRun, (_event, composerId, runId) =>
    verification.result(verificationRef(composerId, runId)),
  );
  handle(IPC.sessionStartVerification, (_event, composerId, request) => {
    exit.checkWorkAllowed();
    const { sessionId, task } = host.verificationScope(composerId, request.workingDirectory);
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
