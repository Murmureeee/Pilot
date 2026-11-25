// @env browser
import {
  REVIEW_CARD_INSET,
  REVIEW_CHAT_MIN_WIDTH,
  REVIEW_MIN_WIDTH,
  REVIEW_THREE_COLUMN_WIDTH,
  REVIEW_TWO_COLUMN_WIDTH,
} from "./constants";
import type { ReviewResizeRange } from "./types";

export function reviewLayout(
  windowWidth: number,
  sidebarWidth: number,
  sidebarCollapsed: boolean,
  reviewOpen: boolean,
  preferredReviewWidth: number | null,
): { sidebarWidth: number; reviewWidth: number; overlay: boolean; range: ReviewResizeRange } {
  const available = windowWidth - REVIEW_CARD_INSET;
  const overlay = windowWidth < REVIEW_TWO_COLUMN_WIDTH;
  const sideBySide = reviewOpen && windowWidth >= REVIEW_THREE_COLUMN_WIDTH && !sidebarCollapsed;
  const sidebar = sideBySide
    ? Math.min(sidebarWidth, available - REVIEW_MIN_WIDTH - REVIEW_CHAT_MIN_WIDTH)
    : sidebarWidth;
  const remaining = sideBySide ? available - sidebar : available;
  const range = {
    min: REVIEW_MIN_WIDTH,
    max: Math.max(REVIEW_MIN_WIDTH, remaining - REVIEW_CHAT_MIN_WIDTH),
  };
  return {
    sidebarWidth: sidebar,
    overlay,
    reviewWidth: Math.max(
      range.min,
      Math.min(range.max, preferredReviewWidth ?? Math.round(remaining / 2)),
    ),
    range,
  };
}
