// @env browser
import { create } from "zustand";

import type { UpdateStore } from "@renderer/lib/types";

export const useUpdateStore = create<UpdateStore>((set, get) => ({
  status: null,
  actionFailed: false,
  dialog: null,
  setDialog: (dialog) => set({ dialog }),

  subscribe: () => {
    let awaitingSnapshot = true;
    const beforeSubscription = get().status;
    const unsubscribe = window.pi.onUpdateStatus((status) => {
      awaitingSnapshot = false;
      const { status: previous, dialog } = get();
      set({
        status,
        actionFailed: false,
        dialog:
          status.state === "error" && previous?.state === "installing"
            ? (dialog ?? "update")
            : dialog,
      });
    });
    void window.pi.getUpdateStatus().then(
      (status) => {
        if (awaitingSnapshot && get().status === beforeSubscription) set({ status });
      },
      () => {
        if (awaitingSnapshot && !get().status) set({ actionFailed: true });
      },
    );
    return () => {
      awaitingSnapshot = false;
      unsubscribe();
    };
  },

  check: async () => {
    const previous = get().status;
    set({ actionFailed: false });
    try {
      const status = await window.pi.checkForUpdates();
      if (get().status === previous) set({ status });
    } catch {
      set({ actionFailed: true });
    }
  },

  install: async () => {
    if (get().status?.state !== "ready") return;
    set({ actionFailed: false });
    try {
      await window.pi.installUpdate();
    } catch {
      set({ actionFailed: true, dialog: get().dialog ?? "update" });
    }
  },
}));
