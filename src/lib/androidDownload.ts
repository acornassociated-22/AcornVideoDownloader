import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { isAndroidClient } from "./platform";
import { syncHistoryFromQueueItems } from "./historySync";
import { useQueueStore } from "../store/queue";
import { useSettingsStore } from "../store/settings";
import type { AppSettings, QueueItem, QueueStatus } from "../types";
import { normalizeQueueError } from "./errors";

export interface OrchestratorSyncPayload {
  items: QueueItem[];
  settings: Partial<AppSettings>;
  activeId: string | null;
  globalBotStreak?: number;
  successCount?: number;
  pausedUntil?: number;
}

export interface NotificationPermissionResult {
  granted: boolean;
  requested?: boolean;
}

export interface PendingNavigation {
  sharedUrl?: string | null;
  openPage?: string | null;
}

export interface YtdlpUpdateInfo {
  currentVersion: string;
  latestVersion: string;
  updateAvailable: boolean;
  downloadUrl?: string | null;
  sha256?: string | null;
}

export interface ApplyYtdlpResult {
  success: boolean;
  version?: string;
  error?: string | null;
}

/** Fired when orchestrator merge changes item status (for toast notifications). */
export type MergeTransition = {
  id: string;
  from: QueueStatus;
  to: QueueStatus;
  item: QueueItem;
};

let onMergeTransitions: ((transitions: MergeTransition[]) => void) | null =
  null;

/** Register handler for status transitions after native queue merge. */
export function setOrchestratorMergeNotifier(
  fn: ((transitions: MergeTransition[]) => void) | null,
): void {
  onMergeTransitions = fn;
}

/** Native orchestrator user-pause flag (synced from queue-state JSON). */
let orchestratorPaused = false;
let orchestratorPausedUntil = 0;

export function isOrchestratorPaused(): boolean {
  return orchestratorPaused;
}

/** Global orchestrator cooldown (guest backoff / safe bulk). */
export function getOrchestratorPausedUntil(): number {
  return orchestratorPausedUntil;
}

/** Start foreground download service and restore orchestrator. */
export async function ensureDownloadService(): Promise<void> {
  return invoke("ensure_download_service");
}

/** Sync React queue to Kotlin DownloadOrchestrator. */
export async function syncOrchestratorQueue(
  payload: OrchestratorSyncPayload,
): Promise<void> {
  return invoke("sync_orchestrator_queue", { payload });
}

/** Read native orchestrator state JSON. */
export async function getOrchestratorState(): Promise<string> {
  return invoke<string>("get_orchestrator_state");
}

export async function pauseActiveJob(): Promise<void> {
  return invoke("pause_active_job");
}

export async function resumeOrchestratorJob(id: string): Promise<void> {
  return invoke("resume_orchestrator_job", { id });
}

export async function retryOrchestratorJob(id: string): Promise<void> {
  return invoke("retry_orchestrator_job", { id });
}

export async function pauseOrchestrator(): Promise<void> {
  return invoke("pause_orchestrator");
}

export async function resumeOrchestrator(): Promise<void> {
  return invoke("resume_orchestrator");
}

export async function cancelOrchestratorJob(id: string): Promise<void> {
  return invoke("cancel_orchestrator_job", { id });
}

export async function requeueFailedBotItems(): Promise<void> {
  return invoke("requeue_failed_bot_items");
}

export async function requestNotificationPermission(): Promise<NotificationPermissionResult> {
  return invoke<NotificationPermissionResult>("request_notification_permission");
}

export async function getPendingNavigation(): Promise<PendingNavigation> {
  return invoke<PendingNavigation>("get_pending_navigation");
}

export async function openYoutubeLogin(): Promise<void> {
  return invoke("open_youtube_login");
}

/** Write a debug line to Android logcat (no-op on desktop). */
export async function logAndroid(tag: string, message: string): Promise<void> {
  if (!isAndroidClient()) return;
  try {
    await invoke("android_log", { tag, message });
  } catch {
    console.log(`[Acorn/${tag}] ${message}`);
  }
}

export async function checkYtdlpUpdate(force = false): Promise<YtdlpUpdateInfo> {
  await logAndroid("YtdlpBridge", `checkYtdlpUpdate invoke force=${force}`);
  const info = await invoke<YtdlpUpdateInfo>("check_ytdlp_update", { force });
  await logAndroid(
    "YtdlpBridge",
    `checkYtdlpUpdate result current=${info.currentVersion} latest=${info.latestVersion} available=${info.updateAvailable}`,
  );
  return info;
}

