// @env browser
// 思考强度滑块的档位映射与 pi 的 ThinkingLevel 一一对应。
import type { ThinkingLevel } from "@shared/contract";

import { THINKING_LEVELS } from "../../../shared/constants";

export const THINKING_LABELS: Record<ThinkingLevel, string> = {
  off: "关闭",
  minimal: "极简",
  low: "低",
  medium: "中",
  high: "高",
  xhigh: "超高",
  max: "最高",
};

export function levelLabel(level: ThinkingLevel): string {
  return THINKING_LABELS[level];
}

export function levelIndex(level: ThinkingLevel): number {
  return THINKING_LEVELS.indexOf(level);
}

export function levelAt(index: number): ThinkingLevel {
  return THINKING_LEVELS[Math.min(THINKING_LEVELS.length - 1, Math.max(0, index))];
}
