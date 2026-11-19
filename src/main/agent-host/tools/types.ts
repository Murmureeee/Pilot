// @env node
import type { CommandShell } from "@shared/contract";

export type ResolveToolPath = (path: string) => string;

export interface ToolEnvironment {
  workingDirectory?: string;
  commandShell: CommandShell;
}
