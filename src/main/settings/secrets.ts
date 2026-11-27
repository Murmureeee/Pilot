// @env node
import { safeStorage } from "electron";

import { SECRET_READ_UNAVAILABLE, SECRET_SAVE_UNAVAILABLE } from "./constants";

function hasSystemEncryption(): boolean {
  return (
    safeStorage.isEncryptionAvailable() &&
    (process.platform !== "linux" || safeStorage.getSelectedStorageBackend() !== "basic_text")
  );
}

export async function encryptSecret(
  plain: string,
  requireSystemEncryption = false,
): Promise<string> {
  if (!plain) return "";
  try {
    if (process.platform === "win32") {
      if (await safeStorage.isAsyncEncryptionAvailable())
        return (await safeStorage.encryptStringAsync(plain)).toString("base64");
    } else if (
      requireSystemEncryption ? hasSystemEncryption() : safeStorage.isEncryptionAvailable()
    ) {
      // Linux's async encryptor can fall back to a non-keyring provider.
      return safeStorage.encryptString(plain).toString("base64");
    }
  } catch {
    // Keep platform key service errors out of settings responses.
  }
  throw new Error(SECRET_SAVE_UNAVAILABLE);
}

export function decryptSecret(
  stored: string | undefined,
  requireSystemEncryption = false,
): string | undefined {
  if (!stored) return undefined;
  if (requireSystemEncryption && !hasSystemEncryption()) return undefined;
  if (!safeStorage.isEncryptionAvailable()) return undefined;
  try {
    return safeStorage.decryptString(Buffer.from(stored, "base64"));
  } catch {
    console.error("[settings] 无法解密保存的凭据，视为未配置");
    return undefined;
  }
}

export async function decryptProviderKey(stored: string | undefined): Promise<string | undefined> {
  if (!stored) return undefined;
  if (process.platform !== "win32") return decryptSecret(stored);
  const cipher = Buffer.from(stored, "base64");
  if (cipher.toString("base64") !== stored || cipher.subarray(0, 3).toString() !== "v10")
    return undefined;
  if (!(await safeStorage.isAsyncEncryptionAvailable().catch(() => false)))
    throw new Error(SECRET_READ_UNAVAILABLE);
  try {
    return (await safeStorage.decryptStringAsync(cipher)).result;
  } catch (error) {
    if (error instanceof Error && error.message.includes("temporarily unavailable"))
      throw new Error(SECRET_READ_UNAVAILABLE, { cause: error });
    return undefined;
  }
}
