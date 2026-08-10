/** True when an 11-char id looks like a YouTube video id (not channel/playlist). */
export function isLikelyYoutubeVideoId(id: string): boolean {
  return (
    /^[A-Za-z0-9_-]{11}$/.test(id) &&
    !/^(UC|PL|LL|UU|RD|FL|OL)/.test(id)
  );
}

/** Resolve a playable watch URL from a playlist/flat entry. */
export function resolveYoutubeEntryUrl(
  entry: { id?: string; webpageUrl?: string },
  fallback: string,
): string {
  if (entry.webpageUrl?.startsWith("http")) {
    return entry.webpageUrl;
  }
  if (entry.id && entry.id !== "unknown" && isLikelyYoutubeVideoId(entry.id)) {
    return `https://www.youtube.com/watch?v=${entry.id}`;
  }
  return fallback;
}

/** True when entry has a usable HTTP watch URL for queueing. */
export function hasQueueableYoutubeUrl(
  entry: { id?: string; webpageUrl?: string },
  fallback: string,
): boolean {
  const url = resolveYoutubeEntryUrl(entry, fallback);
  return url.startsWith("http") && /(?:v=|youtu\.be\/|\/shorts\/)/.test(url);
}
