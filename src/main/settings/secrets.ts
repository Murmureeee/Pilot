// @env node
import { safeStorage } from "electron";

export function encryptSecret(plain: string): string {
  if (!plain) return "";
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error("系统密钥服务不可用，无法保存密钥。");
  }
  return safeStorage.encryptString(plain).toString("base64");
}

export function decryptSecret(stored: string | undefined): string | undefined {
  if (!stored) return undefined;
  // Older development profiles could hold plaintext when system encryption was unavailable.
  if (!safeStorage.isEncryptionAvailable()) return stored;
  try {
    return safeStorage.decryptString(Buffer.from(stored, "base64"));
  } catch {
    console.error("[settings] 无法解密保存的凭据，视为未配置");
    return undefined;
  }
}
