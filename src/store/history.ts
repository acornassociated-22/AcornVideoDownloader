import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { HistoryItem } from "../types";

interface HistoryState {
  items: HistoryItem[];
  add: (item: HistoryItem) => void;
  remove: (id: string) => void;
  clear: () => void;
}

export const useHistoryStore = create<HistoryState>()(
  persist(
    (set) => ({
      items: [],
      add: (item) =>
        set((state) => ({
          items: [item, ...state.items.filter((h) => h.id !== item.id)].slice(
            0,
            200,
          ),
        })),
      remove: (id) =>
        set((state) => ({ items: state.items.filter((h) => h.id !== id) })),
      clear: () => set({ items: [] }),
    }),
    { name: "acorn-history" },
  ),
);
