/** True when a URL points at YouTube (watch, shorts, youtu.be). */
export function isYoutubeUrl(url: string): boolean {
  return /(?:youtube\.com|youtu\.be)/i.test(url);
}

/** True when yt-dlp stderr looks like a YouTube bot / sign-in wall. */
export function isYoutubeBotError(raw: string): boolean {
  return /sign in to confirm|not a bot|cookies-from-browser|confirm you.?re not a bot|please sign in|login required|bot detection|blocked this request|http error 429|too many requests|unable to extract uploader|video unavailable|no longer supported|not supported in this application/i.test(
    raw,
  );
}

/** True when ffmpeg binary is missing or not ready yet. */
export function isFfmpegMissingError(raw: string): boolean {
  return /ffmpeg not found|ffmpeg not ready|--ffmpeg-location/i.test(raw);
}

/** True when YouTube/CDN returned HTTP 403 Forbidden. */
export function isHttp403Error(raw: string): boolean {
  return /http error 403|403:\s*forbidden/i.test(raw);
}

/** True when output path/filename cannot be created (permissions or illegal chars). */
export function isOutputPathError(raw: string): boolean {
  if (isExportError(raw)) return false;
  return /cannot create or write output directory|cannot create.*output directory/i.test(
    raw,
  );
}

/** True when staging export to Downloads/Acorn failed after download. */
export function isExportError(raw: string): boolean {
  return /export to download|mediastore|sqliteconstraint|unique constraint failed|cannot write to downloads/i.test(
    raw,
  );
}

/** True when download finished but staging output could not be resolved. */
export function isOutputNotFoundError(raw: string): boolean {
  return /output file was not found|download finished but output/i.test(raw);
}

/** True when DNS/network failed inside yt-dlp (common on mobile IPv6). */
export function isNetworkError(raw: string): boolean {
  return /no address associated with hostname|errno 7|name or service not known|network is unreachable|failed to establish a new connection/i.test(
    raw,
  );
}

/** True when Linux Chrome cookie decryption needs secretstorage. */
export function isSecretStorageError(raw: string): boolean {
  return /secretstorage/i.test(raw);
}

/** Drop JSON/null placeholders so queue UI never shows literal "null". */
export function normalizeQueueError(
  raw: string | null | undefined,
): string | undefined {
  if (raw == null) return undefined;
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "null" || trimmed === "undefined") return undefined;
  return trimmed;
}

/** True when YouTube returned unavailable / error 152. */
export function isYoutubeUnavailableError(raw: string): boolean {
  return /error code:\s*152|this video is unavailable/i.test(raw);
}

/** True when the video is a premiere / not yet published. */
export function isYoutubePremiereError(raw: string): boolean {
  return /premieres in|not yet available|upcoming release|live event will begin|premiere/i.test(
    raw,
  );
}

/** Extract premiere countdown from yt-dlp stderr when present. */
export function youtubePremiereWhen(raw: string): string | null {
  const match = raw.match(/premieres in\s+(.+?)(?:\n|$)/i);
  const when = match?.[1]?.trim();
  return when && when.length > 0 ? when : null;
}

/** True when yt-dlp saved a zero-byte output file. */
export function isEmptyDownloadError(raw: string): boolean {
  return /downloaded file is empty/i.test(raw);
}

/** True when a YouTube failure likely needs sign-in or cookie refresh. */
export function isYoutubeAuthFailure(raw: string): boolean {
  return (
    isYoutubeBotError(raw) ||
    isYoutubeUnavailableError(raw) ||
    isEmptyDownloadError(raw) ||
    isHttp403Error(raw)
  );
}
