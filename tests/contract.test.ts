import { describe, expect, it } from "vitest";

import {
  AGENT_EVENT_CHANNEL,
  IPC,
  TERMINAL_EVENT_CHANNEL,
  UPDATE_STATUS_CHANNEL,
} from "../src/shared/contract";

describe("IPC contract", () => {
  it("uses unique channel names", () => {
    const names = Object.values(IPC);
    expect(new Set(names).size).toBe(names.length);
  });

  it("separates scheduled task maintenance from execution", () => {
    expect(IPC.scheduledTasksList).toBe("settings:scheduled-tasks-list");
    expect(IPC.scheduledTasksSave).toBe("settings:scheduled-tasks-save");
    expect(IPC.scheduledTasksRun).toBe("settings:scheduled-tasks-run");
    expect(IPC.scheduledTasksDelete).toBe("settings:scheduled-tasks-delete");
  });

  it("declares separate routes for resolving drops and saving draft images", () => {
    expect(IPC.agentResolveDroppedPaths).toBe("agent:resolve-dropped-paths");
    expect(IPC.sessionSaveDraftImages).toBe("session:save-draft-images");
  });

  it("separates backup selection and preview from confirmation and cancellation", () => {
    expect(IPC.appExportBackup).toBe("app:export-backup");
    expect(IPC.appPreviewBackup).toBe("app:preview-backup");
    expect(IPC.appCancelBackup).toBe("app:cancel-backup");
    expect(IPC.appRestoreBackup).toBe("app:restore-backup");
    expect(IPC.appBackupResult).toBe("app:backup-result");
  });

  it("separates worktree discovery, creation, review, and confirmation", () => {
    expect(IPC.sessionGitWorktrees).toBe("session:git-worktrees");
    expect(IPC.sessionCreateGitWorktree).toBe("session:create-git-worktree");
    expect(IPC.sessionPreviewGitWorktree).toBe("session:preview-git-worktree");
    expect(IPC.sessionApplyGitWorktree).toBe("session:apply-git-worktree");
    expect(IPC.sessionPreviewWorktreeArchive).toBe("session:preview-worktree-archive");
  });

  it("prefixes channels with a domain namespace", () => {
    for (const name of [
      ...Object.values(IPC),
      AGENT_EVENT_CHANNEL,
      TERMINAL_EVENT_CHANNEL,
      UPDATE_STATUS_CHANNEL,
    ]) {
      expect(name).toMatch(/^(app|agent|session|settings|skills|tool):/);
    }
  });

  it("keeps terminal updates separate from invoke routes and agent events", () => {
    expect(TERMINAL_EVENT_CHANNEL).toBe("session:terminal-event");
    expect([...Object.values(IPC), AGENT_EVENT_CHANNEL]).not.toContain(TERMINAL_EVENT_CHANNEL);
    expect(IPC.sessionOpenTerminal).toBe("session:open-terminal");
    expect(IPC.sessionWriteTerminal).toBe("session:write-terminal");
    expect(IPC.sessionStopTerminal).toBe("session:stop-terminal");
  });

  it("keeps update status notifications separate from invoke channels", () => {
    expect(UPDATE_STATUS_CHANNEL).toMatch(/^app:/);
    expect(Object.values(IPC)).not.toContain(UPDATE_STATUS_CHANNEL);
    expect(IPC.appDownloadUpdate).toBe("app:download-update");
    expect(IPC.appShowUpdatePackage).toBe("app:show-update-package");
    expect(IPC.settingsSetAutoDownloadUpdates).toBe("settings:set-auto-download-updates");
  });

  it("uses the settings namespace for the diagnostic log level", () => {
    expect(IPC.settingsSetLogLevel).toBe("settings:set-log-level");
  });

  it("keeps notification preferences and renderer visibility on separate invoke channels", () => {
    expect(IPC.appSetConversationVisible).toBe("app:set-conversation-visible");
    expect(IPC.settingsSetNotificationsEnabled).toBe("settings:set-notifications-enabled");
    expect(IPC.settingsSetExternalEditor).toBe("settings:set-external-editor");
  });

  it("uses the settings namespace for acknowledging a settings recovery", () => {
    expect(IPC.settingsDismissRecovery).toBe("settings:dismiss-recovery");
  });

  it("uses a dedicated settings route for revoking an approval", () => {
    expect(IPC.settingsRevokeToolRule).toBe("settings:revoke-tool-rule");
  });

  it("keeps MCP account controls on dedicated settings routes", () => {
    expect(IPC.settingsMcpOAuthStart).toBe("settings:mcp-oauth-start");
    expect(IPC.settingsMcpOAuthCancel).toBe("settings:mcp-oauth-cancel");
    expect(IPC.settingsMcpOAuthSignOut).toBe("settings:mcp-oauth-sign-out");
  });

  it("keeps focused model and thinking changes separate from editing providers", () => {
    expect(IPC.settingsSelectModel).toBe("settings:select-model");
    expect(IPC.settingsSetThinkingLevel).toBe("settings:set-thinking-level");
  });

  it("exposes a dedicated settings route for prompt templates", () => {
    expect(IPC.settingsSetPromptTemplates).toBe("settings:set-prompt-templates");
  });

  it("keeps plugin package selection, preview, installation, and removal on separate routes", () => {
    expect(IPC.settingsPickPluginPackage).toBe("settings:pick-plugin-package");
    expect(IPC.settingsPreviewPluginPackage).toBe("settings:preview-plugin-package");
    expect(IPC.settingsInstallPluginPackage).toBe("settings:install-plugin-package");
    expect(IPC.settingsUninstallPlugin).toBe("settings:uninstall-plugin");
  });

  it("keeps discovery in the settings namespace", () => {
    expect(IPC.settingsPluginMarketplaces).toBe("settings:plugin-marketplaces");
    expect(IPC.settingsBrowsePluginMarketplace).toBe("settings:browse-plugin-marketplace");
    expect(IPC.settingsRemovePluginMarketplace).toBe("settings:remove-plugin-marketplace");
    expect(IPC.settingsSearchMcpRegistry).toBe("settings:search-mcp-registry");
  });

  it("exposes Phase 3 wrap-up channels (重命名/删除/清空队列/数据目录/标题栏主题)", () => {
    expect(IPC.sessionRename).toBe("session:rename");
    expect(IPC.sessionDelete).toBe("session:delete");
    expect(IPC.sessionSelectProject).toBe("session:select-project");
    expect(IPC.sessionOpenDroppedProject).toBe("session:open-dropped-project");
    expect(IPC.sessionSaveDraft).toBe("session:save-draft");
    expect(IPC.sessionUpdateSettings).toBe("session:update-settings");
    expect(IPC.sessionSetPlanMode).toBe("session:set-plan-mode");
    expect(IPC.sessionReviewPlan).toBe("session:review-plan");
    expect(IPC.sessionUseRecentProject).toBe("session:use-recent-project");
    expect(IPC.sessionOpenProjectFolder).toBe("session:open-project-folder");
    expect(IPC.sessionRemoveRecentProject).toBe("session:remove-recent-project");
    expect(IPC.sessionGitHead).toBe("session:git-head");
    expect(IPC.sessionGitChanges).toBe("session:git-changes");
    expect(IPC.sessionGitDiff).toBe("session:git-diff");
    expect(IPC.sessionStageGit).toBe("session:stage-git");
    expect(IPC.sessionPreviewGitCommit).toBe("session:preview-git-commit");
    expect(IPC.sessionCommitGit).toBe("session:commit-git");
    expect(IPC.sessionGitBranches).toBe("session:git-branches");
    expect(IPC.sessionSwitchGitBranch).toBe("session:switch-git-branch");
    expect(IPC.sessionPreviewGitPush).toBe("session:preview-git-push");
    expect(IPC.sessionPushGit).toBe("session:push-git");
    expect(IPC.sessionPreviewGitPullRequest).toBe("session:preview-git-pull-request");
    expect(IPC.sessionCreateGitPullRequest).toBe("session:create-git-pull-request");
    expect(IPC.sessionGitCheckpointDiff).toBe("session:git-checkpoint-diff");
    expect(IPC.sessionPreviewGitRollback).toBe("session:preview-git-rollback");
    expect(IPC.sessionApplyGitRollback).toBe("session:apply-git-rollback");
    expect(IPC.sessionOpenGitLine).toBe("session:open-git-line");
    expect(IPC.sessionOpenWorkspaceFile).toBe("session:open-workspace-file");
    expect(IPC.agentClearQueue).toBe("agent:clear-queue");
    expect(IPC.agentResume).toBe("agent:resume");
    expect(IPC.agentCompact).toBe("agent:compact");
    expect(IPC.agentSearchWorkspace).toBe("agent:search-workspace");
    expect(IPC.agentPreviewWorkspaceReference).toBe("agent:preview-workspace-reference");
    expect(IPC.appOpenPath).toBe("app:open-path");
    expect(IPC.appSetLocale).toBe("app:set-locale");
    expect(IPC.appSetTitlebarTheme).toBe("app:set-titlebar-theme");
    expect(IPC.sessionPin).toBe("session:pin");
    expect(IPC.sessionArchive).toBe("session:archive");
    expect(IPC.sessionUnread).toBe("session:unread");
    expect(IPC.sessionFork).toBe("session:fork");
    expect(IPC.sessionBranchMessage).toBe("session:branch-message");
    expect(IPC.sessionPreviewMessageRollback).toBe("session:preview-message-rollback");
    expect(IPC.sessionApplyMessageRollback).toBe("session:apply-message-rollback");
    expect(IPC.sessionCopy).toBe("session:copy");
    expect(IPC.sessionSearch).toBe("session:search");
    expect(IPC.sessionExportMarkdown).toBe("session:export-markdown");
    expect(IPC.settingsModelCatalog).toBe("settings:model-catalog");
    expect(IPC.settingsTestProvider).toBe("settings:test-provider");
    expect(IPC.settingsPickWorkingDirectory).toBe("settings:pick-working-directory");
    expect(IPC.skillsList).toBe("skills:list");
    expect(IPC.skillsRead).toBe("skills:read");
    expect(IPC.skillsDelete).toBe("skills:delete");
    expect(IPC.skillsImport).toBe("skills:import");
    expect(IPC.skillsToggle).toBe("skills:toggle");
    expect(IPC.sessionPersona).toBe("session:persona");
    expect(IPC.sessionInstructionSources).toBe("session:instruction-sources");
    expect(IPC.sessionPreviewMemory).toBe("session:preview-memory");
    expect(IPC.sessionSaveMemory).toBe("session:save-memory");
    expect(IPC.sessionUndoMemory).toBe("session:undo-memory");
    expect(IPC.sessionFileDiff).toBe("session:file-diff");
    expect(IPC.sessionUndoFileChange).toBe("session:undo-file-change");
    expect(IPC.sessionVerification).toBe("session:verification");
    expect(IPC.sessionVerificationRun).toBe("session:verification-run");
    expect(IPC.sessionStartVerification).toBe("session:start-verification");
    expect(IPC.sessionStopVerification).toBe("session:stop-verification");
    expect(IPC.sessionRerunVerification).toBe("session:rerun-verification");
    expect(IPC.sessionSetAfterTurnVerification).toBe("session:set-after-turn-verification");
    expect(IPC.sessionRepairVerification).toBe("session:repair-verification");
  });
});
