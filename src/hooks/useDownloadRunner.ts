import { useEffect, useRef, type MutableRefObject } from "react";
import { translate } from "../i18n/translate";
import {
  buildOrchestratorSyncKey,
  cancelOrchestratorJob,
  ensureDownloadService,
  logAndroid,
  mergeOrchestratorState,
  onQueueState,
  pullOrchestratorState,
  requeueFailedBotItems,
  requestNotificationPermission,
  setOrchestratorMergeNotifier,
  syncOrchestratorQueue,
  type MergeTransition,
} from "../lib/androidDownload";
import { exportDownloadedFile } from "../lib/androidStorage";
import { isYoutubeBotError, isYoutubeUrl } from "../lib/errors";
import {
  recordCompletedDownload,
  syncHistoryFromQueueItems,
} from "../lib/historySync";
import { isAndroidClient } from "../lib/platform";
import {
  cancelDownload,
  isTauri,
  onDownloadProgress,
  refreshYoutubeCookies,
  startDownload,
} from "../lib/tauri";
import { qualityToFormat } from "../lib/format";
import { useHistoryStore } from "../store/history";
import { useNotificationsStore } from "../store/notifications";
import { useQueueStore } from "../store/queue";
import { useSettingsStore } from "../store/settings";
import type { AppSettings, QueueItem } from "../types";

const MAX_BOT_RETRIES = 3;
const BOT_BACKOFF_MS = [30_000, 90_000, 180_000] as const;
const JITTER_MIN_MS = 2_000;
const JITTER_MAX_MS = 5_000;
const SAFE_BULK_PAUSE_MS = 60_000;

/** True when Kotlin already exported to public Downloads or SAF. */
function isAndroidExportedPath(path: string): boolean {
  return (
    path.startsWith("content://") ||
    path.startsWith("/storage/") ||
    path.startsWith("file:///storage/")
  );
}

/** True when path is app-private yt-dlp staging (needs export fallback). */
function isAppStagingPath(path: string): boolean {
  return (
    path.includes("/AcornDownloads/") &&
    (path.startsWith("/data/user/") || path.startsWith("/data/data/"))
  );
}

/** True when Rust/Kotlin already ran export (public or SAF). */
function isAlreadyExported(
  savedAs: string | null | undefined,
  exportMode: string | null | undefined,
): boolean {
  if (exportMode === "public" || exportMode === "saf") return true;
  return savedAs != null && isAndroidExportedPath(savedAs);
}

/** Fire a success toast once per download id. */
function notifySuccess(id: string, notified: Set<string>) {
  const key = `${id}:ok`;
  if (notified.has(key)) return;
  notified.add(key);
  useNotificationsStore.getState().pushSuccess();
}

/** Fire an error toast once per download id. */
function notifyError(id: string, notified: Set<string>) {
  const key = `${id}:err`;
  if (notified.has(key)) return;
  notified.add(key);
  useNotificationsStore.getState().pushError();
}

/** Pause between download attempts. */
function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Random delay between successful Android YouTube downloads. */
function jitterMs(): number {
  return (
    JITTER_MIN_MS +
    Math.floor(Math.random() * (JITTER_MAX_MS - JITTER_MIN_MS + 1))
  );
}

/** Backoff duration after consecutive playlist-wide bot errors. */
function botBackoffMs(streak: number): number {
  const idx = Math.min(Math.max(streak - 1, 0), BOT_BACKOFF_MS.length - 1);
  return BOT_BACKOFF_MS[idx];
}

/** True when Android may silently retry after a YouTube bot error. */
function maySilentBotRetry(
  item: QueueItem,
  retryCounts: Map<string, number>,
): boolean {
  return (
    isAndroidClient() &&
    isYoutubeUrl(item.url) &&
    (retryCounts.get(item.id) ?? item.retryCount ?? 0) < MAX_BOT_RETRIES
  );
}

/** Re-queue one item after refreshing cookies and exponential backoff. */
async function scheduleSilentBotRetry(
  item: QueueItem,
  retryCounts: Map<string, number>,
  globalBotStreak: { current: number },
  updateItem: (id: string, patch: Partial<QueueItem>) => void,
): Promise<boolean> {
  if (!maySilentBotRetry(item, retryCounts)) return false;
  const attempt = (retryCounts.get(item.id) ?? item.retryCount ?? 0) + 1;
  retryCounts.set(item.id, attempt);
  globalBotStreak.current += 1;
  const waitMs = botBackoffMs(globalBotStreak.current);
  try {
    await refreshYoutubeCookies(true);
  } catch {
    // Best-effort cookie refresh; retry download anyway.
  }
  await sleep(waitMs);
  updateItem(item.id, {
    status: "queued",
    error: null,
    percent: 0,
    speed: null,
    eta: null,
    retryCount: attempt,
  });
  return true;
}

