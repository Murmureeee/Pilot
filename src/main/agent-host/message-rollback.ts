// @env node
import { createHash } from "node:crypto";
import { relative, sep } from "node:path";

import type { AgentMessage } from "@earendil-works/pi-agent-core";

import type { MessageRollbackPreview } from "@shared/contract";

import { fingerprintText, readFileChange } from "../workspace/file-changes";
import { relativeGitPath } from "../workspace/git";
import { reviewGitCheckpointFile, verifyGitRollback } from "../workspace/git-checkpoint";
import {
  readGitWorktreeFile,
  replaceGitWorktreeFile,
  sameGitFile,
} from "../workspace/git-review-files";
import { isWithinDirectory } from "../workspace/paths";
import { buildTextDiff } from "../workspace/text-diff";
import { messageIndex } from "./message-operations";
import { isReadOnly } from "./tools";
import type {
  ApprovedToolResult,
  MessageRollbackFile,
  MessageRollbackJournal,
  PreparedMessageRollback,
  SavedMessageTask,
  SessionRecord,
  TimedAssistantMessage,
} from "./types";

function hasWorkspaceEffects(messages: readonly AgentMessage[]): boolean {
  const denied = new Set(
    messages
      .filter((message): message is ApprovedToolResult => message.role === "toolResult")
      .filter((message) => message.pilotApproval?.decision === "deny")
      .map((message) => message.toolCallId),
  );
  return messages.some(
    (message) =>
      message.role === "assistant" &&
      Array.isArray(message.content) &&
      message.content.some(
        (part) => part.type === "toolCall" && !isReadOnly(part.name) && !denied.has(part.id),
      ),
  );
}

function legacyTask(record: SessionRecord): SavedMessageTask | undefined {
  const saved = record.gitChanges;
  const checkpoint = saved?.checkpoint;
  if (
    !checkpoint ||
    record.messageHistory.tasks.some(({ task }) => task.agentRunId === checkpoint.id)
  )
    return;
  const first = record.messages.findIndex(
    (message) =>
      message.role === "assistant" &&
      (message as TimedAssistantMessage).pilotTiming?.runId === checkpoint.id,
  );
  const startIndex = record.messages.findLastIndex(
    ({ role }, index) => role === "user" && index < first,
  );
  if (startIndex < 0) return;
  let endIndex =
    record.messages.findLastIndex(
      (message) =>
        message.role === "assistant" &&
        (message as TimedAssistantMessage).pilotTiming?.runId === checkpoint.id,
    ) + 1;
  while (record.messages[endIndex]?.role === "toolResult") endIndex++;
  return {
    type: "pilot_message_task",
    startIndex,
    endIndex,
    task: { taskId: checkpoint.id, agentRunId: checkpoint.id },
    result: "success",
    workingDirectory: saved.workingDirectory,
    workspace: { kind: "git", snapshot: checkpoint.snapshot, files: checkpoint.files },
  };
}

function collectFolderChanges(
  messages: readonly AgentMessage[],
  directory: string,
  files: Map<string, MessageRollbackFile>,
  conflicts: MessageRollbackPreview["conflicts"],
): void {
  const results = new Map(
    messages
      .filter((message): message is ApprovedToolResult => message.role === "toolResult")
      .map((message) => [message.toolCallId, message]),
  );
  for (const message of messages.toReversed()) {
    if (message.role !== "assistant" || !Array.isArray(message.content)) continue;
    for (const part of message.content.toReversed()) {
      if (part.type !== "toolCall" || isReadOnly(part.name)) continue;
      const result = results.get(part.id);
      if (result?.pilotApproval?.decision === "deny") continue;
      const fileTool = part.name === "write_file" || part.name === "edit_file";
      const change = readFileChange(part.name, result?.details);
      if (fileTool && result && !result.isError && !change) continue;
      if (
        !change ||
        change.workingDirectory !== directory ||
        !isWithinDirectory(directory, change.absolutePath)
      ) {
        conflicts.push({ reason: "缺少可确认的任务检查点。请先在审查面板核对后续改动。" });
        continue;
      }
      if (change.summary.reverted) continue;
      const path = relative(directory, change.absolutePath).split(sep).join("/");
      const planned = files.get(path);
      const state = planned ? planned.target : readGitWorktreeFile(directory, directory, path);
      if (!change.snapshot || !state || fingerprintText(state.text) !== change.snapshot.afterHash) {
        conflicts.push({ path, reason: "文件已有后续改动，无法撤销此变更。" });
        continue;
      }
      const { before } = change.snapshot;
      files.set(path, {
        path,
        current: planned?.current ?? state,
        target: before === null ? null : { text: before, mode: state.mode },
      });
    }
  }
}

