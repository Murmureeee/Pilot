import { describe, expect, it } from "vitest";
import { IPC, UPDATE_STATUS_CHANNEL } from "../src/shared/contract";

describe("IPC contract", () => {
  it("uses unique channel names", () => {
    const names = Object.values(IPC);
    expect(new Set(names).size).toBe(names.length);
  });

  it("prefixes channels with a domain namespace", () => {
    for (const name of Object.values(IPC)) {
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

  it("keeps focused model and thinking changes separate from editing providers", () => {
    expect(IPC.settingsSelectModel).toBe("settings:select-model");
    expect(IPC.settingsSetThinkingLevel).toBe("settings:set-thinking-level");
  });

  it("exposes Phase 3 wrap-up channels (重命名/删除/清空队列/数据目录/标题栏主题)", () => {
    expect(IPC.sessionRename).toBe("session:rename");
    expect(IPC.sessionDelete).toBe("session:delete");
    expect(IPC.sessionSelectProject).toBe("session:select-project");
    expect(IPC.agentClearQueue).toBe("agent:clear-queue");
    expect(IPC.agentSearchWorkspace).toBe("agent:search-workspace");
    expect(IPC.agentPreviewWorkspaceReference).toBe("agent:preview-workspace-reference");
    expect(IPC.appOpenPath).toBe("app:open-path");
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
    expect(IPC.skillsImport).toBe("skills:import");
    expect(IPC.skillsToggle).toBe("skills:toggle");
    expect(IPC.sessionPersona).toBe("session:persona");
    expect(IPC.sessionFileDiff).toBe("session:file-diff");
    expect(IPC.sessionUndoFileChange).toBe("session:undo-file-change");
  });
});
