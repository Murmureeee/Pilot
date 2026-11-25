// @env browser
import { create } from "zustand";

import { REVIEW_TRIGGER_ID } from "@renderer/lib/constants";
import type { ReviewStore, ReviewTab } from "@renderer/lib/types";
import { selectWorkingDirectory, useAgentStore } from "@renderer/stores/agent";

export const useReviewStore = create<ReviewStore>((set) => ({
  composerId: null,
  open: false,
  tab: "changes",
  focusRequest: 0,
  trigger: null,
  show: (composerId, tab, trigger) =>
    set((state) => ({
      composerId,
      open: true,
      tab: tab ?? (state.composerId === composerId ? state.tab : "changes"),
      focusRequest: state.focusRequest + 1,
      trigger: trigger ?? (state.composerId === composerId && state.open ? state.trigger : null),
    })),
  selectTab: (tab) => set({ tab }),
  close: () => set({ open: false, trigger: null }),
}));

export function closeReview(): void {
  const { trigger, composerId, close } = useReviewStore.getState();
  close();
  requestAnimationFrame(() => {
    if (useReviewStore.getState().open || useAgentStore.getState().composerId !== composerId)
      return;
    if (trigger?.isConnected && !trigger.closest("[inert]")) trigger.focus({ preventScroll: true });
    if (document.activeElement !== trigger)
      document.getElementById(REVIEW_TRIGGER_ID)?.focus({ preventScroll: true });
  });
}

export function activateReview(tab?: ReviewTab, trigger?: HTMLElement): void {
  const agent = useAgentStore.getState();
  const review = useReviewStore.getState();
  if (
    !agent.composerId ||
    agent.view !== "chat" ||
    !(selectWorkingDirectory(agent) || agent.sessionId)
  )
    return;
  const open = review.open && review.composerId === agent.composerId;
  if (open && (!tab || (tab === "changes" && review.tab === tab))) closeReview();
  else review.show(agent.composerId, tab, trigger);
}
