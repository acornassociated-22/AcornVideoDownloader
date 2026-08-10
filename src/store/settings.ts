import { create } from "zustand";
import { persist } from "zustand/middleware";
import type { AppSettings, CookiesBrowser, Locale, ThemeMode } from "../types";

const defaults: AppSettings = {
  outputDir: "",
  theme: "light",
  locale: "en",
  defaultQuality: "1080",
  defaultContainer: "mp4",
  defaultAudioOnly: false,
  ytdlpPath: null,
  ffmpegPath: null,
  writeSubsDefault: false,
  writeThumbnailDefault: false,
  cookiesFromBrowser: "auto",
  cookiesFile: null,
  androidDownloadJitter: true,
  androidSafeBulkMode: false,
  androidSafeBulkInterval: 10,
  androidCookieRotateInterval: 15,
  androidGuestPaceMode: true,
  androidYtdlpAutoUpdate: true,
};

interface SettingsState extends AppSettings {
  hydrated: boolean;
  setTheme: (theme: ThemeMode) => void;
  setLocale: (locale: Locale) => void;
  setOutputDir: (dir: string) => void;
  setDefaultQuality: (q: string) => void;
  setDefaultContainer: (container: string) => void;
  setDefaultAudioOnly: (audioOnly: boolean) => void;
  setYtdlpPath: (path: string | null) => void;
  setFfmpegPath: (path: string | null) => void;
  setWriteSubsDefault: (value: boolean) => void;
  setWriteThumbnailDefault: (value: boolean) => void;
  setCookiesFromBrowser: (value: CookiesBrowser) => void;
  setCookiesFile: (path: string | null) => void;
  setAndroidDownloadJitter: (value: boolean) => void;
  setAndroidSafeBulkMode: (value: boolean) => void;
  setAndroidGuestPaceMode: (value: boolean) => void;
  setAndroidYtdlpAutoUpdate: (value: boolean) => void;
  patch: (partial: Partial<AppSettings>) => void;
}

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => ({
      ...defaults,
      hydrated: false,
      setTheme: (theme) => set({ theme }),
      setLocale: (locale) => set({ locale }),
      setOutputDir: (outputDir) => set({ outputDir }),
      setDefaultQuality: (defaultQuality) => set({ defaultQuality }),
      setDefaultContainer: (defaultContainer) => set({ defaultContainer }),
      setDefaultAudioOnly: (defaultAudioOnly) =>
        set((state) => {
          const videoFormats = ["mp4", "webm", "mkv"];
          const audioFormats = ["mp3", "m4a", "opus", "wav"];
          let container = state.defaultContainer;
          if (defaultAudioOnly && videoFormats.includes(container)) {
            container = "mp3";
          } else if (!defaultAudioOnly && audioFormats.includes(container)) {
            container = "mp4";
          }
          return { defaultAudioOnly, defaultContainer: container };
        }),
      setYtdlpPath: (ytdlpPath) => set({ ytdlpPath }),
      setFfmpegPath: (ffmpegPath) => set({ ffmpegPath }),
      setWriteSubsDefault: (writeSubsDefault) => set({ writeSubsDefault }),
      setWriteThumbnailDefault: (writeThumbnailDefault) =>
        set({ writeThumbnailDefault }),
      setCookiesFromBrowser: (cookiesFromBrowser) => set({ cookiesFromBrowser }),
      setCookiesFile: (cookiesFile) => set({ cookiesFile }),
      setAndroidDownloadJitter: (androidDownloadJitter) =>
        set({ androidDownloadJitter }),
      setAndroidSafeBulkMode: (androidSafeBulkMode) =>
        set({ androidSafeBulkMode }),
      setAndroidGuestPaceMode: (androidGuestPaceMode) =>
        set({ androidGuestPaceMode }),
      setAndroidYtdlpAutoUpdate: (androidYtdlpAutoUpdate) =>
        set({ androidYtdlpAutoUpdate }),
      patch: (partial) => set(partial),
    }),
    {
      name: "acorn-settings",
      version: 7,
      migrate: (persisted, version) => {
        const state = (persisted ?? {}) as Partial<AppSettings> & {
          theme?: ThemeMode;
        };
        if (version < 2) {
          // New default is dark; migrate unset/system preference.
          if (!state.theme || state.theme === "system") {
            state.theme = "dark";
          }
        }
        if (version < 3) {
          if (!state.defaultContainer) state.defaultContainer = "mp4";
          if (state.defaultAudioOnly === undefined) state.defaultAudioOnly = false;
        }
        if (version < 4) {
          state.writeThumbnailDefault = false;
        }
        if (version < 5) {
          state.androidDownloadJitter = true;
          state.androidSafeBulkMode = false;
          state.androidSafeBulkInterval = 10;
          state.androidCookieRotateInterval = 15;
        }
        if (version < 6) {
          state.androidGuestPaceMode = true;
        }
        if (version < 7) {
          state.androidYtdlpAutoUpdate = true;
        }
        return state as AppSettings;
      },
      onRehydrateStorage: () => (state) => {
        if (!state) return;
        state.hydrated = true;
        if (!state.locale) state.locale = "en";
        if (!state.cookiesFromBrowser) state.cookiesFromBrowser = "auto";
        if (!state.theme || state.theme === "system") state.theme = "light";
        if (!state.defaultContainer) state.defaultContainer = "mp4";
        if (state.defaultAudioOnly === undefined) state.defaultAudioOnly = false;
        if (state.writeThumbnailDefault === undefined) state.writeThumbnailDefault = false;
        if (state.androidDownloadJitter === undefined) state.androidDownloadJitter = true;
        if (state.androidSafeBulkMode === undefined) state.androidSafeBulkMode = false;
        if (!state.androidSafeBulkInterval) state.androidSafeBulkInterval = 10;
        if (!state.androidCookieRotateInterval) state.androidCookieRotateInterval = 15;
        if (state.androidGuestPaceMode === undefined) state.androidGuestPaceMode = true;
        if (state.androidYtdlpAutoUpdate === undefined) state.androidYtdlpAutoUpdate = true;
      },
    },
  ),
);

/** Resolve light/dark from theme setting + system preference. */
export function resolveTheme(theme: ThemeMode): "light" | "dark" {
  if (theme === "light" || theme === "dark") return theme;
  if (typeof window === "undefined") return "light";
  return window.matchMedia("(prefers-color-scheme: dark)").matches
    ? "dark"
    : "light";
}
