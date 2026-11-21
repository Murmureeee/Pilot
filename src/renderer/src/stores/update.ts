// @env browser
import { create } from "zustand";
import type { UpdateStore } from "@renderer/lib/types";
import type { UpdateStatus } from "@shared/contract";

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
    const { status } = get();
    if (status?.state !== "ready") return;
    const installing: UpdateStatus = { state: "installing", version: status.version };
    set({ status: installing, actionFailed: false });
    try {
      await window.pi.installUpdate();
    } catch {
      if (get().status === installing) {
        set({ status, actionFailed: true, dialog: get().dialog ?? "update" });
      }
    }
  },
}));
