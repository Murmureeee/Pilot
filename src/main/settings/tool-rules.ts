// @env node
import type { ToolRule } from "@shared/contract";

export function sameToolRule(a: ToolRule, b: ToolRule): boolean {
  if (a.toolName !== b.toolName || a.pathPrefix !== b.pathPrefix) return false;
  const { commandPrefix: first } = a;
  const { commandPrefix: second } = b;
  if (!first || !second) return first === second;
  return (
    first.shell === second.shell &&
    first.args.length === second.args.length &&
    first.args.every((arg, index) => arg === second.args[index])
  );
}
