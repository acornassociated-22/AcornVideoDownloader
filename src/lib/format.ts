import type { FormatInfo, VideoEntry } from "../types";

/** Format seconds into m:ss or h:mm:ss. */
export function formatDuration(seconds?: number | null): string {
  if (!seconds || seconds <= 0) return "—";
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/** Human-readable file size. */
export function formatBytes(bytes?: number | null): string {
  if (!bytes || bytes <= 0) return "";
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
  if (bytes >= 1_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  if (bytes >= 1_000) return `${(bytes / 1_000).toFixed(0)} KB`;
  return `${bytes} B`;
}

/** Build a compact format label for dropdowns. */
export function formatLabel(f: FormatInfo): string {
  const parts = [
    f.resolution || (f.height ? `${f.height}p` : null),
    f.ext,
    f.formatNote,
    formatBytes(f.filesize),
  ].filter(Boolean);
  return `${f.formatId} · ${parts.join(" · ")}`;
}

/** Suggest a yt-dlp format string for a target height. */
export function qualityToFormat(height: string, audioOnly: boolean): string {
  if (audioOnly) return "bestaudio/best";
  if (height === "best") return "bv*+ba/b";
  const h = Number(height);
  if (!Number.isFinite(h) || h <= 0) return "bv*+ba/b";
  return `bv*[height<=${h}]+ba/b[height<=${h}]/bv*+ba/b`;
}

/** Collect unique height presets from formats. */
export function availableHeights(entry: VideoEntry): number[] {
  const heights = new Set<number>();
  for (const f of entry.formats) {
    if (f.isVideo && f.height) heights.add(f.height);
  }
  return Array.from(heights).sort((a, b) => b - a);
}

/** Create a short random id for queue items. */
export function createId(): string {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}
