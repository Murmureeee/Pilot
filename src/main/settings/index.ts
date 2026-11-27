// @env node
import { readFileSync } from "node:fs";
import { join } from "node:path";

import type { LogLevel, PublicSettings, SettingsInput } from "@shared/contract";

import {
  DEFAULT_EXTERNAL_EDITOR,
  DEFAULT_LOG_LEVEL,
  DEFAULT_THINKING_LEVEL,
  LOG_LEVELS,
  OPENAI_RESPONSES_MIN_TOKENS,
  THINKING_LEVELS,
} from "../../shared/constants";
import { hasSavedModel, isOpenAiProvider } from "../../shared/providers";
import { selectThinkingLevel } from "../../shared/thinking";
import { automaticModelCapabilities } from "../agent-host/model-capabilities";
import { SETTINGS_FILE_NAME, SETTINGS_FORMAT_VERSION, SETTINGS_SAVE_BLOCKED } from "../constants";
import { backupCorruptFile } from "../corrupt-file";
import { NewerFormatError, writeStorageAtomic } from "../storage-format";
import { normalizeWorkingDirectory } from "../workspace/paths";
import { findGitBash, getCommandShell } from "../workspace/shell";
import { pruneMcpOAuth } from "./mcp";
import { getProviderModels, normalizeModelCatalog } from "./models";
import { parseSettings } from "./schema";
import { encryptSecret } from "./secrets";
import type { ProviderConfig, Settings } from "./types";

