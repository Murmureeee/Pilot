// @env node
import { app, dialog } from "electron";

import { IPC, type ProviderInput, type SkillMeta } from "../../shared/contract";
import { SKILL_UNAVAILABLE } from "../agent-host/constants";
import { listModels, resolveProviderRef, testProvider } from "../agent-host/models";
import { deleteSkillDirectory, importSkill, readSkillFile } from "../agent-host/skills";
import { NATIVE_DIALOG_TITLES } from "../constants";
import { prepareSettingsInput, toPublicSettings, validateSettingsInput } from "../settings";
import { updateActiveModel } from "../settings/models";
import { decryptProviderKey } from "../settings/secrets";
import { sameToolRule } from "../settings/tool-rules";
import { handle } from "./transport";
import type { IpcContext } from "./types";

export function registerSettingsRoutes(
  ctx: Pick<IpcContext, "host" | "skillsDir" | "getSettings" | "saveSettings" | "request">,
): void {
  handle(IPC.settingsGet, () => toPublicSettings(ctx.getSettings()));
  handle(IPC.settingsSetPromptTemplates, (_event, promptTemplates) => {
    const settings = { ...ctx.getSettings(), promptTemplates };
    ctx.saveSettings(settings);
    return toPublicSettings(settings);
  });
  handle(IPC.settingsSetNotificationsEnabled, (_event, notificationsEnabled) => {
    ctx.saveSettings({ ...ctx.getSettings(), notificationsEnabled });
  });
  handle(IPC.settingsSetAutoDownloadUpdates, (_event, autoDownloadUpdates) => {
    ctx.saveSettings({ ...ctx.getSettings(), autoDownloadUpdates });
  });
  handle(IPC.settingsSetExternalEditor, (_event, externalEditor) => {
    ctx.saveSettings({ ...ctx.getSettings(), externalEditor });
    return externalEditor;
  });
  handle(IPC.settingsSetLogLevel, (_event, logLevel) => {
    ctx.saveSettings({ ...ctx.getSettings(), logLevel });
  });
  handle(IPC.settingsSelectModel, (_event, providerId, modelId) => {
    const settings = updateActiveModel(ctx.getSettings(), providerId, modelId);
    ctx.saveSettings(settings);
    return toPublicSettings(settings);
  });
  handle(IPC.settingsSetThinkingLevel, (_event, thinkingLevel) => {
    const current = ctx.getSettings();
    const { thinkingLevels } = toPublicSettings(current);
    if (!thinkingLevels.includes(thinkingLevel)) throw new Error("请从已启用的思考强度中选择。");
    const settings = { ...current, thinkingLevel };
    ctx.saveSettings(settings);
    return toPublicSettings(settings);
  });
  handle(IPC.settingsDismissRecovery, () => {
    const { recoveredFrom, ...settings } = ctx.getSettings();
    if (recoveredFrom) ctx.saveSettings(settings);
    return toPublicSettings(settings);
  });
  handle(IPC.settingsRevokeToolRule, (_event, rule) => {
    const current = ctx.getSettings();
    const rules = current.toolRules ?? [];
    const remaining = rules.filter((candidate) => !sameToolRule(candidate, rule));
    const settings = { ...current, toolRules: remaining };
    if (remaining.length !== rules.length) ctx.saveSettings(settings);
    return toPublicSettings(settings);
  });
  const requireSkill = (composerId: string, id: string, directory?: string): SkillMeta => {
    const skill = ctx.host.listSkills(composerId).find((entry) => entry.id === id);
    if (!skill || (directory !== undefined && skill.directory !== directory))
      throw new Error(SKILL_UNAVAILABLE);
    return skill;
  };
  handle(IPC.skillsList, (_event, composerId) => ctx.host.listSkills(composerId));
  handle(IPC.skillsRead, (_event, composerId, id, directory) =>
    readSkillFile(requireSkill(composerId, id, directory)),
  );
  handle(IPC.skillsDelete, (_event, composerId, id, directory) => {
    const skill = requireSkill(composerId, id, directory);
    deleteSkillDirectory(skill);
    if (skill.source === "installed") {
      const settings = ctx.getSettings();
      ctx.saveSettings({
        ...settings,
        skillsEnabled: settings.skillsEnabled?.filter((enabledId) => enabledId !== id),
        importedPlugins: settings.importedPlugins?.map((plugin) => ({
          ...plugin,
          skillIds: plugin.skillIds.filter((skillId) => skillId !== id),
        })),
      });
    }
    return ctx.host.listSkills(composerId);
  });
  // 主进程弹目录选择框（渲染层无文件系统权限），取消返回 null
  handle(IPC.skillsImport, async (_event, locale, composerId) => {
    const result = await dialog.showOpenDialog({
      title: NATIVE_DIALOG_TITLES[locale].skill,
      properties: ["openDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    importSkill(result.filePaths[0], ctx.skillsDir);
    return ctx.host.listSkills(composerId);
  });
  handle(IPC.skillsToggle, (_event, composerId, id, enabled) => {
    if (requireSkill(composerId, id).source !== "installed") throw new Error(SKILL_UNAVAILABLE);
    const settings = ctx.getSettings();
    const current = new Set(settings.skillsEnabled ?? []);
    if (enabled) current.add(id);
    else current.delete(id);
    ctx.saveSettings({ ...settings, skillsEnabled: [...current] });
    return ctx.host.listSkills(composerId);
  });

  handle(IPC.settingsPickWorkingDirectory, async (_event, locale) => {
    const result = await dialog.showOpenDialog({
      title: NATIVE_DIALOG_TITLES[locale].workingDirectory,
      defaultPath: ctx.getSettings().workingDirectory ?? app.getPath("home"),
      properties: ["openDirectory"],
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
  });
  // ref = 已保存 provider id（string，key 从存储解密）或未保存草稿（ProviderInput，FR-5.7 向导）
  const providerRef = (ref: string | ProviderInput): ReturnType<typeof resolveProviderRef> => {
    const { providers } = ctx.getSettings();
    return resolveProviderRef(ref, (id) => providers.find((p) => p.id === id), decryptProviderKey);
  };
  handle(IPC.settingsModelCatalog, async (_event, ref) => {
    const { cfg, key } = await providerRef(ref);
    return listModels(cfg, key, ctx.request);
  });
  handle(IPC.settingsTestProvider, async (_event, ref) => {
    const { cfg, key } = await providerRef(ref);
    return testProvider(cfg, key, ctx.request);
  });
  let pendingSave = Promise.resolve();
  handle(IPC.settingsSave, (_event, input) => {
    const invalid = validateSettingsInput(input);
    if (invalid) throw new Error(invalid);
    const save = pendingSave.then(async () => {
      const apply = await prepareSettingsInput(input);
      const current = ctx.getSettings();
      const merged = apply(current);
      ctx.saveSettings(merged);
      if (current.workingDirectory !== merged.workingDirectory) ctx.host.publishSnapshot();
      return toPublicSettings(merged);
    });
    // Form saves replace the provider list, so preserve their invocation order.
    pendingSave = save.then(
      () => {},
      () => {},
    );
    return save;
  });
}
