// @env node
import type { Locale } from "../../shared/contract";
import type { NoticeKind } from "./types";

export const TASK_NOTICE_TITLES = {
  zh: { approval: "等待审批", success: "任务已完成", failed: "任务失败" },
  en: { approval: "Waiting for approval", success: "Task completed", failed: "Task failed" },
} satisfies Record<Locale, Record<NoticeKind, string>>;
