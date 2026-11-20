// @env browser
import { create } from "zustand";
import type { FileChangesStore } from "@renderer/lib/types";
import { fileChangeFolderPaths } from "../lib/file-changes";

export const useFileChangesStore = create<FileChangesStore>((set) => ({
  review: null,
  open: ({ sessionId, replyId, changeId, changePath, confirmUndo }) =>
    set(({ review }) => {
      const sameReply = review?.sessionId === sessionId && review.replyId === replyId;
      const expanded = sameReply ? review.expanded : [];
      const reveal = changePath ? fileChangeFolderPaths(changePath) : [];
      const collapsedFolders = sameReply
        ? review.collapsedFolders.filter((path) => !reveal.includes(path))
        : [];
      return {
        review: {
          sessionId,
          replyId,
          expanded: changeId && !expanded.includes(changeId) ? [...expanded, changeId] : expanded,
          collapsedFolders,
          selectedId: changeId,
          jump: { changeId },
          undoChangeId: confirmUndo && changeId ? changeId : null,
        },
      };
    }),
  close: () => set({ review: null }),
  setFolderOpen: (path, open) =>
    set((state) => {
      const { review } = state;
      if (!review || review.collapsedFolders.includes(path) === !open) return state;
      const collapsedFolders = open
        ? review.collapsedFolders.filter((folder) => folder !== path)
        : [...review.collapsedFolders, path];
      return { review: { ...review, collapsedFolders } };
    }),
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
          selectedId: id,
          undoChangeId: review.undoChangeId === id ? null : review.undoChangeId,
        },
      };
    }),
  collapseFiles: () =>
    set((state) =>
      state.review ? { review: { ...state.review, expanded: [], undoChangeId: null } } : state,
    ),
  confirmUndo: (id) =>
    set((state) => (state.review ? { review: { ...state.review, undoChangeId: id } } : state)),
  cancelUndo: (id) =>
    set((state) =>
      state.review?.undoChangeId === id
        ? { review: { ...state.review, undoChangeId: null } }
        : state,
    ),
}));
