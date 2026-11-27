// @env node
import { randomUUID } from "node:crypto";
import { createReadStream, createWriteStream } from "node:fs";
import { mkdir, open, rename, rm } from "node:fs/promises";
import { dirname, join } from "node:path";
import { pipeline } from "node:stream/promises";
import { createGunzip, createGzip } from "node:zlib";

import type { BackupCredentials } from "../../shared/backup";
import { STORAGE_UPGRADE_REQUIRED } from "../constants";
import { SETTINGS_FILE_NAME } from "../constants";
import { formatVersion, parseStoredJson } from "../storage-format";
import {
  BACKUP_BYTES_LIMIT,
  BACKUP_CHUNK_BYTES,
  BACKUP_EXPORT_CHANGED,
  BACKUP_FILE_LIMIT,
  BACKUP_INVALID,
  BACKUP_READ_FAILED,
  BACKUP_TOO_LARGE,
  BACKUP_VERSION,
} from "./constants";
import { validArchivePath } from "./files";
import type { ArchiveEntry, BackupExportSettings } from "./types";

export async function writeArchive(
  directory: string,
  files: readonly ArchiveEntry[],
  target: string,
  recheck: () => void,
  settings?: BackupExportSettings,
): Promise<void> {
  const temporary = join(dirname(target), ".pilot-backup-" + randomUUID() + ".tmp");
  async function* records(): AsyncGenerator<string> {
    yield (
      JSON.stringify({
        type: "pilot-backup",
        formatVersion: BACKUP_VERSION,
        omitted: settings?.omitted,
      }) + "\n"
    );
    for (const { path, size: originalSize, mode } of files) {
      const contents = path === SETTINGS_FILE_NAME ? settings?.contents : undefined;
      const size = contents?.length ?? originalSize;
      yield JSON.stringify({ path, size, mode }) + "\n";
      if (contents) {
        for (let offset = 0; offset < size; offset += BACKUP_CHUNK_BYTES)
          yield contents.subarray(offset, offset + BACKUP_CHUNK_BYTES).toString("base64") + "\n";
        continue;
      }
      let remaining = size;
      const stream = createReadStream(join(directory, ...path.split("/")), {
        highWaterMark: BACKUP_CHUNK_BYTES,
      });
      for await (const chunk of stream) {
        remaining -= chunk.length;
        if (remaining < 0) throw new Error(BACKUP_EXPORT_CHANGED);
        yield Buffer.from(chunk).toString("base64") + "\n";
      }
      if (remaining !== 0) throw new Error(BACKUP_EXPORT_CHANGED);
    }
    yield "end\n";
  }
  try {
    await pipeline(
      records(),
      createGzip(),
      createWriteStream(temporary, { flags: "wx", mode: 0o600, flush: true }),
    );
    recheck();
    await rename(temporary, target);
  } finally {
    await rm(temporary, { force: true });
  }
}

async function* recordLines(input: AsyncIterable<Buffer>): AsyncGenerator<string> {
  let pending = Buffer.alloc(0);
  for await (const chunk of input) {
    const bytes = Buffer.concat([pending, chunk]);
    let start = 0;
    for (let end = bytes.indexOf(10); end >= 0; end = bytes.indexOf(10, start)) {
      if (end - start > BACKUP_CHUNK_BYTES * 2) throw new Error(BACKUP_INVALID);
      yield bytes.toString("utf8", start, end);
      start = end + 1;
    }
    pending = Buffer.from(bytes.subarray(start));
    if (pending.length > BACKUP_CHUNK_BYTES * 2) throw new Error(BACKUP_INVALID);
  }
  if (pending.length) throw new Error(BACKUP_INVALID);
}

function readEntry(line: string | undefined): ArchiveEntry {
  const data = parseStoredJson(line);
  if (
    data &&
    typeof data === "object" &&
    "path" in data &&
    typeof data.path === "string" &&
    validArchivePath(data.path) &&
    "size" in data &&
    typeof data.size === "number" &&
    Number.isSafeInteger(data.size) &&
    data.size >= 0 &&
    "mode" in data &&
    typeof data.mode === "number" &&
    Number.isInteger(data.mode) &&
    data.mode >= 0 &&
    data.mode <= 0o777
  )
    return { path: data.path, size: data.size, mode: data.mode };
  throw new Error(BACKUP_INVALID);
}

export async function unpackArchive(source: string, directory: string): Promise<BackupCredentials> {
  try {
    return await pipeline(createReadStream(source), createGunzip(), async (input) => {
      const lines = recordLines(input);
      const header = parseStoredJson((await lines.next()).value);
      if (
        !header ||
        typeof header !== "object" ||
        !("type" in header) ||
        header.type !== "pilot-backup" ||
        formatVersion(header, BACKUP_VERSION, source) !== BACKUP_VERSION
      )
        throw new Error(BACKUP_INVALID);
      const omitted = "omitted" in header ? header.omitted : { providers: 0, services: 0 };
      if (!validCredentialCounts(omitted)) throw new Error(BACKUP_INVALID);
      const files = new Set<string>();
      const directories = new Map<string, string>();
      let bytes = 0;
      for (;;) {
        const line = (await lines.next()).value;
        if (line === "end") break;
        const { path, size, mode } = readEntry(line);
        const key = path.toLowerCase();
        if (files.has(key)) throw new Error(BACKUP_INVALID);
        files.add(key);
        const parts = path.split("/");
        let parent = "";
        for (const part of parts.slice(0, -1)) {
          parent += (parent ? "/" : "") + part;
          const directoryKey = parent.toLowerCase();
          const existing = directories.get(directoryKey);
          if (existing !== undefined && existing !== parent) throw new Error(BACKUP_INVALID);
          directories.set(directoryKey, parent);
        }
        bytes += size;
        if (files.size > BACKUP_FILE_LIMIT || bytes > BACKUP_BYTES_LIMIT)
          throw new Error(BACKUP_TOO_LARGE);
        const target = join(directory, ...path.split("/"));
        await mkdir(dirname(target), { recursive: true, mode: 0o700 });
        await using file = await open(target, "wx", 0o600 | (mode & 0o100));
        let remaining = size;
        while (remaining > 0) {
          const encoded = (await lines.next()).value;
          if (typeof encoded !== "string") throw new Error(BACKUP_INVALID);
          const data = Buffer.from(encoded, "base64");
          if (
            !data.length ||
            data.length > BACKUP_CHUNK_BYTES ||
            data.length > remaining ||
            data.toString("base64") !== encoded
          )
            throw new Error(BACKUP_INVALID);
          await file.writeFile(data);
          remaining -= data.length;
        }
        await file.sync();
      }
      if (!(await lines.next()).done) throw new Error(BACKUP_INVALID);
      return omitted;
    });
  } catch (error) {
    if (
      error instanceof Error &&
      [STORAGE_UPGRADE_REQUIRED, BACKUP_TOO_LARGE].includes(error.message)
    )
      throw error;
    if (
      ["EACCES", "EPERM", "ENOSPC", "ENOENT"].includes((error as NodeJS.ErrnoException).code ?? "")
    )
      throw new Error(BACKUP_READ_FAILED, { cause: error });
    throw new Error(BACKUP_INVALID, { cause: error });
  }
}

export function validCredentialCounts(value: unknown): value is BackupCredentials {
  return (
    value !== null &&
    typeof value === "object" &&
    "providers" in value &&
    "services" in value &&
    [value.providers, value.services].every(
      (count) => typeof count === "number" && Number.isSafeInteger(count) && count >= 0,
    )
  );
}
