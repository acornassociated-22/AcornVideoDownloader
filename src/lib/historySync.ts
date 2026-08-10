import { invoke } from "@tauri-apps/api/core";
import { getExportFolder } from "./androidStorage";
import { isAndroidClient } from "./platform";
import { useHistoryStore } from "../store/history";
import { useSettingsStore } from "../store/settings";
import type { QueueItem } from "../types";

/** Write a debug line to Android logcat (no-op on desktop). */
async function logHistorySync(message: string): Promise<void> {
  if (!isAndroidClient()) return;
  try {
    await invoke("android_log", { tag: "HistorySync", message });
  } catch {
    console.log(`[Acorn/HistorySync] ${message}`);
  }
}

/** Resolve export folder label for history (Android reads SAF prefs). */
async function resolveHistoryOutputDir(): Promise<string> {
  if (!isAndroidClient()) {
    return useSettingsStore.getState().outputDir;
  }
  try {
    const info = await getExportFolder();
    return info.displayName;
  } catch {
    return useSettingsStore.getState().outputDir;
  }
}

/** Append or update a completed download in history. */
export async function recordCompletedDownload(
  item: QueueItem,
  filename?: string | null,
): Promise<void> {
  const outputDir = await resolveHistoryOutputDir();
  useHistoryStore.getState().add({
    id: item.id,
    url: item.url,
    title: item.title,
    thumbnail: item.thumbnail,
    filename: filename ?? item.filename,
    outputDir,
    audioOnly: item.audioOnly,
    completedAt: Date.now(),
  });
  void logHistorySync(
    `recorded id=${item.id} title=${item.title.slice(0, 40)} file=${(filename ?? item.filename ?? "").slice(0, 60)}`,
  );
}

/** Backfill history from completed queue rows not yet recorded. */
export function syncHistoryFromQueueItems(items: QueueItem[]): void {
  const historyIds = new Set(
    useHistoryStore.getState().items.map((entry) => entry.id),
  );
  let synced = 0;
  for (const item of items) {
    if (item.status !== "completed" || historyIds.has(item.id)) continue;
    synced += 1;
    void recordCompletedDownload(item, item.filename);
  }
  if (synced > 0) {
    void logHistorySync(`backfill count=${synced}`);
  }
}
