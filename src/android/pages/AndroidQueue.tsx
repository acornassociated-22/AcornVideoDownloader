import { useEffect, useState } from "react";
import logo from "../../assets/logo.svg";
import { ProgressRing } from "../../components/ProgressRing";
import { pushQueueToOrchestrator, requestCancel, requestRequeueFailedBotItems } from "../../hooks/useDownloadRunner";
import { useT } from "../../i18n/useT";
import type { MessageKey } from "../../i18n";
import {
  applyYtdlpUpdate,
  checkYtdlpUpdate,
  getOrchestratorPausedUntil,
  logAndroid,
  openYoutubeLogin,
  pauseActiveJob,
  pullOrchestratorState,
  resumeOrchestratorJob,
  retryOrchestratorJob,
  type YtdlpUpdateInfo,
} from "../../lib/androidDownload";
import {
  isEmptyDownloadError,
  isFfmpegMissingError,
  isHttp403Error,
  isExportError,
  isNetworkError,
  isOutputNotFoundError,
  isOutputPathError,
  isYoutubeAuthFailure,
  isYoutubeBotError,
  isYoutubeUnavailableError,
  isYoutubePremiereError,
  youtubePremiereWhen,
  isYoutubeUrl,
  normalizeQueueError,
} from "../../lib/errors";
import { getYoutubeCookieStatus, isTauri, refreshYoutubeCookies } from "../../lib/tauri";
import { useQueueStore } from "../../store/queue";
import { useSettingsStore } from "../../store/settings";
import { useUiStore } from "../../store/ui";
import type { QueueItem } from "../../types";
import { AndroidBottomSheet } from "../components/AndroidBottomSheet";
import { AndroidDialog } from "../components/AndroidDialog";

/** Map queue error text to a short user-facing message. */
function friendlyQueueError(
  raw: string | null | undefined,
  translate: (k: MessageKey, vars?: Record<string, string | number>) => string,
): string | undefined {
  if (!raw) return undefined;
  if (isFfmpegMissingError(raw)) return translate("errors.ffmpegMissing");
  if (isOutputNotFoundError(raw)) return translate("errors.outputNotFound");
  if (isExportError(raw)) return translate("errors.exportFailed");
  if (isOutputPathError(raw)) return translate("errors.outputPath");
  if (isYoutubeUnavailableError(raw)) return translate("errors.youtubeUnavailable");
  if (isYoutubePremiereError(raw)) {
    const when = youtubePremiereWhen(raw);
    return when
      ? translate("errors.youtubePremiere", { when })
      : translate("errors.youtubePremiereGeneric");
  }
  if (isEmptyDownloadError(raw)) return translate("errors.emptyDownload");
  if (isYoutubeBotError(raw) || isHttp403Error(raw)) {
    return translate("errors.youtubeBot");
  }
  if (isNetworkError(raw)) return translate("errors.networkDns");
  const first = raw.split(/\n/).map((s) => s.trim()).find(Boolean);
  if (first && first.length > 140) return `${first.slice(0, 137)}…`;
  return first ?? raw;
}

/** True when a queue row should display as failed (not actively downloading). */
function isQueueItemFailed(
  item: QueueItem,
  currentActiveId: string | null,
): boolean {
  const err = normalizeQueueError(item.error);
  if (item.status === "error") return true;
  return Boolean(err) && currentActiveId !== item.id;
}

/** Effective status for queue card chrome (bar, labels). */
function effectiveQueueStatus(
  item: QueueItem,
  currentActiveId: string | null,
): QueueItem["status"] {
  if (isQueueItemFailed(item, currentActiveId)) return "error";
  return item.status;
}

const STATUS_KEYS: Record<string, MessageKey> = {
  queued: "queue.status.queued",
  downloading: "queue.status.downloading",
  completed: "queue.status.completed",
  error: "queue.status.error",
  cancelled: "queue.status.cancelled",
  paused: "queue.status.paused",
};

const PHASE_KEYS: Record<string, MessageKey> = {
  download: "queue.phase.download",
  merge: "queue.phase.merge",
  convert: "queue.phase.convert",
  export: "queue.phase.export",
  finalize: "queue.phase.finalize",
};

