import { useEffect, useMemo, useState } from "react";
import { LOCALES, LOCALE_FLAGS, LOCALE_LABELS } from "../../i18n";
import { useT } from "../../i18n/useT";
import {
  clearExportFolder,
  getExportFolder,
  pickCookiesFile,
  type ExportFolderInfo,
} from "../../lib/androidStorage";
import {
  applyYtdlpUpdate,
  checkYtdlpUpdate,
  openBatteryOptimizationSettings,
  openYoutubeLogin,
  type YtdlpUpdateInfo,
} from "../../lib/androidDownload";
import { pushQueueToOrchestrator } from "../../hooks/useDownloadRunner";
import {
  getYoutubeCookieStatus,
  isTauri,
  refreshYoutubeCookies,
} from "../../lib/tauri";
import { useSettingsStore } from "../../store/settings";
import type { Locale, ThemeMode, YoutubeCookieStatus } from "../../types";
import { AndroidBottomSheet } from "../components/AndroidBottomSheet";
import {
  AndroidGuideIntro,
  AndroidGuideOemCards,
  AndroidGuideSteps,
  AndroidGuideTip,
} from "../components/AndroidGuidePanel";
import {
  DeckActionBar,
  DeckActionGrid,
  DeckEngineModule,
  DeckFeaturePair,
  DeckFeatureToggle,
  DeckFieldLabel,
  DeckHeader,
  DeckLocalePicker,
  DeckModule,
  DeckStorageRow,
  DeckThemePicker,
  DeckToast,
} from "../components/AndroidSettingsUI";

/** Render emoji flag or Rojava Kurdish tricolor. */
function FlagMark({ flag }: { flag: string }) {
  if (flag === "kurdish") {
    return <span className="flag-kurdish" aria-hidden="true" />;
  }
  return (
    <span className="a-flag-emoji" aria-hidden="true">
      {flag}
    </span>
  );
}

