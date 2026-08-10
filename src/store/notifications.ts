import { create } from "zustand";

export type ToastKind = "success" | "error";

export type ToastItem = {
  id: string;
  kind: ToastKind;
  createdAt: number;
};

interface NotificationsState {
  toasts: ToastItem[];
  push: (kind: ToastKind) => string;
  pushSuccess: () => string;
  pushError: () => string;
  dismiss: (id: string) => void;
  clear: () => void;
}

const MAX_TOASTS = 5;

/** Create a short unique toast id. */
function makeId() {
  return `toast-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Ephemeral download result notifications (success / error popups). */
export const useNotificationsStore = create<NotificationsState>((set, get) => ({
  toasts: [],
  push: (kind) => {
    const id = makeId();
    set((state) => ({
      toasts: [{ id, kind, createdAt: Date.now() }, ...state.toasts].slice(
        0,
        MAX_TOASTS,
      ),
    }));
    return id;
  },
  pushSuccess: () => get().push("success"),
  pushError: () => get().push("error"),
  dismiss: (id) =>
    set((state) => ({
      toasts: state.toasts.filter((toast) => toast.id !== id),
    })),
  clear: () => set({ toasts: [] }),
}));
