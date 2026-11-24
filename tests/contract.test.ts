import { describe, expect, it } from "vitest";

import { AGENT_EVENT_CHANNEL, IPC, UPDATE_STATUS_CHANNEL } from "../src/shared/contract";

describe("IPC contract", () => {
  it("uses unique channel names", () => {
    const names = Object.values(IPC);
    expect(new Set(names).size).toBe(names.length);
  });

  it("prefixes channels with a domain namespace", () => {
    for (const name of [...Object.values(IPC), AGENT_EVENT_CHANNEL]) {
      expect(name).toMatch(/^(app|agent|session|settings|skills|tool):/);
    }
  });

  it("keeps update status notifications separate from invoke channels", () => {
    expect(UPDATE_STATUS_CHANNEL).toMatch(/^app:/);
    expect(Object.values(IPC)).not.toContain(UPDATE_STATUS_CHANNEL);
  });

  it("uses the settings namespace for the diagnostic log level", () => {
    expect(IPC.settingsSetLogLevel).toBe("settings:set-log-level");
  });

  it("uses the settings namespace for acknowledging a settings recovery", () => {
    expect(IPC.settingsDismissRecovery).toBe("settings:dismiss-recovery");
  });

  it("uses a dedicated settings route for revoking an approval", () => {
    expect(IPC.settingsRevokeToolRule).toBe("settings:revoke-tool-rule");
  });

  it("keeps focused model and thinking changes separate from editing providers", () => {
    expect(IPC.settingsSelectModel).toBe("settings:select-model");
    expect(IPC.settingsSetThinkingLevel).toBe("settings:set-thinking-level");
  });

  it("exposes Phase 3 wrap-up channels (重命名/删除/清空队列/数据目录/标题栏主题)", () => {
    expect(IPC.sessionRename).toBe("session:rename");
    expect(IPC.sessionDelete).toBe("session:delete");
    expect(IPC.sessionSelectProject).toBe("session:select-project");
    expect(IPC.sessionSaveDraft).toBe("session:save-draft");
    expect(IPC.sessionUpdateSettings).toBe("session:update-settings");
    expect(IPC.sessionUseRecentProject).toBe("session:use-recent-project");
    expect(IPC.sessionGitHead).toBe("session:git-head");
    expect(IPC.sessionGitChanges).toBe("session:git-changes");
    expect(IPC.sessionGitDiff).toBe("session:git-diff");
    expect(IPC.sessionStageGit).toBe("session:stage-git");
    expect(IPC.sessionPreviewGitCommit).toBe("session:preview-git-commit");
    expect(IPC.sessionCommitGit).toBe("session:commit-git");
    expect(IPC.sessionGitCheckpointDiff).toBe("session:git-checkpoint-diff");
    expect(IPC.sessionPreviewGitRollback).toBe("session:preview-git-rollback");
    expect(IPC.sessionApplyGitRollback).toBe("session:apply-git-rollback");
    expect(IPC.sessionOpenGitLine).toBe("session:open-git-line");
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
    expect(IPC.sessionCopy).toBe("session:copy");
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
    expect(IPC.sessionFileDiff).toBe("session:file-diff");
    expect(IPC.sessionUndoFileChange).toBe("session:undo-file-change");
    expect(IPC.sessionVerification).toBe("session:verification");
    expect(IPC.sessionVerificationRun).toBe("session:verification-run");
    expect(IPC.sessionStartVerification).toBe("session:start-verification");
    expect(IPC.sessionStopVerification).toBe("session:stop-verification");
    expect(IPC.sessionRerunVerification).toBe("session:rerun-verification");
  });
});
