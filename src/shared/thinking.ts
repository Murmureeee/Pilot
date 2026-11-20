// @env all
import { DEFAULT_THINKING_LEVEL } from "./constants";
import type { ThinkingLevel } from "./contract";

export function selectThinkingLevel(
  levels: readonly ThinkingLevel[],
  preferred: ThinkingLevel = DEFAULT_THINKING_LEVEL,
): ThinkingLevel {
  if (levels.includes(preferred)) return preferred;
  return levels.includes(DEFAULT_THINKING_LEVEL)
    ? DEFAULT_THINKING_LEVEL
    : (levels[0] ?? DEFAULT_THINKING_LEVEL);
}