/** Re-queue failed bot items when the main queue is drained (round-robin recovery). */
function recoverFailedBotItems(
  retryCounts: Map<string, number>,
  updateItem: (id: string, patch: Partial<QueueItem>) => void,
): boolean {
  if (!isAndroidClient()) return false;
  const failed = useQueueStore
    .getState()
    .items.filter(
      (item) =>
        item.status === "error" &&
        isYoutubeUrl(item.url) &&
        isYoutubeBotError(item.error ?? "") &&
        (retryCounts.get(item.id) ?? item.retryCount ?? 0) < MAX_BOT_RETRIES,
    );
  if (failed.length === 0) return false;
  for (const item of failed) {
    updateItem(item.id, {
      status: "queued",
      error: null,
      percent: 0,
      speed: null,
      eta: null,
    });
  }
  return true;
}

/** Pre-download pacing for Android bulk playlists (desktop JS pump only). */
async function applyPreDownloadPacing(
  settings: AppSettings,
  successCount: number,
  pausedUntil: MutableRefObject<number>,
): Promise<void> {
  if (!isAndroidClient()) return;
  const now = Date.now();
  if (pausedUntil.current > now) {
    await sleep(pausedUntil.current - now);
  }
  const rotateEvery = settings.androidCookieRotateInterval ?? 15;
  if (
    successCount > 0 &&
    successCount % rotateEvery === 0 &&
    !settings.cookiesFile
  ) {
    try {
      await refreshYoutubeCookies(true);
    } catch {
      // Best-effort periodic guest cookie rotation.
    }
  }
}

/** Post-success pacing before the next queue item (desktop JS pump only). */
async function applyPostSuccessPacing(
  settings: AppSettings,
  successCount: number,
  pausedUntil: MutableRefObject<number>,
): Promise<void> {
  if (!isAndroidClient()) return;
  if (settings.androidDownloadJitter !== false) {
    await sleep(jitterMs());
  }
  const interval = settings.androidSafeBulkInterval ?? 10;
  if (
    settings.androidSafeBulkMode &&
    successCount > 0 &&
    successCount % interval === 0
  ) {
    try {
      await refreshYoutubeCookies(true);
    } catch {
      // Best-effort refresh during safe-bulk pause.
    }
    pausedUntil.current = Date.now() + SAFE_BULK_PAUSE_MS;
    await sleep(SAFE_BULK_PAUSE_MS);
  }
}

/** Push current React queue/settings to Kotlin orchestrator. */
export async function pushQueueToOrchestrator(): Promise<void> {
  if (!isTauri() || !isAndroidClient()) return;
  const { items, activeId } = useQueueStore.getState();
  const settings = useSettingsStore.getState();
  await ensureDownloadService();
  await syncOrchestratorQueue({
    items,
    settings: {
      outputDir: settings.outputDir,
      cookiesFile: settings.cookiesFile,
      androidDownloadJitter: settings.androidDownloadJitter,
      androidSafeBulkMode: settings.androidSafeBulkMode,
      androidSafeBulkInterval: settings.androidSafeBulkInterval,
      androidCookieRotateInterval: settings.androidCookieRotateInterval,
      androidGuestPaceMode: settings.androidGuestPaceMode,
      androidYtdlpAutoUpdate: settings.androidYtdlpAutoUpdate,
    },
    activeId,
  });
}

