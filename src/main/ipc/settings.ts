// @env node
import { app, dialog } from "electron";
import { IPC, type ProviderInput } from "../../shared/contract";
import { listModels, resolveProviderRef, testProvider } from "../agent-host/models";
import { importSkill, scanSkills } from "../agent-host/skills";
import { NATIVE_DIALOG_TITLES } from "../constants";
import { mergeSettingsInput, toPublicSettings, validateSettingsInput } from "../settings";
import { decryptSecret } from "../settings/secrets";
import { handle } from "./transport";
import type { IpcContext } from "./types";

export function registerSettingsRoutes(
  ctx: Pick<IpcContext, "skillsDir" | "getSettings" | "saveSettings" | "host">,
): void {
  handle(IPC.settingsGet, () => toPublicSettings(ctx.getSettings()));
  const skillList = () => {
    const settings = ctx.getSettings();
    return scanSkills(ctx.skillsDir, settings.skillsEnabled ?? []);
  };
  handle(IPC.skillsList, () => skillList());
  // 主进程弹目录选择框（渲染层无文件系统权限），取消返回 null
  handle(IPC.skillsImport, async (_event, locale) => {
    const result = await dialog.showOpenDialog({
      title: NATIVE_DIALOG_TITLES[locale].skill,
      properties: ["openDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) return null;
    importSkill(result.filePaths[0], ctx.skillsDir);
    return skillList();
  });
  handle(IPC.skillsToggle, (_event, id, enabled) => {
    const settings = ctx.getSettings();
    const current = new Set(settings.skillsEnabled ?? []);
    if (enabled) current.add(id);
    else current.delete(id);
    ctx.saveSettings({ ...settings, skillsEnabled: [...current] });
    return skillList();
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
    return resolveProviderRef(ref, (id) => providers.find((p) => p.id === id), decryptSecret);
  };
  handle(IPC.settingsModelCatalog, (_event, ref) => {
    const { cfg, key } = providerRef(ref);
    return listModels(cfg, key);
  });
  handle(IPC.settingsTestProvider, (_event, ref) => {
    const { cfg, key } = providerRef(ref);
    return testProvider(cfg, key);
  });
  handle(IPC.settingsSave, (_event, input) => {
    const invalid = validateSettingsInput(input);
    if (invalid) throw new Error(invalid);
    const merged = mergeSettingsInput(ctx.getSettings(), input);
    ctx.saveSettings(merged);
    // 思考强度运行时同步到当前 Agent（provider/权限模式由各自通道/下次 prompt 生效）
    if (input.thinkingLevel) ctx.host.setThinkingLevel(input.thinkingLevel);
    return toPublicSettings(merged);
  });
}