/** Android settings — visual control deck with inline editors. */
export function AndroidSettings() {
  const t = useT();
  const settings = useSettingsStore();
  const [message, setMessage] = useState<string | null>(null);
  const [messageOk, setMessageOk] = useState(true);
  const [exportOpen, setExportOpen] = useState(false);
  const [cookieGuideOpen, setCookieGuideOpen] = useState(false);
  const [batteryGuideOpen, setBatteryGuideOpen] = useState(false);
  const [ytdlpUpdate, setYtdlpUpdate] = useState<YtdlpUpdateInfo | null>(null);
  const [ytdlpBusy, setYtdlpBusy] = useState(false);
  const [exportFolder, setExportFolder] = useState<ExportFolderInfo | null>(null);
  const [cookieStatus, setCookieStatus] = useState<YoutubeCookieStatus | null>(null);

  useEffect(() => {
    if (!isTauri()) return;
    void getExportFolder()
      .then(setExportFolder)
      .catch(() => {
        setExportFolder({
          treeUri: null,
          displayName: t("settings.exportFolderPublic"),
          mode: "public",
        });
      });
  }, [t]);

  useEffect(() => {
    if (!isTauri()) return;
    void getYoutubeCookieStatus()
      .then(setCookieStatus)
      .catch(() => setCookieStatus(null));
  }, [message]);

  /** Reset to public Downloads/Acorn. */
  async function handleClearExport() {
    if (!isTauri()) return;
    try {
      const info = await clearExportFolder();
      setExportFolder(info);
      settings.setOutputDir(info.displayName);
      setMessageOk(true);
      setMessage(t("settings.exportFolderCleared"));
      setExportOpen(false);
    } catch (err) {
      setMessageOk(false);
      setMessage(err instanceof Error ? err.message : String(err));
    }
  }

  /** Import Netscape cookies.txt from desktop browser export. */
  async function handleImportCookies() {
    if (!isTauri()) return;
    try {
      const result = await pickCookiesFile();
      if (result.imported) {
        settings.setCookiesFile(result.path);
        setMessageOk(true);
        setMessage(t("settings.cookiesFileOk"));
        const st = await getYoutubeCookieStatus();
        setCookieStatus(st);
      }
    } catch (err) {
      setMessageOk(false);
      setMessage(err instanceof Error ? err.message : String(err));
    }
  }

  /** Force-refresh guest cookies from WebView harvest. */
  async function handleRefreshCookies() {
    if (!isTauri()) return;
    try {
      await refreshYoutubeCookies(true);
      const st = await getYoutubeCookieStatus();
      setCookieStatus(st);
      setMessageOk(true);
      setMessage(t("settings.youtubeRefreshCookies"));
    } catch (err) {
      setMessageOk(false);
      setMessage(err instanceof Error ? err.message : String(err));
    }
  }

  /** Open native YouTube login WebView. */
  async function handleYoutubeLogin() {
    if (!isTauri()) return;
    try {
      await openYoutubeLogin();
      setMessageOk(true);
      setMessage(t("settings.youtubeSignInStarted"));
    } catch (err) {
      setMessageOk(false);
      setMessage(err instanceof Error ? err.message : String(err));
    }
  }

  /** Check for yt-dlp script update from GitHub. */
  async function handleCheckYtdlpUpdate() {
    if (!isTauri()) return;
    setYtdlpBusy(true);
    try {
      const info = await checkYtdlpUpdate(true);
      setYtdlpUpdate(info);
      setMessageOk(true);
      setMessage(
        info.updateAvailable
          ? t("settings.ytdlpUpdateAvailable", { version: info.latestVersion })
          : t("settings.ytdlpUpToDate", { version: info.currentVersion }),
      );
    } catch (err) {
      setMessageOk(false);
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setYtdlpBusy(false);
    }
  }

  /** Download and apply yt-dlp script update. */
  async function handleApplyYtdlpUpdate() {
    if (!isTauri()) return;
    setYtdlpBusy(true);
    try {
      const result = await applyYtdlpUpdate();
      setMessageOk(result.success);
      setMessage(
        result.success
          ? t("settings.ytdlpUpdated", { version: result.version ?? "" })
          : result.error ?? t("settings.ytdlpUpdateFailed"),
      );
      if (result.success) {
        const info = await checkYtdlpUpdate(true);
        setYtdlpUpdate(info);
      }
    } catch (err) {
      setMessageOk(false);
      setMessage(err instanceof Error ? err.message : String(err));
    } finally {
      setYtdlpBusy(false);
    }
  }

  /** Open system battery / app power settings (MIUI-friendly fallbacks). */
  async function handleOpenBatterySettings() {
    try {
      await openBatteryOptimizationSettings();
    } catch (err) {
      setMessageOk(false);
      setMessage(err instanceof Error ? err.message : String(err));
    }
  }

  const cookieBadgeLabel = (() => {
    if (!cookieStatus?.exists) return t("settings.youtubeCookieMissing");
    if (cookieStatus.authenticated) return t("settings.youtubeSignedIn");
    return t("settings.youtubeGuest");
  })();

  const cookieAgeLabel =
    cookieStatus?.exists && cookieStatus.ageMs >= 0
      ? t("settings.youtubeCookieAge", {
          minutes: Math.max(0, Math.floor(cookieStatus.ageMs / 60_000)),
        })
      : null;

  const exportLabel =
    exportFolder?.displayName ||
    settings.outputDir ||
    t("settings.exportFolderPublic");

  const themeOptions: { value: ThemeMode; label: string; icon: string; tone: "system" | "light" | "dark" }[] = [
    { value: "system", label: t("settings.themeSystem"), icon: "contrast", tone: "system" },
    { value: "light", label: t("settings.themeLight"), icon: "light_mode", tone: "light" },
    { value: "dark", label: t("settings.themeDark"), icon: "dark_mode", tone: "dark" },
  ];

  const cookieGuideSteps = useMemo(
    () => [
      {
        icon: "login",
        title: t("settings.youtubeCookieGuideStep1Title"),
        body: t("settings.youtubeCookieGuideStep1Body"),
      },
      {
        icon: "extension",
        title: t("settings.youtubeCookieGuideStep2Title"),
        body: t("settings.youtubeCookieGuideStep2Body"),
      },
      {
        icon: "download",
        title: t("settings.youtubeCookieGuideStep3Title"),
        body: t("settings.youtubeCookieGuideStep3Body"),
      },
      {
        icon: "upload_file",
        title: t("settings.youtubeCookieGuideStep4Title"),
        body: t("settings.youtubeCookieGuideStep4Body"),
      },
    ],
    [t],
  );

  const batteryOemCards = useMemo(
    () => [
      {
        brand: "One",
        brandTone: "samsung" as const,
        title: t("settings.batteryGuideSamsungTitle"),
        body: t("settings.batteryGuideSamsungBody"),
      },
      {
        brand: "MI",
        brandTone: "xiaomi" as const,
        title: t("settings.batteryGuideXiaomiTitle"),
        body: t("settings.batteryGuideXiaomiBody"),
      },
      {
        brand: "HW",
        brandTone: "huawei" as const,
        title: t("settings.batteryGuideHuaweiTitle"),
        body: t("settings.batteryGuideHuaweiBody"),
      },
    ],
    [t],
  );

  const qualityOptions = settings.defaultAudioOnly
    ? [{ value: "best", label: t("wizard.bestAudio") }]
    : [
        { value: "best", label: t("wizard.best") },
        { value: "2160", label: "2160p" },
        { value: "1080", label: "1080p" },
        { value: "720", label: "720p" },
      ];

  const formatOptions = settings.defaultAudioOnly
    ? [
        { value: "mp3", label: "MP3" },
        { value: "m4a", label: "M4A" },
        { value: "opus", label: "OPUS" },
        { value: "wav", label: "WAV" },
      ]
    : [
        { value: "mp4", label: "MP4" },
        { value: "webm", label: "WEBM" },
        { value: "mkv", label: "MKV" },
      ];

  return (
    <div className="a-stack a-deck-page">
      <DeckHeader title={t("settings.title")} subtitle={t("settings.sub")} />

      <DeckModule label={t("settings.appearance")} delay={30}>
        <DeckFieldLabel>{t("settings.theme")}</DeckFieldLabel>
        <DeckThemePicker
          options={themeOptions}
          value={settings.theme}
          onChange={settings.setTheme}
        />
        <DeckFieldLabel>{t("settings.language")}</DeckFieldLabel>
        <DeckLocalePicker
          locales={LOCALES}
          value={settings.locale}
          onChange={(code) => settings.setLocale(code as Locale)}
          renderFlag={(code) => <FlagMark flag={LOCALE_FLAGS[code]} />}
          renderLabel={(code) => LOCALE_LABELS[code]}
        />
      </DeckModule>

      <DeckModule label={t("settings.downloads")} delay={60}>
        <DeckFieldLabel>{t("settings.defaultType")}</DeckFieldLabel>
        <div className="a-segment a-deck-segment" role="group">
          <button
            type="button"
            className={!settings.defaultAudioOnly ? "is-active" : undefined}
            onClick={() => settings.setDefaultAudioOnly(false)}
          >
            {t("wizard.video")}
          </button>
          <button
            type="button"
            className={settings.defaultAudioOnly ? "is-active" : undefined}
            onClick={() => settings.setDefaultAudioOnly(true)}
          >
            {t("wizard.audio")}
          </button>
        </div>

        <DeckFieldLabel>{t("settings.defaultQuality")}</DeckFieldLabel>
        <div className="a-chips a-deck-chips">
          {qualityOptions.map((option, index) => (
            <button
              key={option.value}
              type="button"
              className={`a-chip ${settings.defaultQuality === option.value ? "is-active" : ""}`}
              style={{ animationDelay: `${index * 35}ms` }}
              onClick={() => settings.setDefaultQuality(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>

        <DeckFieldLabel>{t("settings.defaultFormat")}</DeckFieldLabel>
        <div className="a-chips a-deck-chips">
          {formatOptions.map((option, index) => (
            <button
              key={option.value}
              type="button"
              className={`a-chip ${settings.defaultContainer === option.value ? "is-active" : ""}`}
              style={{ animationDelay: `${index * 35}ms` }}
              onClick={() => settings.setDefaultContainer(option.value)}
            >
              {option.label}
            </button>
          ))}
        </div>

        <DeckFeaturePair
          thumbTitle={t("settings.saveThumbDefault")}
          subsTitle={t("settings.subsDefault")}
          thumbChecked={settings.writeThumbnailDefault}
          subsChecked={settings.writeSubsDefault}
          onThumbChange={settings.setWriteThumbnailDefault}
          onSubsChange={settings.setWriteSubsDefault}
        />

        <DeckFieldLabel>{t("settings.androidBulk")}</DeckFieldLabel>
        <p className="a-deck-note">{t("settings.androidBulkHint")}</p>
        <div className="a-deck-features">
          <DeckFeatureToggle
            kind="subs"
            title={t("settings.androidJitter")}
            checked={settings.androidDownloadJitter !== false}
            onChange={settings.setAndroidDownloadJitter}
          />
          <DeckFeatureToggle
            kind="thumb"
            title={t("settings.androidSafeBulk")}
            checked={settings.androidSafeBulkMode === true}
            onChange={settings.setAndroidSafeBulkMode}
          />
          <DeckFeatureToggle
            kind="subs"
            title={t("settings.androidGuestPace")}
            checked={settings.androidGuestPaceMode !== false}
            onChange={settings.setAndroidGuestPaceMode}
          />
        </div>
      </DeckModule>

      <DeckModule label={t("settings.exportFolder")} delay={90}>
        <DeckStorageRow
          icon="folder"
          title={t("settings.exportFolder")}
          path={exportLabel}
          onClick={() => setExportOpen(true)}
        />
      </DeckModule>

      <DeckModule label="YouTube" delay={120}>
        <div className="a-deck-badges" style={{ marginBottom: 12 }}>
          <span
            className={`a-chip ${cookieStatus?.authenticated ? "is-active" : ""}`}
          >
            {cookieBadgeLabel}
          </span>
          {cookieAgeLabel ? (
            <span className="a-chip">{cookieAgeLabel}</span>
          ) : null}
        </div>
        <p className="a-deck-note">{t("settings.youtubeHintAndroid")}</p>
        <DeckActionGrid
          items={[
            {
              icon: "login",
              label: t("settings.youtubeSignIn"),
              onClick: () => void handleYoutubeLogin(),
            },
            {
              icon: "menu_book",
              label: t("settings.youtubeCookieGuide"),
              onClick: () => setCookieGuideOpen(true),
            },
            {
              icon: "cookie",
              label: t("settings.youtubeImportCookies"),
              onClick: () => void handleImportCookies(),
            },
            {
              icon: "refresh",
              label: t("settings.youtubeRefreshCookies"),
              onClick: () => void handleRefreshCookies(),
            },
          ]}
        />
      </DeckModule>

      <DeckModule label={t("settings.androidSystem")} delay={135}>
        <p className="a-deck-note">{t("settings.batteryHint")}</p>
        <DeckActionGrid
          items={[
            {
              icon: "battery_charging_full",
              label: t("settings.batteryGuide"),
              onClick: () => setBatteryGuideOpen(true),
            },
            {
              icon: "settings_suggest",
              label: t("settings.batterySettings"),
              onClick: () => void handleOpenBatterySettings(),
            },
          ]}
        />
      </DeckModule>

      <DeckModule label={t("settings.ytdlpEngine")} delay={140}>
        <p className="a-deck-note">
          {ytdlpUpdate
            ? t("settings.ytdlpVersionLine", {
                current: ytdlpUpdate.currentVersion,
                latest: ytdlpUpdate.latestVersion,
              })
            : t("settings.ytdlpVersionHint")}
        </p>
        <div className="a-deck-features" style={{ marginBottom: 12 }}>
          <DeckFeatureToggle
            kind="subs"
            title={t("settings.androidYtdlpAutoUpdate")}
            checked={settings.androidYtdlpAutoUpdate !== false}
            onChange={(checked) => {
              settings.setAndroidYtdlpAutoUpdate(checked);
              void pushQueueToOrchestrator();
            }}
          />
        </div>
        <DeckActionBar
          icon="system_update"
          label={t("settings.ytdlpCheckUpdate")}
          disabled={ytdlpBusy}
          onClick={() => void handleCheckYtdlpUpdate()}
        />
        {ytdlpUpdate?.updateAvailable ? (
          <DeckActionBar
            icon="download"
            label={t("settings.ytdlpApplyUpdate")}
            disabled={ytdlpBusy}
            onClick={() => void handleApplyYtdlpUpdate()}
          />
        ) : null}
      </DeckModule>

      <DeckEngineModule delay={150} />

      {message ? <DeckToast message={message} ok={messageOk} /> : null}

      <AndroidBottomSheet
        open={cookieGuideOpen}
        title={t("settings.youtubeCookieGuide")}
        onClose={() => setCookieGuideOpen(false)}
        footer={
          <button
            type="button"
            className="a-btn a-btn-block"
            onClick={() => setCookieGuideOpen(false)}
          >
            {t("settings.langDone")}
          </button>
        }
      >
        <div className="a-guide-sheet">
          <AndroidGuideIntro icon="cookie">
            {t("settings.youtubeCookieGuideIntro")}
          </AndroidGuideIntro>
          <AndroidGuideSteps steps={cookieGuideSteps} />
        </div>
      </AndroidBottomSheet>

      <AndroidBottomSheet
        open={batteryGuideOpen}
        title={t("settings.batteryGuide")}
        onClose={() => setBatteryGuideOpen(false)}
        footer={
          <div className="a-sheet-footer-stack">
            <button
              type="button"
              className="a-btn a-btn-block"
              onClick={() => void handleOpenBatterySettings()}
            >
              {t("settings.batterySettings")}
            </button>
            <button
              type="button"
              className="a-btn a-btn-block a-btn-tonal"
              onClick={() => setBatteryGuideOpen(false)}
            >
              {t("settings.langDone")}
            </button>
          </div>
        }
      >
        <div className="a-guide-sheet">
          <AndroidGuideIntro icon="battery_alert">
            {t("settings.batteryGuideIntro")}
          </AndroidGuideIntro>
          <AndroidGuideOemCards cards={batteryOemCards} />
          <AndroidGuideTip
            icon="settings_suggest"
            title={t("settings.batteryGuideFinalTitle")}
            body={t("settings.batteryGuideFinalBody")}
            actionLabel={t("settings.batterySettings")}
            onClick={() => void handleOpenBatterySettings()}
          />
        </div>
      </AndroidBottomSheet>

      <AndroidBottomSheet
        open={exportOpen}
        title={t("settings.exportFolder")}
        onClose={() => setExportOpen(false)}
        footer={
          <button type="button" className="a-btn a-btn-block" onClick={() => setExportOpen(false)}>
            {t("settings.langDone")}
          </button>
        }
      >
        <div className="a-sheet-list">
          <button type="button" className="a-sheet-row" onClick={() => void handleClearExport()}>
            <span className="a-icon-well">
              <span className="material-symbols-rounded">download</span>
            </span>
            <span className="a-sheet-row-text">
              <span className="a-sheet-row-label">{t("settings.exportFolderUsePublic")}</span>
              <small className="a-sheet-row-sub">{t("settings.exportFolderPublic")}</small>
            </span>
            <span className="material-symbols-rounded a-sheet-check">chevron_right</span>
          </button>
        </div>
      </AndroidBottomSheet>
    </div>
  );
}