/** Process the download queue sequentially and sync progress events. */
export function useDownloadRunner() {
  const running = useRef(false);
  const notified = useRef(new Set<string>());
  const botRetryCounts = useRef(new Map<string, number>());
  const globalBotStreak = useRef(0);
  const successCount = useRef(0);
  const pausedUntil = useRef(0);
  const androidServiceReady = useRef(false);
  const lastOrchestratorSyncKey = useRef("");
  const cookiesFile = useSettingsStore((s) => s.cookiesFile);
  const androidDownloadJitter = useSettingsStore((s) => s.androidDownloadJitter);
  const androidSafeBulkMode = useSettingsStore((s) => s.androidSafeBulkMode);
  const androidSafeBulkInterval = useSettingsStore((s) => s.androidSafeBulkInterval);
  const androidCookieRotateInterval = useSettingsStore(
    (s) => s.androidCookieRotateInterval,
  );
  const androidGuestPaceMode = useSettingsStore((s) => s.androidGuestPaceMode);
  const androidYtdlpAutoUpdate = useSettingsStore((s) => s.androidYtdlpAutoUpdate);
  const outputDir = useSettingsStore((s) => s.outputDir);
  const items = useQueueStore((s) => s.items);
  const activeId = useQueueStore((s) => s.activeId);
  const updateItem = useQueueStore((s) => s.updateItem);
  const setActiveId = useQueueStore((s) => s.setActiveId);
  const nextQueued = useQueueStore((s) => s.nextQueued);

  /** Backfill history from persisted completed queue rows on Android cold start. */
  useEffect(() => {
    if (!isAndroidClient()) return;
    syncHistoryFromQueueItems(useQueueStore.getState().items);
  }, []);

  // Subscribe once — avoid missing completed/error events on effect re-runs.
  useEffect(() => {
    if (!isTauri()) return;

    let active = true;
    let unlistenProgress: (() => void) | undefined;
    let unlistenQueue: (() => void) | undefined;

    onDownloadProgress((progress) => {
      useQueueStore.getState().applyProgress(progress);

      if (isAndroidClient()) {
        void logAndroid(
          "DownloadProgress",
          `id=${progress.id} status=${progress.status} pct=${progress.percent ?? 0}`,
        );
      }

      const item = useQueueStore
        .getState()
        .items.find((i) => i.id === progress.id);

      if (progress.status === "completed") {
        const savedAs = progress.filename ?? item?.filename;
        const exported =
          !savedAs ||
          isAlreadyExported(savedAs, progress.exportMode) ||
          !isAndroidClient();

        if (exported) {
          notifySuccess(progress.id, notified.current);
        }

        if (item && exported) {
          void recordCompletedDownload(item, savedAs);
        } else if (isAndroidClient() && !item) {
          void pullOrchestratorState();
        }

        if (
          isAndroidClient() &&
          savedAs &&
          isAppStagingPath(savedAs) &&
          !isAlreadyExported(savedAs, progress.exportMode) &&
          item
        ) {
          void exportDownloadedFile(savedAs)
            .then((dest) => {
              if (!isAndroidExportedPath(dest)) {
                throw new Error("export failed");
              }
              notifySuccess(progress.id, notified.current);
              void recordCompletedDownload(item, dest);
            })
            .catch(() => {
              notified.current.delete(`${progress.id}:ok`);
              notifyError(progress.id, notified.current);
              useHistoryStore.getState().remove(item.id);
            });
        }
      }

      if (progress.status === "error") {
        const errItem = useQueueStore
          .getState()
          .items.find((i) => i.id === progress.id);
        const retries =
          botRetryCounts.current.get(progress.id) ??
          errItem?.retryCount ??
          0;
        const deferBotToast =
          isAndroidClient() &&
          errItem != null &&
          isYoutubeUrl(errItem.url) &&
          isYoutubeBotError(progress.error ?? "") &&
          retries < MAX_BOT_RETRIES;
        if (!deferBotToast) {
          notifyError(progress.id, notified.current);
        }
      }
    }).then((fn) => {
      if (!active) {
        fn();
        return;
      }
      unlistenProgress = fn;
    });

    if (isAndroidClient()) {
      const handleMergeTransitions = (transitions: MergeTransition[]) => {
        for (const { from, to, item } of transitions) {
          if (to === "completed" && from !== "completed") {
            notifySuccess(item.id, notified.current);
            const savedAs = item.filename;
            if (savedAs) {
              void recordCompletedDownload(item, savedAs);
            }
          }
          if (to === "error" && from !== "error") {
            const retries =
              botRetryCounts.current.get(item.id) ?? item.retryCount ?? 0;
            const deferBotToast =
              isYoutubeUrl(item.url) &&
              isYoutubeBotError(item.error ?? "") &&
              retries < MAX_BOT_RETRIES;
            if (!deferBotToast) {
              notifyError(item.id, notified.current);
            }
          }
        }
      };

      setOrchestratorMergeNotifier(handleMergeTransitions);

      void (async () => {
        await requestNotificationPermission();
        await ensureDownloadService();
        androidServiceReady.current = true;
      })();
      onQueueState(mergeOrchestratorState).then((fn) => {
        if (!active) {
          fn();
          return;
        }
        unlistenQueue = fn;
      });
    }

    return () => {
      active = false;
      if (isAndroidClient()) {
        setOrchestratorMergeNotifier(null);
      }
      unlistenProgress?.();
      unlistenQueue?.();
    };
  }, []);

  // Android: sync queue composition to native orchestrator (not status — native owns that).
  useEffect(() => {
    if (!isTauri() || !isAndroidClient()) return;

    const settingsSnapshot = {
      outputDir,
      cookiesFile,
      androidDownloadJitter,
      androidSafeBulkMode,
      androidSafeBulkInterval,
      androidCookieRotateInterval,
      androidGuestPaceMode,
      androidYtdlpAutoUpdate,
    };
    const syncKey = buildOrchestratorSyncKey(items, settingsSnapshot);
    if (syncKey === lastOrchestratorSyncKey.current) return;
    lastOrchestratorSyncKey.current = syncKey;

    void (async () => {
      if (!androidServiceReady.current) {
        await ensureDownloadService();
        androidServiceReady.current = true;
      }
      await syncOrchestratorQueue({
        items,
        settings: settingsSnapshot,
        activeId,
        globalBotStreak: globalBotStreak.current,
        successCount: successCount.current,
        pausedUntil: pausedUntil.current,
      });
    })();
  }, [
    items,
    outputDir,
    cookiesFile,
    androidDownloadJitter,
    androidSafeBulkMode,
    androidSafeBulkInterval,
    androidCookieRotateInterval,
    androidGuestPaceMode,
    androidYtdlpAutoUpdate,
  ]);

  useEffect(() => {
    if (isAndroidClient()) return;

    /** Start the next queued item when idle (desktop only). */
    async function pump() {
      if (running.current || activeId) return;
      if (!isTauri()) return;
      const settings = useSettingsStore.getState();
      let next = nextQueued();
      if (!next) {
        if (recoverFailedBotItems(botRetryCounts.current, updateItem)) {
          next = nextQueued();
        }
        if (!next) return;
      }

      running.current = true;
      await applyPreDownloadPacing(settings, successCount.current, pausedUntil);

      setActiveId(next.id);
      updateItem(next.id, { status: "downloading", percent: 0, error: null });

      try {
        await startDownload(toOptions(next, settings));
        const current = useQueueStore
          .getState()
          .items.find((item) => item.id === next.id);
        if (current?.status === "cancelled") {
          // no toast
        } else if (current?.status === "error") {
          const botErr = isYoutubeBotError(current.error ?? "");
          const retried =
            botErr &&
            (await scheduleSilentBotRetry(
              next,
              botRetryCounts.current,
              globalBotStreak,
              updateItem,
            ));
          if (!retried) {
            notifyError(next.id, notified.current);
          } else if (globalBotStreak.current >= MAX_BOT_RETRIES) {
            useNotificationsStore.getState().pushError();
          }
        } else {
          globalBotStreak.current = 0;
          successCount.current += 1;
          await applyPostSuccessPacing(
            settings,
            successCount.current,
            pausedUntil,
          );
          notifySuccess(next.id, notified.current);
          if (current?.status !== "completed") {
            updateItem(next.id, {
              status: "completed",
              percent: 100,
              error: null,
            });
          }
        }
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        if (
          isYoutubeBotError(message) &&
          (await scheduleSilentBotRetry(
            next,
            botRetryCounts.current,
            globalBotStreak,
            updateItem,
          ))
        ) {
          // Silent retry scheduled — no error toast yet.
        } else {
          updateItem(next.id, {
            status: "error",
            error: message,
          });
          notifyError(next.id, notified.current);
        }
      } finally {
        setActiveId(null);
        running.current = false;
      }
    }

    void pump();
  }, [items, activeId, nextQueued, setActiveId, updateItem]);
}

