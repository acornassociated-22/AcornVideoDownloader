import { useEffect, useState } from "react";
import { Select } from "../components/Select";
import { LOCALES, LOCALE_FLAGS, LOCALE_LABELS } from "../i18n";
import { useT } from "../i18n/useT";
import {
  checkBinaries,
  isTauri,
  selectDirectory,
  selectFile,
} from "../lib/tauri";
import { useSettingsStore } from "../store/settings";
import type { BinaryCheck, CookiesBrowser, Locale, ThemeMode } from "../types";

/** Desktop settings page. */
export function Settings() {
  const t = useT();
  const settings = useSettingsStore();
  const [binaries, setBinaries] = useState<BinaryCheck | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!isTauri()) return;
    void checkBinaries(null, null).then(setBinaries);
  }, []);

  /** Pick an output directory via native dialog. */
  async function handlePickDir() {
    if (!isTauri()) {
      setMessage(t("settings.pickDirTauri"));
      return;
    }
    const dir = await selectDirectory();
    if (dir) settings.setOutputDir(dir);
  }

  /** Pick a Netscape cookies.txt file for yt-dlp. */
  async function handlePickCookies() {
    if (!isTauri()) {
      setMessage(t("settings.pickDirTauri"));
      return;
    }
    const file = await selectFile();
    if (file) settings.setCookiesFile(file);
  }

  const engineReady = Boolean(binaries?.ytdlp);
  const engineLabel = !isTauri()
    ? t("settings.previewMode")
    : engineReady
      ? t("settings.engineReady")
      : binaries?.ytdlpError || t("settings.engineMissing");

  const localeOptions = LOCALES.map((code) => ({
    value: code,
    label: LOCALE_LABELS[code],
    flag: LOCALE_FLAGS[code],
  }));

  const browserOptions = [
    { value: "auto", label: t("settings.cookiesAuto") },
    { value: "firefox", label: "Firefox" },
    { value: "chrome", label: "Chrome" },
    { value: "chromium", label: "Chromium" },
    { value: "brave", label: "Brave" },
    { value: "edge", label: "Edge" },
    { value: "none", label: t("settings.cookiesNone") },
  ];

  const themeOptions: { value: ThemeMode; label: string; icon: string }[] = [
    { value: "system", label: t("settings.themeSystem"), icon: "contrast" },
    { value: "light", label: t("settings.themeLight"), icon: "light_mode" },
    { value: "dark", label: t("settings.themeDark"), icon: "dark_mode" },
  ];

  const qualityOptions = [
    { value: "best", label: t("wizard.best") },
    { value: "2160", label: "2160p" },
    { value: "1080", label: "1080p" },
    { value: "720", label: "720p" },
  ];

  return (
    <section className="panel soft-panel settings-page animate-rise-in">
      <header className="settings-hero">
        <h2 className="section-title">{t("settings.title")}</h2>
        <p className="section-sub">{t("settings.sub")}</p>
      </header>

      <div className="settings-body">
        <section className="settings-group">
          <h3 className="settings-group-title">{t("settings.appearance")}</h3>

          <div className="settings-row">
            <div className="settings-row-copy">
              <span className="settings-row-label">{t("settings.theme")}</span>
            </div>
            <div className="settings-segment" role="group" aria-label={t("settings.theme")}>
              {themeOptions.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className={`settings-segment-btn ${settings.theme === opt.value ? "is-active" : ""}`}
                  onClick={() => settings.setTheme(opt.value)}
                  aria-pressed={settings.theme === opt.value}
                >
                  <span className="material-symbols-rounded">{opt.icon}</span>
                  <span>{opt.label}</span>
                </button>
              ))}
            </div>
          </div>

          <div className="settings-row settings-row-stack">
            <div className="settings-row-copy">
              <label className="settings-row-label" htmlFor="locale">
                {t("settings.language")}
              </label>
            </div>
            <Select
              id="locale"
              value={settings.locale}
              options={localeOptions}
              onChange={(value) => settings.setLocale(value as Locale)}
              ariaLabel={t("settings.language")}
            />
          </div>
        </section>

        <section className="settings-group">
          <h3 className="settings-group-title">{t("settings.youtubeAuth")}</h3>
          <p className="settings-hint">{t("settings.cookiesHint")}</p>

          <div className="settings-row settings-row-stack">
            <div className="settings-row-copy">
              <span className="settings-row-label">{t("settings.cookiesBrowser")}</span>
            </div>
            <Select
              id="cookies-browser"
              value={settings.cookiesFromBrowser}
              options={browserOptions}
              onChange={(value) =>
                settings.setCookiesFromBrowser(value as CookiesBrowser)
              }
              ariaLabel={t("settings.cookiesBrowser")}
            />
          </div>

          <div className="settings-row settings-row-stack">
            <div className="settings-row-copy">
              <span className="settings-row-label">{t("settings.cookiesFile")}</span>
            </div>
            <div className="path-row">
              <input
                type="text"
                className="path-input"
                value={settings.cookiesFile || ""}
                placeholder="cookies.txt"
                readOnly
              />
              <button type="button" className="btn btn-ghost" onClick={handlePickCookies}>
                {t("settings.pickFile")}
              </button>
              {settings.cookiesFile ? (
                <button
                  type="button"
                  className="btn btn-ghost"
                  onClick={() => settings.setCookiesFile(null)}
                >
                  {t("settings.clearFile")}
                </button>
              ) : null}
            </div>
          </div>
        </section>

        <section className="settings-group">
          <h3 className="settings-group-title">{t("settings.downloads")}</h3>

          <div className="settings-row settings-row-stack">
            <div className="settings-row-copy">
              <label className="settings-row-label" htmlFor="outdir">
                {t("settings.outdir")}
              </label>
            </div>
            <div className="path-row">
              <input
                id="outdir"
                type="text"
                className="path-input"
                value={settings.outputDir}
                onChange={(e) => settings.setOutputDir(e.target.value)}
                placeholder="~/Downloads/Acorn"
                readOnly
              />
              <button type="button" className="btn btn-primary" onClick={handlePickDir}>
                {t("settings.pick")}
              </button>
            </div>
          </div>

          <div className="settings-row settings-row-stack">
            <div className="settings-row-copy">
              <span className="settings-row-label">{t("settings.defaultQuality")}</span>
            </div>
            <div
              className="settings-chips"
              role="group"
              aria-label={t("settings.defaultQuality")}
            >
              {qualityOptions.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  className={`settings-chip ${settings.defaultQuality === opt.value ? "is-active" : ""}`}
                  onClick={() => settings.setDefaultQuality(opt.value)}
                  aria-pressed={settings.defaultQuality === opt.value}
                >
                  {opt.label}
                </button>
              ))}
            </div>
          </div>

          <label className="settings-pref">
            <span className="settings-pref-copy">{t("settings.saveThumbDefault")}</span>
            <span className="toggle">
              <input
                type="checkbox"
                checked={settings.writeThumbnailDefault}
                onChange={(e) => settings.setWriteThumbnailDefault(e.target.checked)}
              />
              <span className="toggle-track" aria-hidden="true">
                <span className="toggle-knob" />
              </span>
            </span>
          </label>

          <label className="settings-pref">
            <span className="settings-pref-copy">{t("settings.subsDefault")}</span>
            <span className="toggle">
              <input
                type="checkbox"
                checked={settings.writeSubsDefault}
                onChange={(e) => settings.setWriteSubsDefault(e.target.checked)}
              />
              <span className="toggle-track" aria-hidden="true">
                <span className="toggle-knob" />
              </span>
            </span>
          </label>
        </section>

        <div className={`settings-status ${engineReady ? "is-ok" : "is-warn"}`}>
          <span className="engine-dot" />
          <span>{engineLabel}</span>
        </div>
      </div>

      {message ? <p className="settings-message">{message}</p> : null}
    </section>
  );
}
