// @env all
import type { Snapshot } from "./contract";

export interface UsageBreakdown {
  key: string;
  label: string | null;
  description?: string;
  usage: Snapshot["usage"];
}

export interface UsageReport {
  total: Snapshot["usage"];
  days: UsageBreakdown[];
  projects: UsageBreakdown[];
  models: UsageBreakdown[];
  unreadableSessions: number;
}
