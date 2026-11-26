// @env node
import { safeStorage } from "electron";

function hasSystemEncryption(): boolean {
  return (
    safeStorage.isEncryptionAvailable() &&
    (process.platform !== "linux" || safeStorage.getSelectedStorageBackend() !== "basic_text")
  );
}

export function encryptSecret(plain: string, requireSystemEncryption = false): string {
  if (!plain) return "";
  if (!(requireSystemEncryption ? hasSystemEncryption() : safeStorage.isEncryptionAvailable())) {
    throw new Error("系统密钥服务不可用，无法保存密钥。");
  }
  return safeStorage.encryptString(plain).toString("base64");
}

export function decryptSecret(
  stored: string | undefined,
  requireSystemEncryption = false,
): string | undefined {
  if (!stored) return undefined;
  if (requireSystemEncryption && !hasSystemEncryption()) return undefined;
  // Older development profiles could hold plaintext when system encryption was unavailable.
  if (!safeStorage.isEncryptionAvailable()) return stored;
  try {
    return safeStorage.decryptString(Buffer.from(stored, "base64"));
  } catch {
    console.error("[settings] 无法解密保存的凭据，视为未配置");
    return undefined;
  }
}
