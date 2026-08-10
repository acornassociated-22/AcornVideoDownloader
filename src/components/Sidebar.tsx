import { useEffect, useState } from "react";
import logo from "../assets/logo.svg";
import { useT } from "../i18n/useT";
import type { PageId } from "../types";
import { useQueueStore } from "../store/queue";
import { resolveTheme, useSettingsStore } from "../store/settings";
import { useUiStore } from "../store/ui";

/** Animated light/dark theme control for the sidebar. */
function ThemeSwitch({
  isDark,
  compact,
  onToggle,
  label,
  hint,
  ariaLabel,
}: {
  isDark: boolean;
  compact?: boolean;
  onToggle: () => void;
  label: string;
  hint: string;
  ariaLabel: string;
}) {
  return (
    <button
      type="button"
      className={`theme-switch ${isDark ? "is-dark" : "is-light"} ${compact ? "compact" : ""}`}
      onClick={onToggle}
      aria-label={ariaLabel}
      aria-pressed={isDark}
      title={label}
    >
      <span className="theme-switch-track" aria-hidden="true">
        <span className="theme-switch-icon sun material-symbols-rounded filled">
          light_mode
        </span>
        <span className="theme-switch-icon moon material-symbols-rounded filled">
          dark_mode
        </span>
        <span className="theme-switch-knob" />
      </span>
      {!compact ? (
        <span className="theme-switch-copy">
          <span className="theme-switch-label">{label}</span>
          <span className="theme-switch-hint">{hint}</span>
        </span>
      ) : null}
    </button>
  );
}

/** Collapsible sidebar navigation (desktop expand/collapse, mobile drawer). */
export function Sidebar({
  page,
  onNavigate,
  collapsed,
  onToggleCollapsed,
}: {
  page: PageId;
  onNavigate: (page: PageId) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
}) {
  const t = useT();
  const theme = useSettingsStore((s) => s.theme);
  const setTheme = useSettingsStore((s) => s.setTheme);
  const [menuActive, setMenuActive] = useState(false);
  const activeCount = useQueueStore(
    (s) =>
      s.items.filter(
        (i) => i.status === "queued" || i.status === "downloading",
      ).length,
  );
  const downloading = useQueueStore((s) =>
    s.items.some((i) => i.status === "downloading"),
  );

  const isDark = resolveTheme(theme) === "dark";

  const links: { id: PageId; label: string; icon: string; hint: string }[] = [
    { id: "home", label: t("nav.home"), icon: "home", hint: t("nav.hint.home") },
    {
      id: "queue",
      label: t("nav.queue"),
      icon: "downloading",
      hint: t("nav.hint.queue"),
    },
    {
      id: "history",
      label: t("nav.history"),
      icon: "history",
      hint: t("nav.hint.history"),
    },
    {
      id: "settings",
      label: t("nav.settings"),
      icon: "tune",
      hint: t("nav.hint.settings"),
    },
    {
      id: "about",
      label: t("nav.about"),
      icon: "info",
      hint: t("nav.hint.about"),
    },
  ];

  useEffect(() => {
    /** Reset mobile menu height behavior on resize to desktop. */
    function handleResize() {
      if (window.innerWidth >= 1024) {
        setMenuActive(false);
      }
    }
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  /** Navigate and close mobile menu. */
  function handleNav(id: PageId) {
    onNavigate(id);
    setMenuActive(false);
  }

  /** Open empty paste-link home (clear URL / results). */
  function handleLogoHome() {
    useUiStore.getState().goHomeFresh();
    setMenuActive(false);
  }

  /** Flip between explicit light and dark themes. */
  function handleToggleTheme() {
    setTheme(isDark ? "light" : "dark");
  }

  const themeLabel = isDark ? t("settings.themeDark") : t("settings.themeLight");
  const themeAria = isDark ? t("nav.themeToLight") : t("nav.themeToDark");

  const className = [
    "sidebar",
    collapsed ? "collapsed" : "",
    menuActive ? "menu-active" : "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <aside className={className}>
      <div className="sidebar-glow" aria-hidden="true" />

      <header className="sidebar-header">
        <button
          type="button"
          className="header-logo"
          onClick={handleLogoHome}
          aria-label={t("nav.homeAria")}
        >
          <span className="header-mark">
            <img src={logo} alt="" />
          </span>
          <span className="header-brand">
            <strong>Acorn</strong>
            <small>{t("brand.subtitle")}</small>
          </span>
        </button>
        <div className="header-actions">
          <span className="theme-switch-mobile">
            <ThemeSwitch
              isDark={isDark}
              compact
              onToggle={handleToggleTheme}
              label={themeLabel}
              hint={t("settings.theme")}
              ariaLabel={themeAria}
            />
          </span>
          <button
            type="button"
            className="toggler menu-toggler"
            onClick={() => setMenuActive((v) => !v)}
            aria-label={t("nav.menu")}
          >
            <span className="material-symbols-rounded">
              {menuActive ? "close" : "menu"}
            </span>
          </button>
        </div>
      </header>

      <nav className="sidebar-nav" aria-label={t("nav.mainMenu")}>
        {!collapsed ? <p className="nav-section-label">{t("nav.section")}</p> : null}
        <ul className="nav-list primary-nav">
          {links.map((link) => {
            const isActive = page === link.id;
            const showBadge = link.id === "queue" && activeCount > 0;

            return (
              <li key={link.id} className="nav-item">
                <button
                  type="button"
                  className={`nav-link ${isActive ? "active" : ""}`}
                  onClick={() => handleNav(link.id)}
                  aria-current={isActive ? "page" : undefined}
                >
                  <span className="nav-active-bar" aria-hidden="true" />
                  <span
                    className={`nav-icon material-symbols-rounded ${isActive ? "filled" : ""}`}
                  >
                    {link.icon}
                  </span>
                  <span className="nav-copy">
                    <span className="nav-label">{link.label}</span>
                    <span className="nav-hint">{link.hint}</span>
                  </span>
                  {showBadge ? (
                    <span
                      className={`nav-badge ${downloading ? "live" : ""}`}
                      aria-label={t("nav.activeDownloads", { count: activeCount })}
                    >
                      {activeCount}
                    </span>
                  ) : null}
                </button>
                <span className="nav-tooltip">{link.label}</span>
              </li>
            );
          })}
        </ul>
      </nav>

      <div className="sidebar-footer">
        <div className="theme-switch-desktop">
          <ThemeSwitch
            isDark={isDark}
            compact={collapsed}
            onToggle={handleToggleTheme}
            label={themeLabel}
            hint={t("settings.theme")}
            ariaLabel={themeAria}
          />
        </div>
        {!collapsed ? (
          <div className="sidebar-status">
            <span
              className={`status-dot ${downloading ? "pulse" : ""}`}
              aria-hidden="true"
            />
            <span>{downloading ? t("nav.downloading") : t("nav.ready")}</span>
          </div>
        ) : null}
        <button
          type="button"
          className="toggler sidebar-toggler"
          onClick={onToggleCollapsed}
          aria-label={collapsed ? t("nav.expand") : t("nav.collapse")}
        >
          <span className="material-symbols-rounded">chevron_left</span>
          <span className="toggler-label">{t("nav.collapse")}</span>
        </button>
      </div>
    </aside>
  );
}
