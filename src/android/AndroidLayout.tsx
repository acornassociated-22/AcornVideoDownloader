import { useMemo, type ReactNode } from "react";
import logo from "../assets/logo.svg";
import { useT } from "../i18n/useT";
import { resolveTheme, useSettingsStore } from "../store/settings";
import { useQueueStore } from "../store/queue";
import type { PageId } from "../types";
import { AndroidDock } from "./components/AndroidDock";

const DOCK_PAGES: PageId[] = ["home", "queue", "history", "settings", "about"];

/** Android shell: top rail, scroll main, Hejar concave dock. */
export function AndroidLayout({
  page,
  onNavigate,
  children,
}: {
  page: PageId;
  onNavigate: (page: PageId) => void;
  children: ReactNode;
}) {
  const t = useT();
  const locale = useSettingsStore((s) => s.locale);
  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const items = useQueueStore((s) => s.items);
  const activeDownloads = items.filter(
    (item) => item.status === "downloading" || item.status === "queued",
  ).length;

  const dockIndex = Math.max(0, DOCK_PAGES.indexOf(page));
  const resolved = resolveTheme(theme);
  const themeIcon = resolved === "dark" ? "light_mode" : "dark_mode";
  const themeLabel =
    resolved === "dark" ? t("nav.themeToLight") : t("nav.themeToDark");

  /** Toggle between light and dark themes. */
  function handleToggleTheme() {
    setTheme(resolved === "dark" ? "light" : "dark");
  }

  const tabs = useMemo(
    () => [
      { id: "home" as const, icon: "home", label: t("nav.home") },
      { id: "queue" as const, icon: "download", label: t("nav.queue") },
      { id: "history" as const, icon: "history", label: t("nav.history") },
      { id: "settings" as const, icon: "settings", label: t("nav.settings") },
      { id: "about" as const, icon: "info", label: t("nav.about") },
    ],
    [locale, t],
  );

  return (
    <div className="a-shell">
      <header className="a-top">
        <button
          type="button"
          className="a-brand"
          onClick={() => onNavigate("home")}
          aria-label={t("nav.homeAria")}
        >
          <span className="a-brand-mark">
            <img src={logo} alt="" />
          </span>
          <span className="a-brand-name">Acorn</span>
        </button>
        <div className="a-top-actions">
          <button
            type="button"
            className="a-icon-btn"
            onClick={handleToggleTheme}
            aria-label={themeLabel}
          >
            <span className="material-symbols-rounded">{themeIcon}</span>
          </button>
        </div>
      </header>

      <main className="a-main a-main-nudge" key={page}>
        {children}
      </main>

      <AndroidDock
        tabs={tabs}
        activeIndex={dockIndex}
        queueBadge={activeDownloads > 0}
        ariaLabel={t("nav.mainMenu")}
        onNavigate={onNavigate}
      />
    </div>
  );
}
