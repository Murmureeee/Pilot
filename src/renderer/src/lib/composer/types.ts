// @env browser
import type { ComposerTrigger } from "../types";

export interface ComposerSelection {
  element: HTMLDivElement;
  caret: Range;
  trigger: (ComposerTrigger & { range: Range }) | null;
}