/** Convert a queue item into Rust download options. */
function toOptions(
  item: QueueItem,
  settings: {
    outputDir: string;
    ytdlpPath?: string | null;
    ffmpegPath?: string | null;
    cookiesFromBrowser?: string | null;
    cookiesFile?: string | null;
  },
) {
  const container = item.container || (item.audioOnly ? item.audioFormat : "mp4");
  return {
    id: item.id,
    url: item.url,
    format: item.audioOnly
      ? "bestaudio/best"
      : isAndroidClient()
        ? (item.format || "1080")
        : qualityToFormat(item.format || "1080", false),
    outputDir: settings.outputDir || "downloads",
    audioOnly: item.audioOnly,
    audioFormat: item.audioOnly ? container : item.audioFormat,
    container,
    writeSubs: item.writeSubs,
    subLangs: item.subLangs,
    writeThumbnail: item.writeThumbnail,
    ytdlpPath: settings.ytdlpPath,
    ffmpegPath: settings.ffmpegPath,
    cookiesFromBrowser: settings.cookiesFromBrowser,
    cookiesFile: settings.cookiesFile,
  };
}

/** Cancel the currently active download if present. */
export async function requestCancel(id: string) {
  if (!isTauri()) return;
  try {
    if (isAndroidClient()) {
      await cancelOrchestratorJob(id);
    } else {
      await cancelDownload(id);
    }
  } catch {
    // ignore missing process
  }
  useQueueStore.getState().updateItem(id, {
    status: "cancelled",
    error: translate("errors.userCancelled"),
  });
}

/** Re-queue all failed bot-blocked items via native orchestrator. */
export async function requestRequeueFailedBotItems() {
  if (!isAndroidClient() || !isTauri()) return;
  await requeueFailedBotItems();
}
