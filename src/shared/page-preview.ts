// @env all
import type { ImageAttachment } from "./contract";

export const PREVIEW_PARTITION = "pilot-page-preview";

export interface PagePreviewReport {
  address: string;
  errors: string[];
  screenshot?: ImageAttachment;
}

export function localPreviewUrl(input: string): URL | null {
  if (!/^https?:\/\//i.test(input.trim())) return null;
  try {
    const url = new URL(input);
    if (!["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) || url.username || url.password)
      return null;
    return url;
  } catch {
    return null;
  }
}

export function previewRequestAllowed(origin: string, address: string): boolean {
  const httpAddress = address.replace(/^ws(s?):\/\//, "http$1://");
  return localPreviewUrl(httpAddress)?.origin === origin;
}
