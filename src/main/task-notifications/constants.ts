// @env node
import type { Locale } from "../../shared/contract";
import type { NoticeKind } from "./types";

export const TASK_NOTICE_TITLES = {
  zh: { approval: "等待审批", plan: "等待确认计划", success: "任务已完成", failed: "任务失败" },
  "zh-TW": {
    approval: "等待核准",
    plan: "等待確認計畫",
    success: "工作已完成",
    failed: "工作失敗",
  },
  en: {
    approval: "Waiting for approval",
    plan: "Plan awaiting confirmation",
    success: "Task completed",
    failed: "Task failed",
  },
} satisfies Record<Locale, Record<NoticeKind, string>>;
