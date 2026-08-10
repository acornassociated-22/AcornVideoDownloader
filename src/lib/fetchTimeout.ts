import { isAndroidClient } from "./platform";

/** True when URL looks like a playlist / channel listing. */
export function looksLikePlaylist(url: string): boolean {
  const u = url.toLowerCase();
  return (
    u.includes("list=") ||
    u.includes("/playlist") ||
    u.includes("/channel/") ||
    u.includes("/videos") ||
    u.includes("/streams")
  );
}

/**
 * Frontend fetch guard.
 * Android: warm engine → short; cold (init+fetch) → up to 120s video / 180s playlist.
 * Desktop: existing 75s / 200s.
 */
export function fetchTimeoutMs(url: string): number {
  const playlist = looksLikePlaylist(url);
  if (isAndroidClient()) {
    return playlist ? 300_000 : 120_000;
  }
  return playlist ? 200_000 : 75_000;
}
