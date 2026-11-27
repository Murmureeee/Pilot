// @env node
import type { WebContents } from "electron";

export interface PagePreviewGuest {
  contents: WebContents;
  origin: string;
  errors: string[];
}