/** User-facing label for the active download phase. */
function downloadPhaseLabel(
  item: QueueItem,
  translate: (k: MessageKey) => string,
): string | null {
  if (item.status !== "downloading" || !item.phase) return null;
  const key = PHASE_KEYS[item.phase];
  return key ? translate(key) : null;
}

/** True when post-download processing should show indeterminate progress. */
function isPostDownloadPhase(item: QueueItem): boolean {
  return (
    item.status === "downloading" &&
    item.phase != null &&
    item.phase !== "download"
  );
}

/** Primary status or phase label for queue cards and toolbar. */
function itemProgressLabel(
  item: QueueItem,
  currentActiveId: string | null,
  translate: (k: MessageKey) => string,
): string {
  const phase = downloadPhaseLabel(item, translate);
  if (phase) return phase;
  const displayStatus = effectiveQueueStatus(item, currentActiveId);
  return STATUS_KEYS[displayStatus]
    ? translate(STATUS_KEYS[displayStatus])
    : displayStatus;
}

/** Build the subtitle line for a queue card. */
function queueMetaLine(
  item: QueueItem,
  translate: (k: MessageKey) => string,
  currentActiveId: string | null,
): string {
  const parts: string[] = [];
  parts.push(itemProgressLabel(item, currentActiveId, translate));
  if (item.container) parts.push(item.container.toUpperCase());
  if (item.speed) parts.push(item.speed);
  if (item.eta) parts.push(item.eta);
  const err = normalizeQueueError(item.error);
  if (err) {
    parts.push(friendlyQueueError(err, translate) ?? err);
  }
  return parts.join(" · ");
}

/** True when the queue item looks like a YouTube bot / rate-limit failure. */
function isBotBlockedItem(item: QueueItem): boolean {
  const err = normalizeQueueError(item.error);
  if (!isYoutubeUrl(item.url) || !err) return false;
  if (item.status !== "error" && item.status !== "downloading") return false;
  return isYoutubeAuthFailure(err);
}

/** Format cooldown countdown for queue cards. */
function formatCooldownRemaining(
  until: number | undefined,
  now: number,
  translate: (k: MessageKey, vars?: Record<string, string | number>) => string,
): string | null {
  if (!until || until <= now) return null;
  const sec = Math.ceil((until - now) / 1000);
  return translate("queue.cooldownIn", { seconds: sec });
}

