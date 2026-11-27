// @env browser
import type { ScheduledTaskInput, ScheduledTaskRun } from "@shared/scheduled-tasks";

export const FREQUENCY_LABELS: Record<ScheduledTaskInput["frequency"], string> = {
  once: "一次性",
  daily: "每天",
  weekly: "每周",
};

export const RUN_LABELS: Record<ScheduledTaskRun["status"], string> = {
  running: "运行中",
  success: "已完成",
  failed: "失败",
  interrupted: "已中断",
  missed: "已错过",
};

export const TRIGGER_LABELS: Record<ScheduledTaskRun["trigger"], string> = {
  schedule: "定时执行",
  manual: "手动执行",
  retry: "重跑",
};
