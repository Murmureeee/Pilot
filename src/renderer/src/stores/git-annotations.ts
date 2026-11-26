// @env browser
import { create } from "zustand";

import type { GitAnnotation, GitAnnotationStore } from "@renderer/lib/types";

const EMPTY_ANNOTATIONS: GitAnnotation[] = [];

export const useGitAnnotationStore = create<GitAnnotationStore>((set) => ({
  drafts: {},
  save(scope, annotation) {
    set(({ drafts }) => {
      const notes = drafts[scope] ?? [];
      return {
        drafts: {
          ...drafts,
          [scope]: notes.some(({ id }) => id === annotation.id)
            ? notes.map((note) => (note.id === annotation.id ? annotation : note))
            : [...notes, annotation],
        },
      };
    });
  },
  remove(scope, ids) {
    set(({ drafts }) => {
      const current = drafts[scope];
      if (!current) return { drafts };
      const retained = current.filter(({ id }) => !ids.includes(id));
      if (retained.length) return { drafts: { ...drafts, [scope]: retained } };
      const remaining = { ...drafts };
      delete remaining[scope];
      return { drafts: remaining };
    });
  },
}));

export function gitAnnotations(
  scope: string,
  drafts: GitAnnotationStore["drafts"],
): GitAnnotation[] {
  return drafts[scope] ?? EMPTY_ANNOTATIONS;
}
