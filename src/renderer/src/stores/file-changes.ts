// @env browser
import { create } from "zustand";
import type { FileChangesStore } from "@renderer/lib/types";

export const useFileChangesStore = create<FileChangesStore>((set) => ({
  review: null,
  open: ({ sessionId, replyId, changeId, confirmUndo }) =>
    set(({ review }) => {
      const sameReply = review?.sessionId === sessionId && review.replyId === replyId;
      const expanded = sameReply ? review.expanded : [];
      return {
        review: {
          sessionId,
          replyId,
          expanded: changeId && !expanded.includes(changeId) ? [...expanded, changeId] : expanded,
          jump: { changeId },
          undoChangeId: confirmUndo && changeId ? changeId : null,
        },
      };
    }),
  close: () => set({ review: null }),
  toggleFile: (id) =>
    set((state) => {
      const { review } = state;
      if (!review) return state;
      const expanded = review.expanded.includes(id)
        ? review.expanded.filter((item) => item !== id)
        : [...review.expanded, id];
      return {
        review: {
          ...review,
          expanded,
          undoChangeId: review.undoChangeId === id ? null : review.undoChangeId,
        },
      };
    }),
  confirmUndo: (id) =>
    set((state) => (state.review ? { review: { ...state.review, undoChangeId: id } } : state)),
  cancelUndo: (id) =>
    set((state) =>
      state.review?.undoChangeId === id
        ? { review: { ...state.review, undoChangeId: null } }
        : state,
    ),
}));