export async function applyYtdlpUpdate(): Promise<ApplyYtdlpResult> {
  await logAndroid("YtdlpBridge", "applyYtdlpUpdate invoke");
  const result = await invoke<ApplyYtdlpResult>("apply_ytdlp_update");
  await logAndroid(
    "YtdlpBridge",
    `applyYtdlpUpdate result success=${result.success} version=${result.version ?? ""} error=${result.error ?? ""}`,
  );
  return result;
}

export async function openBatteryOptimizationSettings(): Promise<void> {
  return invoke("open_battery_optimization_settings");
}

/** Fingerprint queue composition — excludes status so native progress is not overwritten. */
export function buildOrchestratorSyncKey(
  items: QueueItem[],
  settings: Partial<AppSettings>,
): string {
  const itemKey = items
    .map(
      (i) =>
        `${i.id}|${i.url}|${i.format}|${i.audioOnly}|${i.container}|${i.audioFormat}|${i.writeSubs}|${i.writeThumbnail}|${i.subLangs}`,
    )
    .join("\n");
  const settingsKey = [
    settings.cookiesFile ?? "",
    settings.androidDownloadJitter,
    settings.androidSafeBulkMode,
    settings.androidSafeBulkInterval,
    settings.androidCookieRotateInterval,
    settings.androidGuestPaceMode,
    settings.androidYtdlpAutoUpdate,
  ].join("|");
  return `${itemKey}::${settingsKey}`;
}

/** Native orchestrator item snapshot from Kotlin JSON. */
interface OrchestratorSnapshotItem {
  id: string;
  url: string;
  title?: string;
  status: QueueStatus;
  percent?: number;
  filename?: string | null;
  error?: string | null;
  retryCount?: number;
  lastBotErrorAt?: number;
  cooldownUntil?: number;
}

const STATUS_RANK: Record<QueueStatus, number> = {
  cancelled: 1,
  queued: 2,
  paused: 2,
  error: 3,
  downloading: 4,
  completed: 5,
};

const TERMINAL_STATUSES = new Set<QueueStatus>([
  "error",
  "completed",
  "cancelled",
]);

/** Pick the authoritative status when merging native snapshot with React store. */
function mergeQueueStatus(
  nativeStatus: QueueStatus,
  existingStatus: QueueStatus,
  nativeCooldown: number | undefined,
  now: number,
): QueueStatus {
  if (existingStatus === "cancelled") return "cancelled";
  if (nativeStatus === "paused") return "paused";
  if (existingStatus === "paused" && nativeStatus === "downloading") {
    return "paused";
  }
  if (
    nativeStatus === "queued" &&
    nativeCooldown != null &&
    nativeCooldown > now &&
    existingStatus === "downloading"
  ) {
    return "queued";
  }
  if (TERMINAL_STATUSES.has(nativeStatus)) return nativeStatus;
  if (
    TERMINAL_STATUSES.has(existingStatus) &&
    nativeStatus !== "downloading" &&
    nativeStatus !== "queued"
  ) {
    return existingStatus;
  }
  const nativeRank = STATUS_RANK[nativeStatus] ?? 0;
  const existingRank = STATUS_RANK[existingStatus] ?? 0;
  if (nativeRank > existingRank) return nativeStatus;
  if (existingRank > nativeRank) return existingStatus;
  return nativeStatus;
}

/** Build a minimal queue row when native has an item React never synced. */
function minimalQueueItemFromNative(
  oItem: OrchestratorSnapshotItem,
): QueueItem {
  const settings = useSettingsStore.getState();
  return {
    id: oItem.id,
    url: oItem.url,
    title: oItem.title ?? oItem.url,
    format: settings.defaultQuality,
    audioOnly: false,
    audioFormat: "mp3",
    container: settings.defaultContainer,
    writeSubs: false,
    subLangs: "tr",
    writeThumbnail: settings.writeThumbnailDefault ?? false,
    status: oItem.status,
    percent: oItem.percent ?? 0,
    filename: oItem.filename ?? undefined,
    error: normalizeQueueError(oItem.error),
    createdAt: Date.now(),
    retryCount: oItem.retryCount,
    lastBotErrorAt: oItem.lastBotErrorAt,
    cooldownUntil: oItem.cooldownUntil,
  };
}

