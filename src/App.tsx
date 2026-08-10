import { useEffect } from "react";
import { AndroidLayout } from "./android/AndroidLayout";
import { AndroidAbout } from "./android/pages/AndroidAbout";
import { AndroidHistory } from "./android/pages/AndroidHistory";
import { AndroidHome } from "./android/pages/AndroidHome";
import { AndroidQueue } from "./android/pages/AndroidQueue";
import { AndroidSettings } from "./android/pages/AndroidSettings";
import { Layout } from "./components/Layout";
import { ToastStack } from "./components/ToastStack";
import { useDownloadRunner } from "./hooks/useDownloadRunner";
import { isRtl } from "./i18n";
import { getPendingNavigation, requestNotificationPermission } from "./lib/androidDownload";
import { isAndroidClient } from "./lib/platform";
import { getDefaultSettings, getPlatformInfo, isTauri } from "./lib/tauri";
import { getExportFolder } from "./lib/androidStorage";
import { About } from "./pages/About";
import { Home } from "./pages/Home";
import { History } from "./pages/History";
import { Queue } from "./pages/Queue";
import { Settings } from "./pages/Settings";
import { resolveTheme, useSettingsStore } from "./store/settings";
import { useUiStore } from "./store/ui";

type AcornChromeBridge = {
  setDark: (dark: boolean) => void;
  getInsets?: () => string;
};

/** Read native chrome bridge if the WebView has attached it. */
function getChromeBridge(): AcornChromeBridge | undefined {
  return (window as Window & { AcornChrome?: AcornChromeBridge }).AcornChrome;
}

/** Push theme + safe-area insets to CSS / native bars. */
function syncNativeChrome(isDark: boolean): boolean {
  const bridge = getChromeBridge();
  if (!bridge?.setDark) return false;
  try {
    bridge.setDark(isDark);
    if (typeof bridge.getInsets === "function") {
      const raw = bridge.getInsets();
      const insets = JSON.parse(raw) as { top?: number; bottom?: number };
      const root = document.documentElement;
      if (typeof insets.top === "number" && insets.top > 0) {
        root.style.setProperty("--a-inset-top", `${insets.top}px`);
      }
      if (typeof insets.bottom === "number" && insets.bottom >= 0) {
        root.style.setProperty("--a-inset-bottom", `${insets.bottom}px`);
      }
    }
    return true;
  } catch {
    return false;
  }
}

/** Root application shell: theme, hydration, pages, and queue runner. */
function App() {
  const page = useUiStore((s) => s.page);
  const setPage = useUiStore((s) => s.setPage);
  const theme = useSettingsStore((s) => s.theme);
  const locale = useSettingsStore((s) => s.locale);
  const outputDir = useSettingsStore((s) => s.outputDir);
  const patch = useSettingsStore((s) => s.patch);
  const android = isAndroidClient();

  useDownloadRunner();

  useEffect(() => {
    const resolved = resolveTheme(theme);
    const isDark = resolved === "dark";
    document.documentElement.classList.toggle("dark", isDark);

    const meta = document.getElementById("acorn-theme-color");
    if (meta) meta.setAttribute("content", isDark ? "#141416" : "#F0F2F5");

    // Retry until AcornChrome attaches (WebView mounts after first paint).
    const timers = [0, 200, 400, 800, 1500, 2500, 4000].map((ms) =>
      window.setTimeout(() => {
        syncNativeChrome(isDark);
      }, ms),
    );

    /** Re-sync icons + insets when returning to the foreground. */
    function handleVisibility() {
      if (document.visibilityState === "visible") syncNativeChrome(isDark);
    }
    document.addEventListener("visibilitychange", handleVisibility);

    return () => {
      timers.forEach((id) => window.clearTimeout(id));
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [theme]);

  useEffect(() => {
    document.documentElement.lang = locale;
    document.documentElement.dir = isRtl(locale) ? "rtl" : "ltr";
  }, [locale]);

  useEffect(() => {
    if (!isTauri()) return;

    /** Seed defaults from the Rust side when local settings are empty. */
    async function hydrate() {
      try {
        if (android) {
          const info = await getExportFolder();
          patch({ outputDir: info.displayName });
          return;
        }
        const defaults = await getDefaultSettings();
        const platform = await getPlatformInfo();
        if (!outputDir) {
          patch({
            outputDir: defaults.outputDir || platform.defaultOutputDir,
          });
        }
      } catch {
        // ignore bootstrap errors in early boot
      }
    }

    void hydrate();
  }, [outputDir, patch, android]);

  useEffect(() => {
    if (!isTauri() || !android) return;

    /** Handle share intent / notification deep links from Kotlin. */
    async function handlePendingNavigation() {
      try {
        const nav = await getPendingNavigation();
        if (nav.openPage) {
          setPage(nav.openPage as Parameters<typeof setPage>[0]);
        }
        if (nav.sharedUrl) {
          useUiStore.getState().setUrl(nav.sharedUrl);
          setPage("home");
        }
      } catch {
        // ignore early boot failures
      }
    }

    void (async () => {
      await handlePendingNavigation();
      await requestNotificationPermission();
    })();
  }, [android, setPage]);

  useEffect(() => {
    /** Keep system theme changes in sync when theme=system. */
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (useSettingsStore.getState().theme !== "system") return;
      const isDark = media.matches;
      document.documentElement.classList.toggle("dark", isDark);
      syncNativeChrome(isDark);
    };
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, []);

  if (android) {
    return (
      <>
        <AndroidLayout page={page} onNavigate={setPage}>
          {page === "home" ? <AndroidHome /> : null}
          {page === "queue" ? <AndroidQueue /> : null}
          {page === "history" ? <AndroidHistory /> : null}
          {page === "settings" ? <AndroidSettings /> : null}
          {page === "about" ? <AndroidAbout /> : null}
        </AndroidLayout>
        <ToastStack />
      </>
    );
  }

  return (
    <>
      <Layout page={page} onNavigate={setPage}>
        {page === "home" ? <Home /> : null}
        {page === "queue" ? <Queue /> : null}
        {page === "history" ? <History /> : null}
        {page === "settings" ? <Settings /> : null}
        {page === "about" ? <About /> : null}
      </Layout>
      <ToastStack />
    </>
  );
}

export default App;
