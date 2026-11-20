// @env browser
import { create } from "zustand";
import type { WorkspaceReferenceStore } from "@renderer/lib/types";

export const useWorkspaceReferenceStore = create<WorkspaceReferenceStore>((set) => ({
  reference: null,
  open: (reference) => set({ reference }),
  close: () => set({ reference: null }),
}));
