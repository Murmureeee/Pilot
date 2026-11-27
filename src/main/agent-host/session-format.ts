// @env node
import { SESSION_FORMAT_VERSION, TRANSCRIPT_FORMAT_HEADER } from "../constants";
import { formatVersion, parseStoredJson, readFilePrefix } from "../storage-format";

export const transcriptHeader =
  JSON.stringify({ type: TRANSCRIPT_FORMAT_HEADER, formatVersion: SESSION_FORMAT_VERSION }) + "\n";

export function transcriptPrefix(path: string): string {
  return readFilePrefix(path, 512) ?? "";
}

export function headerVersion(text: string, path: string): number {
  const end = text.indexOf("\n");
  const line = end === -1 ? text : text.slice(0, end);
  const value = parseStoredJson(line.trim());
  const isHeader =
    value &&
    typeof value === "object" &&
    "type" in value &&
    value.type === TRANSCRIPT_FORMAT_HEADER;
  if (!isHeader && !/^\s*\{\s*"type"\s*:\s*"pilot_transcript"/.test(line)) return 0;
  const version = formatVersion(value, SESSION_FORMAT_VERSION, path);
  if (!version || end === -1) throw new Error("聊天记录的格式头损坏。请还原文件后重试。");
  return version;
}

export function sessionEntries(raw: unknown, path: string): unknown {
  const version = formatVersion(raw, SESSION_FORMAT_VERSION, path);
  if (version === 0) return raw;
  if (version === SESSION_FORMAT_VERSION && raw && typeof raw === "object" && "entries" in raw)
    return raw.entries;
}