/** Merge Kotlin orchestrator snapshot into the React queue store (upsert by id). */
export function mergeOrchestratorState(stateJson: string): void {
  try {
    const state = JSON.parse(stateJson) as {
      items?: OrchestratorSnapshotItem[];
      activeId?: string | null;
      paused?: boolean;
      pausedUntil?: number;
    };
    orchestratorPaused = state.paused === true;
    orchestratorPausedUntil = state.pausedUntil ?? 0;
    useQueueStore.getState().setOrchestratorPaused(orchestratorPaused);
    const store = useQueueStore.getState();
    const nativeItems = state.items ?? [];

    if (nativeItems.length === 0) {
      if (state.activeId !== undefined) {
        store.setActiveId(state.activeId);
      }
      void logAndroid("QueueMerge", "empty native snapshot");
      return;
    }

    const existingById = new Map(store.items.map((item) => [item.id, item]));
    const nativeIds = new Set(nativeItems.map((item) => item.id));
    const now = Date.now();
    let updated = 0;
    let inserted = 0;

    const mergedNative = nativeItems.map((oItem) => {
      const existing = existingById.get(oItem.id);
      if (existing) {
        updated += 1;
        const nativePercent = oItem.percent ?? 0;
        const existingPercent = existing.percent ?? 0;
        return {
          ...existing,
          title: oItem.title ?? existing.title,
          url: oItem.url || existing.url,
          status: mergeQueueStatus(
            oItem.status,
            existing.status,
            oItem.cooldownUntil,
            now,
          ),
          percent: Math.max(nativePercent, existingPercent),
          speed: existing.speed,
          eta: existing.eta,
          phase:
            oItem.status === "completed" ||
            oItem.status === "error" ||
            oItem.status === "cancelled"
              ? null
              : existing.phase,
          filename: oItem.filename ?? existing.filename,
          error:
            oItem.status === "downloading" || oItem.status === "queued"
              ? normalizeQueueError(oItem.error)
              : normalizeQueueError(oItem.error) ?? normalizeQueueError(existing.error),
          retryCount: oItem.retryCount ?? existing.retryCount,
          lastBotErrorAt: oItem.lastBotErrorAt ?? existing.lastBotErrorAt,
          cooldownUntil: oItem.cooldownUntil ?? existing.cooldownUntil,
        };
      }
      inserted += 1;
      return minimalQueueItemFromNative(oItem);
    });

    const reactOnlyQueued = store.items.filter(
      (item) => !nativeIds.has(item.id) && item.status === "queued",
    );
    const merged = [...mergedNative, ...reactOnlyQueued];

    const prevById = new Map(store.items.map((item) => [item.id, item]));
    const transitions: MergeTransition[] = [];
    for (const item of merged) {
      const prev = prevById.get(item.id);
      if (prev && prev.status !== item.status) {
        transitions.push({
          id: item.id,
          from: prev.status,
          to: item.status,
          item,
        });
      }
    }

    useQueueStore.setState({
      items: merged,
      activeId: state.activeId ?? store.activeId,
    });

    if (transitions.length > 0) {
      onMergeTransitions?.(transitions);
    }

    syncHistoryFromQueueItems(merged);

    void logAndroid(
      "QueueMerge",
      `upsert total=${nativeItems.length} updated=${updated} inserted=${inserted} active=${state.activeId ?? "none"}`,
    );
  } catch (err) {
    void logAndroid(
      "QueueMerge",
      `parse failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/** Pull native orchestrator state and merge into React store. */
export async function pullOrchestratorState(): Promise<void> {
  if (!isAndroidClient()) return;
  try {
    const json = await getOrchestratorState();
    mergeOrchestratorState(json);
  } catch (err) {
    void logAndroid(
      "QueueMerge",
      `pull failed: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/** Subscribe to native orchestrator queue-state events. */
export async function onQueueState(
  handler: (stateJson: string) => void,
): Promise<UnlistenFn> {
  return listen<{ state: string }>("queue-state", (event) => {
    void logAndroid("QueueMerge", "queue-state event received");
    handler(event.payload.state);
  });
}
