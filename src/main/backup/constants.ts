// @env node
import type { Locale } from "../../shared/contract";
import { SETTINGS_FILE_NAME } from "../constants";

export const BACKUP_EXTENSION = "pilot-backup";
export const BACKUP_VERSION = 1;
export const BACKUP_ROOTS = [
  SETTINGS_FILE_NAME,
  "sessions",
  "skills",
  "imported-plugins",
  "imported-plugin-data",
] as const;
export const RESTORE_DIRECTORY = ".pilot-restore";
export const RESTORE_STATE = "state.json";
export const BACKUP_CHUNK_BYTES = 48 * 1024;
export const BACKUP_FILE_LIMIT = 200_000;
export const BACKUP_BYTES_LIMIT = 64 * 1024 ** 3;
export const BACKUP_INVALID = "无法读取此备份包。请选择有效的 Pilot 备份。";
export const BACKUP_UNSUPPORTED_PATH = "备份范围内含有链接或不兼容的文件名。请检查相关目录后重试。";
export const BACKUP_TOO_LARGE = "备份超过 64 GiB 或 200000 个文件。请缩小数据目录后重试。";
export const BACKUP_CHANGED = "本机数据已变化。请重新预览后再恢复。";
export const BACKUP_EXPORT_CHANGED = "备份期间数据发生变化。请重试导出。";
export const BACKUP_EXPORT_PATH = "请选择备份数据目录以外的位置保存备份包。";
export const BACKUP_BUSY = "请先结束正在运行的任务、验证或终端进程，再恢复备份。";
export const BACKUP_IN_PROGRESS = "已有备份操作正在进行。请稍候重试。";
export const BACKUP_RETRY_PREVIEW = "此备份预览已失效。请重新选择备份包。";
export const BACKUP_EXPORT_FAILED = "无法导出备份。请确认数据可读取，并选择有足够空间的保存位置。";
export const BACKUP_READ_FAILED = "无法读取或暂存备份。请检查文件权限和数据目录剩余空间。";
export const BACKUP_RESTART_FAILED = "无法安排恢复。请检查数据目录的访问权限后重试。";

export const BACKUP_COPY = {
  zh: {
    export: "导出 Pilot 数据备份",
    open: "选择 Pilot 备份包",
    failed: "无法恢复备份",
    blocked: "暂时无法还原本机数据。请恢复以下目录的访问权限后重启 Pilot。",
    close: "关闭",
  },
  "zh-TW": {
    export: "匯出 Pilot 資料備份",
    open: "選擇 Pilot 備份檔",
    failed: "無法從備份還原",
    blocked: "暫時無法還原本機資料。請恢復以下目錄的存取權限後重新啟動 Pilot。",
    close: "關閉",
  },
  en: {
    export: "Export Pilot data backup",
    open: "Choose a Pilot backup",
    failed: "Could not restore the backup",
    blocked:
      "Could not roll back your local data. Restore access to this folder and restart Pilot.",
    close: "Close",
  },
} as const satisfies Record<Locale, Record<string, string>>;
