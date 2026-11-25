// @env node
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { LogLevel, PublicSettings, SettingsInput } from "@shared/contract";

import {
  DEFAULT_LOG_LEVEL,
  DEFAULT_THINKING_LEVEL,
  LOG_LEVELS,
  OPENAI_RESPONSES_MIN_TOKENS,
  THINKING_LEVELS,
} from "../../shared/constants";
import { isOpenAiProvider } from "../../shared/providers";
import { selectThinkingLevel } from "../../shared/thinking";
import { automaticModelCapabilities } from "../agent-host/model-capabilities";
import { SETTINGS_FILE_NAME, SETTINGS_SAVE_BLOCKED } from "../constants";
import { backupCorruptFile } from "../corrupt-file";
import { normalizeWorkingDirectory } from "../workspace/paths";
import { findGitBash, getCommandShell } from "../workspace/shell";
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

function writeJsonAtomic(path: string, value: unknown): void {
  // NFR-4：临时文件 + rename 原子写，崩溃不丢已确认数据
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2), { encoding: "utf8", flush: true });
  renameSync(tmp, path);
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
    writeJsonAtomic(path, settings);
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
  const data = parseSettings(saved);
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
  let existing: Buffer | undefined;
  try {
    existing = readSettingsFile(path);
  } catch {
    throw new Error(SETTINGS_SAVE_BLOCKED);
  }
  // 文件可能在本次读取设置后损坏或暂时失去访问权限。
  if (settings.recoveryBlocked || (existing && !parseSettings(existing))) {
    throw new Error(SETTINGS_SAVE_BLOCKED);
  }
  writeJsonAtomic(path, settings);
}

/** 渲染层提交 → 存储形态：新 key 加密，未变更的 key 保留原密文 */
export function mergeSettingsInput(current: Settings, input: SettingsInput): Settings {
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
      apiKey: p.apiKey ? encryptSecret(p.apiKey) : sameConnection ? prev?.apiKey : undefined,
    };
  });
  const thinkingLevels = enabledThinkingLevels(input.thinkingLevels ?? current.thinkingLevels);
  return {
    providers: merged,
    activeProviderId: input.activeProviderId,
    toolRules: current.toolRules,
    approvalMode: input.approvalMode ?? current.approvalMode ?? "standard",
    thinkingLevels,
    thinkingLevel: selectThinkingLevel(
      thinkingLevels,
      input.thinkingLevel ?? current.thinkingLevel,
    ),
    workingDirectory,
    commandShell: input.commandShell ?? current.commandShell,
    logLevel: current.logLevel,
    notificationsEnabled: current.notificationsEnabled,
    // 人设传 "" 即清空（空串不是 nullish，不会被 ?? 吞掉）；技能启停整表提交
    persona: input.persona ?? current.persona ?? "",
    promptTemplates: current.promptTemplates,
    skillsEnabled: input.skillsEnabled ?? current.skillsEnabled ?? [],
    mcpServers: current.mcpServers,
    importedPlugins: current.importedPlugins,
    recoveredFrom: current.recoveredFrom,
    recoveryBlocked: current.recoveryBlocked,
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
    toolRules: settings.toolRules,
    approvalMode: settings.approvalMode ?? "standard",
    thinkingLevels,
    thinkingLevel: selectThinkingLevel(thinkingLevels, settings.thinkingLevel),
    workingDirectory: settings.workingDirectory ?? null,
    commandShell: getCommandShell(settings.commandShell),
    logLevel: getLogLevel(settings),
    notificationsEnabled: settings.notificationsEnabled !== false,
    persona: settings.persona ?? "",
    promptTemplates: settings.promptTemplates ?? [],
    skillsEnabled: settings.skillsEnabled ?? [],
    recovery: recoveryPath
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
  return undefined;
}
