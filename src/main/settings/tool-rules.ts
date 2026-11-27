// @env node
import type { ToolRule } from "@shared/contract";

export function sameToolRule(a: ToolRule, b: ToolRule): boolean {
  if (a.toolName !== b.toolName || a.pathPrefix !== b.pathPrefix || a.domain !== b.domain)
    return false;
  const { commandPrefix: first } = a;
  const { commandPrefix: second } = b;
  if (!first || !second) return first === second;
  return (
    first.shell === second.shell &&
    first.wslDistribution?.toLowerCase() === second.wslDistribution?.toLowerCase() &&
    first.args.length === second.args.length &&
    first.args.every((arg, index) => arg === second.args[index])
  );
}
