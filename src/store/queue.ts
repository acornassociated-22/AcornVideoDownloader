import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { DownloadProgress, DownloadPhase, QueueItem } from "../types";
import { normalizeQueueError } from "../lib/errors";

interface QueueState {
  items: QueueItem[];
  activeId: string | null;
  orchestratorPaused: boolean;
  addItems: (items: QueueItem[]) => void;
  updateItem: (id: string, patch: Partial<QueueItem>) => void;
  removeItem: (id: string) => void;
  clearFinished: () => void;
  clearAll: () => void;
  applyProgress: (progress: DownloadProgress) => void;
  setActiveId: (id: string | null) => void;
  setOrchestratorPaused: (paused: boolean) => void;
  nextQueued: () => QueueItem | undefined;
}

export const useQueueStore = create<QueueState>()(
  persist(
    (set, get) => ({
      items: [],
      activeId: null,
      orchestratorPaused: false,
      addItems: (items) =>
        set((state) => ({ items: [...state.items, ...items] })),
      updateItem: (id, patch) =>
        set((state) => ({
          items: state.items.map((item) =>
            item.id === id ? { ...item, ...patch } : item,
          ),
        })),
      removeItem: (id) =>
        set((state) => ({
          items: state.items.filter((item) => item.id !== id),
          activeId: state.activeId === id ? null : state.activeId,
        })),
      clearFinished: () =>
        set((state) => ({
          items: state.items.filter(
            (item) =>
              item.status === "queued" ||
              item.status === "downloading" ||
              item.status === "paused",
          ),
        })),
      clearAll: () => set({ items: [], activeId: null }),
      applyProgress: (progress) =>
        set((state) => ({
          items: state.items.map((item) => {
            if (item.id !== progress.id) return item;
            if (
              item.status === "paused" &&
              progress.status === "downloading"
            ) {
              return item;
            }
            const terminal =
              item.status === "error" ||
              item.status === "completed" ||
              item.status === "cancelled";
            const status =
              terminal && progress.status === "downloading"
                ? item.status
                : progress.status === "completed" ||
                    progress.status === "error" ||
                    progress.status === "cancelled" ||
                    progress.status === "downloading"
                  ? (progress.status as QueueItem["status"])
                  : item.status;
            const nextError = normalizeQueueError(progress.error);
            const keepExistingError =
              status !== "downloading" &&
              status !== "queued" &&
              status !== "completed";
            const nextPhase: DownloadPhase | null | undefined =
              progress.status === "completed" ||
              progress.status === "error" ||
              progress.status === "cancelled"
                ? null
                : progress.phase ?? item.phase;
            return {
              ...item,
              status,
              percent: progress.percent,
              speed: progress.speed,
              eta: progress.eta,
              filename: progress.filename ?? item.filename,
              phase: nextPhase,
              error: nextError ?? (keepExistingError ? normalizeQueueError(item.error) : undefined),
            };
          }),
        })),
      setActiveId: (activeId) => set({ activeId }),
      setOrchestratorPaused: (orchestratorPaused) => set({ orchestratorPaused }),
      nextQueued: () => get().items.find((item) => item.status === "queued"),
    }),
    {
      name: "acorn-queue",
      version: 2,
      migrate: (persisted: unknown, version: number) => {
        const state = persisted as { items?: QueueItem[]; activeId?: string | null };
        if (version < 2 && state.items) {
          state.items = state.items.map((item) => ({
            ...item,
            retryCount: item.retryCount ?? 0,
            lastBotErrorAt: item.lastBotErrorAt ?? 0,
            cooldownUntil: item.cooldownUntil ?? 0,
          }));
        }
        return state;
      },
      partialize: (state) => ({
        items: state.items.map((item) =>
          item.status === "downloading"
            ? { ...item, status: "queued" as const, percent: 0 }
            : item,
        ),
      }),
    },
  ),
);