export async function prepareMessageRollback(
  record: SessionRecord,
  messageId: string,
  directory: string | undefined,
): Promise<PreparedMessageRollback> {
  const { messages, messageHistory } = record;
  const anchor = messageIndex(messages, messageId);
  if (messages[anchor].role !== "assistant") throw new Error("消息已变更，请重新选择。");
  let endIndex = anchor + 1;
  while (messages[endIndex]?.role === "toolResult") endIndex++;
  const removedMessages = messages
    .slice(endIndex)
    .filter(({ role }) => role === "user" || role === "assistant").length;
  if (removedMessages === 0) throw new Error("此回复之后没有消息。");
  const conflicts: MessageRollbackPreview["conflicts"] = [];
  const legacy = legacyTask(record);
  const tasks = [...messageHistory.tasks, ...(legacy ? [legacy] : [])]
    .filter((task) => task.endIndex > endIndex)
    .sort((a, b) => b.endIndex - a.endIndex);
  const git = tasks.find(({ workspace }) => workspace.kind === "git")?.workspace;
  const snapshot = git?.kind === "git" ? git.snapshot : undefined;
  const root = snapshot?.root ?? directory;
  const files = new Map<string, MessageRollbackFile>();
  let cursor = messages.length;

  const missing = (): void => {
    conflicts.push({ reason: "缺少可确认的任务检查点。请先在审查面板核对后续改动。" });
  };
  for (const task of tasks) {
    if (task.startIndex < endIndex || task.endIndex > cursor) {
      conflicts.push({ reason: "所选回复位于任务中途。请选择任务结束时的回复。" });
      continue;
    }
    if (hasWorkspaceEffects(messages.slice(task.endIndex, cursor))) missing();
    cursor = task.startIndex;
    const slice = messages.slice(task.startIndex, task.endIndex);
    const { workspace } = task;
    if (
      workspace.kind === "folder" &&
      directory &&
      !snapshot &&
      task.workingDirectory === directory
    ) {
      collectFolderChanges(slice, directory, files, conflicts);
      continue;
    }
    if (
      workspace.kind !== "git" ||
      !snapshot ||
      !directory ||
      directory !== task.workingDirectory ||
      snapshot.root !== workspace.snapshot.root ||
      snapshot.head !== workspace.snapshot.head
    ) {
      if (hasWorkspaceEffects(slice) || workspace.kind === "git") missing();
      continue;
    }
    const checkpointPaths = new Set(workspace.files.map(({ path }) => path));
    for (const message of slice) {
      if (message.role !== "toolResult") continue;
      const change = readFileChange(message.toolName, message.details);
      if (!change || change.summary.reverted) continue;
      const path = relativeGitPath(directory, snapshot.root, change.absolutePath);
      if (!checkpointPaths.has(path)) {
        conflicts.push({
          path,
          reason: "文件缺少 Git 检查点。请先在审查面板核对后续改动。",
        });
        checkpointPaths.add(path);
      }
    }
    for (const file of workspace.files) {
      if (!file.conflict && sameGitFile(file.before, file.after)) continue;
      const planned = files.get(file.path);
      const state = planned
        ? planned.target
        : readGitWorktreeFile(directory, snapshot.root, file.path);
      const review = reviewGitCheckpointFile(file, state);
      if (
        !review.wholeFile ||
        file.before === undefined ||
        state === undefined ||
        (planned && planned.index !== file.index)
      ) {
        conflicts.push({
          path: file.path,
          reason:
            review.conflict === "later-edit"
              ? "文件已有后续改动，无法撤销此变更。"
              : "任务改动与现有文件或暂存内容冲突。请在审查面板核对。",
        });
        continue;
      }
      files.set(file.path, {
        path: file.path,
        current: planned ? planned.current : state,
        target: file.before,
        index: file.index,
      });
    }
  }
  if (hasWorkspaceEffects(messages.slice(endIndex, cursor))) missing();

  const changes = [...files.values()].filter(
    ({ current, target }) => !sameGitFile(current, target),
  );
  if (directory && snapshot && !conflicts.length) {
    try {
      await verifyGitRollback(
        directory,
        snapshot,
        changes.map(({ path, index, current }) => ({
          path,
          index: index ?? "",
          after: current,
        })),
      );
    } catch (error) {
      conflicts.push({ reason: error instanceof Error ? error.message : String(error) });
    }
  }
  const journal: MessageRollbackJournal | undefined =
    directory && root && changes.length
      ? { type: "pilot_message_rollback", directory, root, head: snapshot?.head, files: changes }
      : undefined;
  const revision = createHash("sha256")
    .update(JSON.stringify([record, endIndex, journal]))
    .digest("hex");
  return {
    endIndex,
    revision,
    journal,
    preview: {
      removedMessages,
      files: changes.map(({ path, current, target }) => ({
        path,
        operation: target ? (current ? "modify" : "create") : "delete",
        diff: buildTextDiff(current?.text ?? null, target?.text ?? "").diff,
      })),
      conflicts,
    },
  };
}

export function applyMessageRollbackFiles(journal: MessageRollbackJournal): void {
  const { directory, root, files } = journal;
  for (const { path, current, target } of files)
    replaceGitWorktreeFile(directory, root, path, current, target);
}

export async function recoverMessageRollbackFiles(journal: MessageRollbackJournal): Promise<void> {
  const { directory, root, head, files } = journal;
  const pending = files.flatMap((file) => {
    const state = readGitWorktreeFile(directory, root, file.path);
    if (sameGitFile(state, file.current)) return [];
    if (!sameGitFile(state, file.target))
      throw new Error("文件在撤销过程中发生变化。请先核对工作区中的文件。");
    return [file];
  });
  if (head !== undefined && pending.length) {
    await verifyGitRollback(
      directory,
      { root, head },
      pending.map(({ path, index, target }) => ({
        path,
        index: index ?? "",
        after: target,
      })),
    );
  }
  for (const { path, current, target } of pending.toReversed())
    replaceGitWorktreeFile(directory, root, path, target, current);
}