function readSettingsFile(path: string): Buffer | undefined {
  try {
    return readFileSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
}

function writeSettings(path: string, settings: Settings): void {
  const { recoveryBlocked: _blocked, upgradeRequired: _upgrade, ...data } = settings;
  writeStorageAtomic(
    path,
    JSON.stringify({ ...data, formatVersion: SETTINGS_FORMAT_VERSION }, null, 2),
  );
}

/** 首次启动默认配置：内置 faux 测试 provider，开箱即可体验流式对话（真实 provider 在设置页添加） */
function defaultSettings(): Settings {
  const faux: ProviderConfig = {
    id: "faux-default",
    kind: "faux",
    name: "Faux 测试",
    modelId: "faux-default",
  };
  return { providers: [faux], activeProviderId: faux.id, thinkingLevel: DEFAULT_THINKING_LEVEL };
}

/** 设置文件读得到却解析不了：留下备份，用默认设置继续，并记下备份位置让界面告诉用户。 */
function recoverSettings(path: string): Settings {
  try {
    const recoveredFrom = backupCorruptFile(path);
    const settings = { ...defaultSettings(), recoveredFrom };
    writeSettings(path, settings);
    return settings;
  } catch {
    return { ...defaultSettings(), recoveryBlocked: path };
  }
}

export function loadSettings(dir: string): Settings {
  const path = join(dir, SETTINGS_FILE_NAME);
  let saved: Buffer | undefined;
  try {
    saved = readSettingsFile(path);
  } catch {
    return { ...defaultSettings(), recoveryBlocked: path };
  }
  if (!saved) return defaultSettings();
  let data: Settings | undefined;
  try {
    data = parseSettings(saved, path);
  } catch (error) {
    if (!(error instanceof NewerFormatError)) throw error;
    return { ...defaultSettings(), upgradeRequired: { path: error.path, version: error.version } };
  }
  if (!data) return recoverSettings(path);
  const thinkingLevels = enabledThinkingLevels(data.thinkingLevels);
  return {
    ...data,
    thinkingLevels,
    thinkingLevel: selectThinkingLevel(thinkingLevels, data.thinkingLevel),
    providers: data.providers.map((p) => {
      const models = getProviderModels(p);
      const selected = models.find(({ id }) => id === p.modelId);
      return { ...p, models, modelId: selected?.id ?? models[0]?.id ?? "" };
    }),
  };
}

export function saveSettings(dir: string, settings: Settings): void {
  const path = join(dir, SETTINGS_FILE_NAME);
  if (settings.upgradeRequired) {
    throw new NewerFormatError(settings.upgradeRequired.path, settings.upgradeRequired.version);
  }
  let existing: Buffer | undefined;
  try {
    existing = readSettingsFile(path);
  } catch {
    throw new Error(SETTINGS_SAVE_BLOCKED);
  }
  // 文件可能在本次读取设置后损坏或暂时失去访问权限。
  if (settings.recoveryBlocked || (existing && !parseSettings(existing, path))) {
    throw new Error(SETTINGS_SAVE_BLOCKED);
  }
  writeSettings(path, pruneMcpOAuth(settings));
}

export async function prepareSettingsInput(
  input: SettingsInput,
): Promise<(current: Settings) => Settings> {
  const providers = await Promise.all(
    input.providers.map(async ({ apiKey, ...provider }) => ({
      ...provider,
      apiKey: apiKey ? await encryptSecret(apiKey) : undefined,
    })),
  );
  // Read current settings at commit time so unrelated writes survive the encryption.
  return (current) => mergeSettingsInput(current, { ...input, providers });
}

function mergeSettingsInput(current: Settings, input: SettingsInput): Settings {
  const workingDirectory =
    input.workingDirectory === undefined
      ? current.workingDirectory
      : input.workingDirectory === null
        ? undefined
        : normalizeWorkingDirectory(input.workingDirectory);
  const merged: ProviderConfig[] = input.providers.map((p) => {
    const prev = current.providers.find((x) => x.id === p.id);
    const sameConnection = prev?.kind === p.kind && prev.baseUrl?.trim() === p.baseUrl?.trim();
    const preserved = sameConnection && prev ? getProviderModels(prev) : [];
    const models = normalizeModelCatalog(p.models ?? [...preserved, { id: p.modelId }]);
    const modelId = models.find(({ id }) => id === p.modelId.trim())?.id ?? models[0]?.id ?? "";
    return {
      id: p.id,
      kind: p.kind,
      name: p.name,
      baseUrl: p.baseUrl,
      modelId,
      models,
      apiKey: p.apiKey ?? (sameConnection ? prev?.apiKey : undefined),
    };
  });
  const thinkingLevels = enabledThinkingLevels(input.thinkingLevels ?? current.thinkingLevels);
  const auxiliaryModel =
    input.auxiliaryModel === undefined ? current.auxiliaryModel : input.auxiliaryModel;
  return {
    providers: merged,
    activeProviderId: input.activeProviderId,
    auxiliaryModel:
      auxiliaryModel && hasSavedModel(merged, auxiliaryModel) ? auxiliaryModel : undefined,
    toolRules: current.toolRules,
    approvalMode: input.approvalMode ?? current.approvalMode ?? "standard",
    thinkingLevels,
    thinkingLevel: selectThinkingLevel(
      thinkingLevels,
      input.thinkingLevel ?? current.thinkingLevel,
    ),
    workingDirectory,
    commandShell: input.commandShell ?? current.commandShell,
    externalEditor: current.externalEditor,
    logLevel: current.logLevel,
    notificationsEnabled: current.notificationsEnabled,
    autoDownloadUpdates: current.autoDownloadUpdates,
    // 人设传 "" 即清空（空串不是 nullish，不会被 ?? 吞掉）；技能启停整表提交
    persona: input.persona ?? current.persona ?? "",
    projectHooks: current.projectHooks,
    promptTemplates: current.promptTemplates,
    afterTurnVerification: current.afterTurnVerification,
    projectTrust: current.projectTrust,
    skillsEnabled: input.skillsEnabled ?? current.skillsEnabled ?? [],
    mcpServers: current.mcpServers,
    mcpOAuth: current.mcpOAuth,
    importedPlugins: current.importedPlugins,
    pluginMarketplaces: current.pluginMarketplaces,
    recoveredFrom: current.recoveredFrom,
    recoveryBlocked: current.recoveryBlocked,
    upgradeRequired: current.upgradeRequired,
  };
}

export function toPublicSettings(settings: Settings): PublicSettings {
  const thinkingLevels = enabledThinkingLevels(settings.thinkingLevels);
  const recoveryPath = settings.recoveryBlocked ?? settings.recoveredFrom;
  return {
    providers: settings.providers.map((p) => ({
      id: p.id,
      kind: p.kind,
      name: p.name,
      baseUrl: p.baseUrl,
      modelId: p.modelId,
      models: getProviderModels(p).map((entry) => ({
        ...entry,
        automatic: automaticModelCapabilities(p, entry),
      })),
      hasKey: Boolean(p.apiKey),
    })),
    activeProviderId: settings.activeProviderId,
    auxiliaryModel:
      settings.auxiliaryModel && hasSavedModel(settings.providers, settings.auxiliaryModel)
        ? settings.auxiliaryModel
        : null,
    toolRules: settings.toolRules,
    approvalMode: settings.approvalMode ?? "standard",
    thinkingLevels,
    thinkingLevel: selectThinkingLevel(thinkingLevels, settings.thinkingLevel),
    workingDirectory: settings.workingDirectory ?? null,
    commandShell: getCommandShell(settings.commandShell),
    externalEditor: settings.externalEditor ?? DEFAULT_EXTERNAL_EDITOR,
    logLevel: getLogLevel(settings),
    notificationsEnabled: settings.notificationsEnabled !== false,
    autoDownloadUpdates: settings.autoDownloadUpdates !== false,
    persona: settings.persona ?? "",
    projectHooks: settings.projectHooks,
    promptTemplates: settings.promptTemplates ?? [],
    pluginPromptTemplates: settings.importedPlugins?.flatMap(({ managed }) =>
      managed?.enabled ? managed.templates : [],
    ),
    skillsEnabled: settings.skillsEnabled ?? [],
    recovery: settings.upgradeRequired
      ? { status: "upgrade", ...settings.upgradeRequired }
      : recoveryPath
        ? { status: settings.recoveryBlocked ? "blocked" : "recovered", path: recoveryPath }
        : undefined,
  };
}

function enabledThinkingLevels(
  value: Settings["thinkingLevels"],
): PublicSettings["thinkingLevels"] {
  const selected = THINKING_LEVELS.filter((level) => Array.isArray(value) && value.includes(level));
  return selected.length ? selected : [...THINKING_LEVELS];
}

export function getLogLevel(settings: Settings): LogLevel {
  return LOG_LEVELS.find((level) => level === settings.logLevel) ?? DEFAULT_LOG_LEVEL;
}

/** 检查只有保存时或当前平台才能确定的设置条件。 */
export function validateSettingsInput(input: SettingsInput): string | undefined {
  if (
    input.commandShell !== undefined &&
    input.commandShell !== getCommandShell(input.commandShell)
  ) {
    return "不支持此命令环境。";
  }
  if (process.platform === "win32" && input.commandShell === "bash" && !findGitBash()) {
    return "找不到 Git Bash。请安装 Git for Windows，或切换到 PowerShell。";
  }
  for (const p of input.providers) {
    const models = normalizeModelCatalog(p.models);
    if (
      p.models !== undefined &&
      p.modelId.trim() &&
      !models.some(({ id }) => id === p.modelId.trim())
    ) {
      return "请从已保存的模型中选择。";
    }
    if (isOpenAiProvider(p.kind) && !p.baseUrl?.trim()) {
      return "OpenAI 端点必须提供 baseUrl";
    }
    if (
      p.kind === "openai-responses" &&
      models.some(
        ({ overrides }) =>
          (overrides?.contextWindow ?? OPENAI_RESPONSES_MIN_TOKENS) < OPENAI_RESPONSES_MIN_TOKENS ||
          (overrides?.maxTokens ?? OPENAI_RESPONSES_MIN_TOKENS) < OPENAI_RESPONSES_MIN_TOKENS,
      )
    )
      return "Responses API 的上下文长度和输出上限至少为 16。";
  }
  if (
    input.activeProviderId &&
    !input.providers.some((p) => p.id === input.activeProviderId && getProviderModels(p).length > 0)
  ) {
    return "当前提供方需要至少一个模型。";
  }
  if (
    input.auxiliaryModel &&
    !hasSavedModel(
      input.providers.map((provider) => ({ ...provider, models: getProviderModels(provider) })),
      input.auxiliaryModel,
    )
  ) {
    return "辅助模型已不可用。请重新选择。";
  }
  return undefined;
}
