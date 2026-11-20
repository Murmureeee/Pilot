// @env node
// 设置存储：providers + API Key（safeStorage 加密）。密钥明文只存在于内存，永不落明文、永不出主进程。
import { readFileSync, renameSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { safeStorage } from "electron";
import type { PublicSettings, ProviderConfig, Settings, SettingsInput } from "@shared/contract";
import { isOpenAiProvider } from "../../shared/providers";
import { findGitBash, getCommandShell } from "./tools/bash";
import { normalizeWorkingDirectory } from "./tools/paths";

function readJson<T>(path: string): T | undefined {
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as T;
  } catch {
    return undefined;
  }
}

function writeJsonAtomic(path: string, value: unknown): void {
  // NFR-4：临时文件 + rename 原子写，崩溃不丢已确认数据
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2), "utf-8");
  renameSync(tmp, path);
}

export function encryptSecret(plain: string, requireEncryption = false): string {
  if (!plain) return "";
  if (!safeStorage.isEncryptionAvailable()) {
    if (requireEncryption) throw new Error("系统密钥服务不可用，无法保存环境变量。");
    console.warn("[settings] safeStorage 不可用，API key 将以明文存储（开发环境）");
    return plain;
  }
  return safeStorage.encryptString(plain).toString("base64");
}

export function decryptSecret(stored: string | undefined): string | undefined {
  if (!stored) return undefined;
  if (!safeStorage.isEncryptionAvailable()) return stored;
  try {
    return safeStorage.decryptString(Buffer.from(stored, "base64"));
  } catch {
    console.error("[settings] API key 解密失败（系统用户变更或数据损坏），视为未配置");
    return undefined;
  }
}

/** 首次启动默认配置：内置 faux 测试 provider，开箱即可体验流式对话（真实 provider 在设置页添加） */
function defaultSettings(): Settings {
  const faux: ProviderConfig = {
    id: "faux-default",
    kind: "faux",
    name: "Faux 测试",
    modelId: "faux-default",
  };
  return { providers: [faux], activeProviderId: faux.id, thinkingLevel: "medium" };
}

export function loadSettings(dir: string): Settings {
  const data = readJson<Settings>(join(dir, "settings.json"));
  if (!data || !Array.isArray(data.providers)) {
    return defaultSettings();
  }
  return data;
}

export function saveSettings(dir: string, settings: Settings): void {
  writeJsonAtomic(join(dir, "settings.json"), settings);
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
    return {
      id: p.id,
      kind: p.kind,
      name: p.name,
      baseUrl: p.baseUrl,
      modelId: p.modelId,
      apiKey: p.apiKey
        ? encryptSecret(p.apiKey)
        : prev?.kind === p.kind && prev.baseUrl === p.baseUrl
          ? prev.apiKey
          : undefined,
    };
  });
  return {
    providers: merged,
    activeProviderId: input.activeProviderId,
    // 渲染层可整表提交 toolRules（设置页撤销授权）；缺省 = 保持不变
    toolRules: input.toolRules ?? current.toolRules,
    approvalMode: input.approvalMode ?? current.approvalMode ?? "standard",
    thinkingLevel: input.thinkingLevel ?? current.thinkingLevel ?? "medium",
    workingDirectory,
    commandShell: input.commandShell ?? current.commandShell,
    // 人设传 "" 即清空（空串不是 nullish，不会被 ?? 吞掉）；技能启停整表提交
    persona: input.persona ?? current.persona ?? "",
    skillsEnabled: input.skillsEnabled ?? current.skillsEnabled ?? [],
    mcpServers: current.mcpServers,
    importedPlugins: current.importedPlugins,
  };
}

export function toPublicSettings(settings: Settings): PublicSettings {
  return {
    providers: settings.providers.map((p) => ({
      id: p.id,
      kind: p.kind,
      name: p.name,
      baseUrl: p.baseUrl,
      modelId: p.modelId,
      hasKey: Boolean(p.apiKey),
    })),
    activeProviderId: settings.activeProviderId,
    toolRules: settings.toolRules,
    approvalMode: settings.approvalMode ?? "standard",
    thinkingLevel: settings.thinkingLevel ?? "medium",
    workingDirectory: settings.workingDirectory ?? null,
    commandShell: getCommandShell(settings.commandShell),
    persona: settings.persona ?? "",
    skillsEnabled: settings.skillsEnabled ?? [],
  };
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
    if (!p.modelId) return "provider 缺少 id/kind/modelId";
    if (isOpenAiProvider(p.kind) && !p.baseUrl?.trim()) {
      return "OpenAI 端点必须提供 baseUrl";
    }
  }
  return undefined;
}
