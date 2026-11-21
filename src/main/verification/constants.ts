// @env node
import type { VerificationKind } from "@shared/contract";

export const VERIFICATION_OUTPUT_LIMIT = 128 * 1024;
export const VERIFICATION_UPDATE_INTERVAL_MS = 100;
export const VERIFICATION_SCRIPTS: Record<VerificationKind, string[]> = {
  test: ["test"],
  typecheck: ["typecheck", "type-check", "check:types"],
  build: ["build"],
};
export const PACKAGE_MANAGER_LOCKS = [
  ["pnpm", ["pnpm-lock.yaml"]],
  ["yarn", ["yarn.lock"]],
  ["bun", ["bun.lock", "bun.lockb"]],
  ["npm", ["package-lock.json", "npm-shrinkwrap.json"]],
] as const;
