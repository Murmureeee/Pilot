// @env node
import { constants, copyFileSync, existsSync } from "node:fs";
import { join, parse } from "node:path";

function timestamp(date: Date): string {
  const pad = (value: number): string => String(value).padStart(2, "0");
  return (
    `${date.getFullYear()}${pad(date.getMonth() + 1)}${pad(date.getDate())}` +
    `-${pad(date.getHours())}${pad(date.getMinutes())}${pad(date.getSeconds())}`
  );
}

/** 保留原文件，直到替换文件写入成功。 */
export function backupCorruptFile(path: string, now = new Date()): string {
  const { dir, name, ext } = parse(path);
  const base = join(dir, `${name}.corrupt-${timestamp(now)}`);
  let backup = base + ext;
  for (let copy = 2; existsSync(backup); copy++) backup = `${base}-${copy}${ext}`;
  copyFileSync(path, backup, constants.COPYFILE_EXCL);
  return backup;
}