/** Android queue: premium cards with status toolbar actions. */
export function AndroidQueue() {
  const t = useT();
  const items = useQueueStore((s) => s.items);
  const activeId = useQueueStore((s) => s.activeId);
  const removeItem = useQueueStore((s) => s.removeItem);
  const clearFinished = useQueueStore((s) => s.clearFinished);
  const clearAll = useQueueStore((s) => s.clearAll);
  const updateItem = useQueueStore((s) => s.updateItem);
  const setPage = useUiStore((s) => s.setPage);
  const setAndroidSafeBulkMode = useSettingsStore((s) => s.setAndroidSafeBulkMode);
  const androidGuestPaceMode = useSettingsStore((s) => s.androidGuestPaceMode);
  const [confirmClear, setConfirmClear] = useState(false);
  const [botHelpItem, setBotHelpItem] = useState<QueueItem | null>(null);
  const [botActionBusy, setBotActionBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [requeueBusy, setRequeueBusy] = useState(false);
  const [ytdlpUpdate, setYtdlpUpdate] = useState<YtdlpUpdateInfo | null>(null);
  const [ytdlpUpdateBusy, setYtdlpUpdateBusy] = useState(false);
  const [ytdlpBannerDismissed, setYtdlpBannerDismissed] = useState(false);
  const [showLoginNudge, setShowLoginNudge] = useState(false);
  const [cookieAuthenticated, setCookieAuthenticated] = useState<boolean | null>(null);
  const [ytdlpFeedback, setYtdlpFeedback] = useState<string | null>(null);
  const [itemActionBusy, setItemActionBusy] = useState<string | null>(null);

  /** Pause the currently downloading item. */
  async function handlePauseItem(id: string) {
    setItemActionBusy(id);
    updateItem(id, { status: "paused", phase: null });
    if (useQueueStore.getState().activeId === id) {
      useQueueStore.getState().setActiveId(null);
    }
    try {
      await pauseActiveJob();
      await pullOrchestratorState();
    } finally {
      setItemActionBusy(null);
    }
  }

  /** Resume a paused item. */
  async function handleResumeItem(id: string) {
    setItemActionBusy(id);
    updateItem(id, { status: "queued", error: null, phase: null });
    try {
      await resumeOrchestratorJob(id);
      await pullOrchestratorState();
    } finally {
      setItemActionBusy(null);
    }
  }

  /** Restart a downloading or paused item from scratch. */
  async function handleRetryItem(id: string) {
    setItemActionBusy(id);
    try {
      await retryOrchestratorJob(id);
      await pullOrchestratorState();
    } finally {
      setItemActionBusy(null);
    }
  }

  useEffect(() => {
    if (!isTauri()) return;

    void logAndroid("AndroidQueue", "mount — initial orchestrator pull");
    void pullOrchestratorState();

    const interval = window.setInterval(() => {
      const snapshot = useQueueStore.getState();
      const hasActiveWork =
        snapshot.activeId != null ||
        snapshot.items.some(
          (item) =>
            item.status === "queued" ||
            item.status === "downloading" ||
            item.status === "paused",
        );
      if (!hasActiveWork) return;
      void pullOrchestratorState().then(() => {
        const count = useQueueStore.getState().items.length;
        void logAndroid(
          "AndroidQueue",
          `poll items=${count} active=${useQueueStore.getState().activeId ?? "none"}`,
        );
      });
    }, 2000);

    return () => window.clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    if (sessionStorage.getItem("acorn-ytdlp-check")) return;

    const timer = window.setTimeout(() => {
      const snapshot = useQueueStore.getState();
      const queueIdle =
        snapshot.items.length === 0 &&
        snapshot.activeId == null &&
        !snapshot.items.some(
          (item) => item.status === "downloading" || item.status === "paused",
        );
      if (!queueIdle) return;
      sessionStorage.setItem("acorn-ytdlp-check", "1");
      void logAndroid("AndroidQueue", "deferred ytdlp check start");
      void checkYtdlpUpdate()
        .then(async (info) => {
          void logAndroid(
            "AndroidQueue",
            `deferred ytdlp check available=${info.updateAvailable} latest=${info.latestVersion}`,
          );
          const autoUpdate =
            useSettingsStore.getState().androidYtdlpAutoUpdate !== false;
          if (info.updateAvailable && autoUpdate) {
            void logAndroid("AndroidQueue", "deferred ytdlp auto-apply start");
            try {
              const result = await applyYtdlpUpdate();
              void logAndroid(
                "AndroidQueue",
                `deferred ytdlp auto-apply success=${result.success} version=${result.version ?? ""}`,
              );
              if (result.success) {
                setYtdlpFeedback(
                  t("settings.ytdlpUpdated", { version: result.version ?? "" }),
                );
                const refreshed = await checkYtdlpUpdate();
                setYtdlpUpdate(refreshed);
                if (!refreshed.updateAvailable) setYtdlpBannerDismissed(true);
                return;
              }
            } catch (err) {
              void logAndroid(
                "AndroidQueue",
                `deferred ytdlp auto-apply failed: ${err instanceof Error ? err.message : String(err)}`,
              );
            }
          }
          setYtdlpUpdate(info);
        })
        .catch((err) => {
          void logAndroid(
            "AndroidQueue",
            `deferred ytdlp check failed: ${err instanceof Error ? err.message : String(err)}`,
          );
        });
    }, 60_000);

    return () => window.clearTimeout(timer);
  }, []);

  useEffect(() => {
    if (!isTauri()) return;
    const hasBotSignal = items.some(
      (item) =>
        isBotBlockedItem(item) ||
        (Boolean(item.error) &&
          isYoutubeUrl(item.url) &&
          isYoutubeAuthFailure(item.error ?? "")) ||
        ((item.retryCount ?? 0) > 0 && isYoutubeUrl(item.url)) ||
        (item.cooldownUntil != null && item.cooldownUntil > now),
    );
    if (!hasBotSignal) {
      setShowLoginNudge(false);
      return;
    }
    void getYoutubeCookieStatus()
      .then((status) => {
        setCookieAuthenticated(status.authenticated);
        setShowLoginNudge(!status.authenticated);
      })
      .catch(() => setShowLoginNudge(false));
  }, [items, now]);

  useEffect(() => {
    if (!isTauri()) return;
    void getYoutubeCookieStatus()
      .then((status) => setCookieAuthenticated(status.authenticated))
      .catch(() => setCookieAuthenticated(null));
  }, []);

  /** Apply yt-dlp script update from queue banner. */
  async function handleYtdlpUpdateFromBanner() {
    void logAndroid("AndroidQueue", "ytdlp update button tapped");
    setYtdlpUpdateBusy(true);
    setYtdlpFeedback(null);
    try {
      const result = await applyYtdlpUpdate();
      if (result.success) {
        setYtdlpFeedback(
          t("settings.ytdlpUpdated", { version: result.version ?? "" }),
        );
        const info = await checkYtdlpUpdate();
        setYtdlpUpdate(info);
        if (!info.updateAvailable) setYtdlpBannerDismissed(true);
      } else {
        setYtdlpFeedback(result.error ?? t("settings.ytdlpUpdateFailed"));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      void logAndroid("AndroidQueue", `ytdlp update error: ${msg}`);
      setYtdlpFeedback(msg);
    } finally {
      setYtdlpUpdateBusy(false);
    }
  }

  useEffect(() => {
    const hasCooldown = items.some(
      (item) => item.cooldownUntil && item.cooldownUntil > Date.now(),
    );
    const globalPause = getOrchestratorPausedUntil() > Date.now();
    if (!hasCooldown && !globalPause) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [items]);

  /** Cancel active download (if any) and empty the whole queue. */
  async function handleClearAll() {
    if (activeId) {
      await requestCancel(activeId);
    }
    clearAll();
    await pushQueueToOrchestrator();
    setConfirmClear(false);
  }

  /** Remove completed, failed, and cancelled rows from the queue. */
  async function handleClearFinished() {
    clearFinished();
    await pushQueueToOrchestrator();
  }

  /** Cancel one active download. */
  function handleCancel(id: string) {
    void requestCancel(id);
  }

  /** Mark a waiting job as cancelled. */
  async function handleRemoveQueued(id: string) {
    updateItem(id, {
      status: "cancelled",
      error: t("queue.removed"),
    });
    await pushQueueToOrchestrator();
  }

  /** Re-queue a bot-blocked item after refreshing cookies. */
  async function handleBotRetry(item: QueueItem) {
    setBotActionBusy(true);
    try {
      await refreshYoutubeCookies(true);
      updateItem(item.id, {
        status: "queued",
        error: null,
        percent: 0,
        speed: null,
        eta: null,
      });
      await pushQueueToOrchestrator();
      setBotHelpItem(null);
    } finally {
      setBotActionBusy(false);
    }
  }

  /** Enable safe bulk mode and re-queue the failed item. */
  function handleEnableSafeMode(item: QueueItem) {
    setAndroidSafeBulkMode(true);
    updateItem(item.id, {
      status: "queued",
      error: null,
      percent: 0,
      speed: null,
      eta: null,
    });
    setBotHelpItem(null);
  }

  /** Render the bottom toolbar for a queue item. */
  function renderToolbar(item: QueueItem) {
    const busy = itemActionBusy === item.id;
    const failed = isQueueItemFailed(item, activeId);

    if (failed) {
      if (isBotBlockedItem(item)) {
        return (
          <div className="a-queue-toolbar a-queue-toolbar--2" role="toolbar">
            <button
              type="button"
              className="a-history-tool a-history-tool--replay"
              disabled={busy}
              onClick={() => void handleRetryItem(item.id)}
              aria-label={t("queue.retry")}
            >
              <span className="a-history-tool__icon material-symbols-rounded">replay</span>
              <span className="a-history-tool__label">{t("queue.retry")}</span>
            </button>
            <button
              type="button"
              className="a-history-tool a-history-tool--replay"
              onClick={() => setBotHelpItem(item)}
            >
              <span className="a-history-tool__icon material-symbols-rounded">help</span>
              <span className="a-history-tool__label">{t("queue.botSheet.help")}</span>
            </button>
            <button
              type="button"
              className="a-history-tool a-history-tool--dismiss"
              onClick={() => removeItem(item.id)}
              aria-label={t("queue.close")}
            >
              <span className="a-history-tool__icon material-symbols-rounded">close</span>
              <span className="a-history-tool__label">{t("queue.close")}</span>
            </button>
          </div>
        );
      }
      return (
        <div className="a-queue-toolbar a-queue-toolbar--2" role="toolbar">
          <button
            type="button"
            className="a-history-tool a-history-tool--replay"
            disabled={busy}
            onClick={() => void handleRetryItem(item.id)}
            aria-label={t("queue.retry")}
          >
            <span className="a-history-tool__icon material-symbols-rounded">replay</span>
            <span className="a-history-tool__label">{t("queue.retry")}</span>
          </button>
          <button
            type="button"
            className="a-history-tool a-history-tool--dismiss"
            onClick={() => removeItem(item.id)}
            aria-label={t("queue.close")}
          >
            <span className="a-history-tool__icon material-symbols-rounded">close</span>
            <span className="a-history-tool__label">{t("queue.close")}</span>
          </button>
        </div>
      );
    }

    if (item.status === "downloading") {
      return (
        <div className="a-queue-toolbar a-queue-toolbar--3" role="toolbar">
          <div className="a-queue-stat" aria-live="polite">
            <ProgressRing percent={item.percent} />
            <span className="a-queue-stat__label">
              {itemProgressLabel(item, activeId, t)}
            </span>
          </div>
          <button
            type="button"
            className="a-history-tool a-history-tool--pause"
            disabled={busy}
            onClick={() => void handlePauseItem(item.id)}
            aria-label={t("queue.pause")}
          >
            <span className="a-history-tool__icon material-symbols-rounded">pause</span>
            <span className="a-history-tool__label">{t("queue.pause")}</span>
          </button>
          <button
            type="button"
            className="a-history-tool a-history-tool--cancel"
            disabled={busy}
            onClick={() => handleCancel(item.id)}
            aria-label={t("queue.cancel")}
          >
            <span className="a-history-tool__icon material-symbols-rounded">close</span>
            <span className="a-history-tool__label">{t("queue.cancel")}</span>
          </button>
        </div>
      );
    }

    if (item.status === "paused") {
      return (
        <div className="a-queue-toolbar a-queue-toolbar--4" role="toolbar">
          <div className="a-queue-stat" aria-live="polite">
            <ProgressRing percent={item.percent} />
            <span className="a-queue-stat__label">
              {t("queue.status.paused")}
            </span>
          </div>
          <button
            type="button"
            className="a-history-tool a-history-tool--replay"
            disabled={busy}
            onClick={() => void handleResumeItem(item.id)}
            aria-label={t("queue.resume")}
          >
            <span className="a-history-tool__icon material-symbols-rounded">play_arrow</span>
            <span className="a-history-tool__label">{t("queue.resume")}</span>
          </button>
          <button
            type="button"
            className="a-history-tool a-history-tool--replay"
            disabled={busy}
            onClick={() => void handleRetryItem(item.id)}
            aria-label={t("queue.retry")}
          >
            <span className="a-history-tool__icon material-symbols-rounded">replay</span>
            <span className="a-history-tool__label">{t("queue.retry")}</span>
          </button>
          <button
            type="button"
            className="a-history-tool a-history-tool--cancel"
            disabled={busy}
            onClick={() => handleCancel(item.id)}
            aria-label={t("queue.cancel")}
          >
            <span className="a-history-tool__icon material-symbols-rounded">close</span>
            <span className="a-history-tool__label">{t("queue.cancel")}</span>
          </button>
        </div>
      );
    }

    if (item.status === "queued") {
      return (
        <div className="a-queue-toolbar a-queue-toolbar--1" role="toolbar">
          <button
            type="button"
            className="a-history-tool a-history-tool--delete"
            onClick={() => void handleRemoveQueued(item.id)}
            aria-label={t("queue.remove")}
          >
            <span className="a-history-tool__icon material-symbols-rounded">delete</span>
            <span className="a-history-tool__label">{t("queue.remove")}</span>
          </button>
        </div>
      );
    }

    if (isBotBlockedItem(item)) {
      return (
        <div className="a-queue-toolbar a-queue-toolbar--2" role="toolbar">
          <button
            type="button"
            className="a-history-tool a-history-tool--replay"
            onClick={() => setBotHelpItem(item)}
          >
            <span className="a-history-tool__icon material-symbols-rounded">help</span>
            <span className="a-history-tool__label">{t("queue.botSheet.help")}</span>
          </button>
          <button
            type="button"
            className="a-history-tool a-history-tool--dismiss"
            onClick={() => removeItem(item.id)}
            aria-label={t("queue.close")}
          >
            <span className="a-history-tool__icon material-symbols-rounded">close</span>
            <span className="a-history-tool__label">{t("queue.close")}</span>
          </button>
        </div>
      );
    }

    return (
      <div className="a-queue-toolbar a-queue-toolbar--1" role="toolbar">
        <button
          type="button"
          className="a-history-tool a-history-tool--dismiss"
          onClick={() => removeItem(item.id)}
          aria-label={t("queue.close")}
        >
          <span className="a-history-tool__icon material-symbols-rounded">close</span>
          <span className="a-history-tool__label">{t("queue.close")}</span>
        </button>
      </div>
    );
  }

  const completedCount = items.filter((item) => item.status === "completed").length;
  const queuedCount = items.filter((item) => item.status === "queued").length;
  const errorCount = items.filter(
    (item) => item.status === "error" || isQueueItemFailed(item, activeId),
  ).length;
  const retryPendingCount = items.filter(
    (item) => item.status === "error" && isBotBlockedItem(item),
  ).length;
  const finishedCount = items.filter(
    (item) =>
      item.status === "completed" ||
      item.status === "cancelled" ||
      item.status === "error",
  ).length;

  const hasActiveWork = items.some(
    (item) =>
      item.status === "queued" ||
      item.status === "downloading" ||
      item.status === "paused",
  );
  const showGuestPaceBanner =
    androidGuestPaceMode !== false &&
    cookieAuthenticated === false &&
    hasActiveWork;
  const globalPausedUntil = getOrchestratorPausedUntil();
  const globalCooldownLabel =
    globalPausedUntil > now
      ? t("queue.globalCooldown", {
          seconds: Math.ceil((globalPausedUntil - now) / 1000),
        })
      : null;

  /** Re-queue all bot-blocked failures via native orchestrator. */
  async function handleRequeueAllFailed() {
    setRequeueBusy(true);
    try {
      await requestRequeueFailedBotItems();
    } finally {
      setRequeueBusy(false);
    }
  }

  return (
    <div className="a-stack">
      <div className="a-page-head">
        <div>
          <h1 className="a-greeting">{t("queue.title")}</h1>
          <p className="a-section-sub">{t("queue.sub")}</p>
        </div>
      </div>

      {ytdlpUpdate?.updateAvailable && !ytdlpBannerDismissed ? (
        <div className="a-deck-module a-queue-summary" style={{ animationDelay: "10ms" }}>
          <p className="a-queue-summary__line">
            {t("queue.ytdlpUpdateBanner", { version: ytdlpUpdate.latestVersion })}
          </p>
          <div className="a-toolbar-btns" style={{ marginTop: 8 }}>
            <button
              type="button"
              className="a-btn a-btn-sm"
              disabled={ytdlpUpdateBusy}
              onClick={() => void handleYtdlpUpdateFromBanner()}
            >
              {ytdlpUpdateBusy ? "…" : t("queue.ytdlpUpdateAction")}
            </button>
            <button
              type="button"
              className="a-btn a-btn-ghost a-btn-sm"
              onClick={() => setYtdlpBannerDismissed(true)}
            >
              {t("queue.close")}
            </button>
          </div>
          {ytdlpFeedback ? (
            <p className="a-queue-summary__line" style={{ marginTop: 8, opacity: 0.9 }}>
              {ytdlpFeedback}
            </p>
          ) : null}
        </div>
      ) : null}

      {showLoginNudge ? (
        <div className="a-deck-module a-queue-summary" style={{ animationDelay: "15ms" }}>
          <p className="a-queue-summary__line">{t("queue.youtubeLoginNudge")}</p>
          <div className="a-toolbar-btns" style={{ marginTop: 8 }}>
            <button
              type="button"
              className="a-btn a-btn-sm"
              onClick={() => void openYoutubeLogin()}
            >
              {t("settings.youtubeSignIn")}
            </button>
          </div>
        </div>
      ) : null}

      {showGuestPaceBanner ? (
        <div className="a-deck-module a-queue-summary a-queue-summary--guest" style={{ animationDelay: "12ms" }}>
          <p className="a-queue-summary__line">{t("queue.guestPaceBanner")}</p>
        </div>
      ) : null}

      {items.length > 0 ? (
        <div className="a-deck-module a-queue-summary" style={{ animationDelay: "20ms" }}>
          <p className="a-queue-summary__line">
            {t("queue.summaryLine", {
              done: completedCount,
              total: items.length,
              queued: queuedCount,
              errors: errorCount,
            })}
          </p>
          {globalCooldownLabel ? (
            <p className="a-queue-summary__line a-queue-cooldown">{globalCooldownLabel}</p>
          ) : null}
        </div>
      ) : null}

      {items.length > 0 ? (
        <div className="a-deck-module a-queue-bulk" style={{ animationDelay: "25ms" }}>
          <div className="a-history-toolbar a-queue-bulk-toolbar" role="toolbar">
            {retryPendingCount > 0 ? (
              <button
                type="button"
                className="a-history-tool a-history-tool--replay"
                disabled={requeueBusy}
                onClick={() => void handleRequeueAllFailed()}
                aria-label={t("queue.requeueFailed")}
              >
                <span className="a-history-tool__icon material-symbols-rounded">
                  replay
                </span>
                <span className="a-history-tool__label">{t("queue.requeueFailed")}</span>
              </button>
            ) : null}
            {finishedCount > 0 ? (
              <button
                type="button"
                className="a-history-tool a-history-tool--dismiss"
                onClick={() => void handleClearFinished()}
                aria-label={t("queue.clearFinished")}
              >
                <span className="a-history-tool__icon material-symbols-rounded">
                  done_all
                </span>
                <span className="a-history-tool__label">{t("queue.clearFinished")}</span>
              </button>
            ) : null}
            <button
              type="button"
              className="a-history-tool a-history-tool--delete"
              onClick={() => setConfirmClear(true)}
              aria-label={t("queue.clearAll")}
            >
              <span className="a-history-tool__icon material-symbols-rounded">
                delete_forever
              </span>
              <span className="a-history-tool__label">{t("queue.clearAll")}</span>
            </button>
          </div>
        </div>
      ) : null}

      {items.length === 0 ? (
        <div className="a-empty">
          <div className="a-empty-logo">
            <img src={logo} alt="" />
          </div>
          <p>{t("queue.empty")}</p>
          <button type="button" className="a-btn" onClick={() => setPage("home")}>
            {t("nav.home")}
          </button>
        </div>
      ) : (
        <div className="a-stack">
          {items.map((item, index) => {
            const cardStatus = effectiveQueueStatus(item, activeId);
            const failed = isQueueItemFailed(item, activeId);
            const showProgress =
              !failed &&
              (item.status === "downloading" || item.percent > 0);
            const showIndeterminate =
              !failed &&
              item.status === "downloading" &&
              (isPostDownloadPhase(item) ||
                (item.percent === 0 && activeId === item.id));
            return (
            <article
              key={item.id}
              className="a-queue-card"
              style={{ animationDelay: `${Math.min(index, 8) * 45}ms` }}
            >
              <div className="a-queue-card__head">
                <span className={`a-media-bar is-${cardStatus}`} aria-hidden="true" />
                <div className="a-queue-card__thumb">
                  {item.thumbnail ? (
                    <img src={item.thumbnail} alt="" />
                  ) : (
                    <div className="a-thumb-fallback">
                      <span className="material-symbols-rounded">movie</span>
                    </div>
                  )}
                </div>
                <div className="a-queue-card__copy">
                  <strong>{item.title}</strong>
                  <small className={failed ? "a-queue-card__copy--error" : undefined}>
                    {queueMetaLine(item, t, activeId)}
                  </small>
                  {formatCooldownRemaining(item.cooldownUntil, now, t) ? (
                    <small className="a-queue-cooldown">
                      {formatCooldownRemaining(item.cooldownUntil, now, t)}
                    </small>
                  ) : null}
                  {item.retryCount != null && item.retryCount > 0 ? (
                    <small className="a-queue-retry">
                      {item.status === "downloading" && !failed
                        ? t("queue.botRetrying")
                        : t("queue.retryAttempt", { count: item.retryCount })}
                    </small>
                  ) : null}
                  {showProgress ? (
                    <div
                      className={`a-progress${
                        showIndeterminate ? " is-indeterminate" : ""
                      }`}
                    >
                      {showIndeterminate ? (
                        <span className="a-progress-indeterminate" aria-hidden="true" />
                      ) : (
                        <span style={{ width: `${item.percent}%` }} />
                      )}
                    </div>
                  ) : null}
                </div>
              </div>
              {renderToolbar(item)}
            </article>
            );
          })}
        </div>
      )}

      <AndroidBottomSheet
        open={botHelpItem != null}
        title={t("queue.botSheet.title")}
        onClose={() => setBotHelpItem(null)}
        footer={
          <button
            type="button"
            className="a-btn a-btn-block"
            onClick={() => setBotHelpItem(null)}
          >
            {t("settings.langDone")}
          </button>
        }
      >
        <p className="a-deck-note a-sheet-guide">{t("queue.botSheet.body")}</p>
        <div className="a-sheet-list">
          <button
            type="button"
            className="a-sheet-row"
            disabled={botActionBusy || !botHelpItem}
            onClick={() => botHelpItem && void handleBotRetry(botHelpItem)}
          >
            <span className="a-icon-well">
              <span className="material-symbols-rounded">refresh</span>
            </span>
            <span className="a-sheet-row-text">
              <span className="a-sheet-row-label">{t("queue.botSheet.retry")}</span>
            </span>
          </button>
          <button
            type="button"
            className="a-sheet-row"
            disabled={!botHelpItem}
            onClick={() => botHelpItem && handleEnableSafeMode(botHelpItem)}
          >
            <span className="a-icon-well">
              <span className="material-symbols-rounded">shield</span>
            </span>
            <span className="a-sheet-row-text">
              <span className="a-sheet-row-label">{t("queue.botSheet.safeMode")}</span>
            </span>
          </button>
          <button
            type="button"
            className="a-sheet-row"
            onClick={() => {
              setBotHelpItem(null);
              setPage("settings");
            }}
          >
            <span className="a-icon-well">
              <span className="material-symbols-rounded">cookie</span>
            </span>
            <span className="a-sheet-row-text">
              <span className="a-sheet-row-label">{t("queue.botSheet.settings")}</span>
            </span>
          </button>
        </div>
      </AndroidBottomSheet>

      <AndroidDialog
        open={confirmClear}
        title={t("queue.clearAll")}
        message={t("queue.clearAllConfirm")}
        icon="delete_forever"
        tone="danger"
        cancelLabel={t("url.cancel")}
        confirmLabel={t("queue.clearAll")}
        onCancel={() => setConfirmClear(false)}
        onConfirm={() => void handleClearAll()}
      />
    </div>
  );
}
