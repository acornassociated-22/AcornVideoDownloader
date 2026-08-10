import { create } from "zustand";
import { translate } from "../i18n/translate";
import type { MetadataResult, PageId, VideoEntry } from "../types";

interface UiState {
  page: PageId;
  url: string;
  loading: boolean;
  error: string | null;
  metadata: MetadataResult | null;
  selectedEntry: VideoEntry | null;
  /** Increments on each fetch/cancel so stale responses are ignored. */
  fetchGeneration: number;
  setPage: (page: PageId) => void;
  setUrl: (url: string) => void;
  setLoading: (loading: boolean) => void;
  setError: (error: string | null) => void;
  setMetadata: (metadata: MetadataResult | null) => void;
  setSelectedEntry: (entry: VideoEntry | null) => void;
  beginFetch: () => number;
  cancelFetch: () => void;
  resetResult: () => void;
  /** Open the empty paste-link home screen. */
  goHomeFresh: () => void;
}

export const useUiStore = create<UiState>((set, get) => ({
  page: "home",
  url: "",
  loading: false,
  error: null,
  metadata: null,
  selectedEntry: null,
  fetchGeneration: 0,
  setPage: (page) => set({ page }),
  setUrl: (url) => set({ url }),
  setLoading: (loading) => set({ loading }),
  setError: (error) => set({ error }),
  setMetadata: (metadata) => set({ metadata }),
  setSelectedEntry: (selectedEntry) => set({ selectedEntry }),
  beginFetch: () => {
    const fetchGeneration = get().fetchGeneration + 1;
    set({
      fetchGeneration,
      loading: true,
      error: null,
      metadata: null,
      selectedEntry: null,
    });
    return fetchGeneration;
  },
  cancelFetch: () =>
    set((state) => ({
      fetchGeneration: state.fetchGeneration + 1,
      loading: false,
      error: translate("errors.requestCancelled"),
    })),
  resetResult: () =>
    set({ metadata: null, selectedEntry: null, error: null }),
  goHomeFresh: () =>
    set((state) => ({
      page: "home",
      url: "",
      loading: false,
      error: null,
      metadata: null,
      selectedEntry: null,
      fetchGeneration: state.fetchGeneration + 1,
    })),
}));
