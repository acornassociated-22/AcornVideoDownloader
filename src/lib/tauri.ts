import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { readText as readClipboardText } from "@tauri-apps/plugin-clipboard-manager";
import { openUrl } from "@tauri-apps/plugin-opener";
import { isAndroidClient } from "./platform";
import type {
  AppSettings,
  BinaryCheck,
  DownloadOptions,
  DownloadProgress,
  MetadataResult,
  PlatformInfo,
  YoutubeCookieStatus,
} from "../types";

/** Detect whether the UI is running inside a Tauri webview. */
export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

/** Read plain text from the system clipboard (Tauri or browser). */
export async function readClipboard(): Promise<string> {
  if (isTauri()) {
    return (await readClipboardText()) ?? "";
  }
  return navigator.clipboard.readText();
}

/** Fetch video or playlist metadata. */
export async function fetchMetadata(
  url: string,
  ytdlpPath?: string | null,
  cookiesFromBrowser?: string | null,
  cookiesFile?: string | null,
): Promise<MetadataResult> {
  return invoke<MetadataResult>("fetch_metadata", {
    url,
    ytdlpPath: ytdlpPath || null,
    cookiesFromBrowser: cookiesFromBrowser || null,
    cookiesFile: cookiesFile || null,
  });
}

/** Start a download job on the Rust side. */
export async function startDownload(opts: DownloadOptions): Promise<void> {
  return invoke("start_download", { opts });
}

/** Request cancellation for a download id. */
export async function cancelDownload(id: string): Promise<void> {
  return invoke("cancel_download", { id });
}

/** Open a native folder picker. */
export async function selectDirectory(): Promise<string | null> {
  const result = await invoke<string | null>("select_directory");
  return result;
}

/** Open a native cookies.txt file picker. */
export async function selectFile(): Promise<string | null> {
  const result = await invoke<string | null>("select_file");
  return result;
}

/** Reveal a path in the system file manager. */
export async function openPath(path: string): Promise<void> {
  return invoke("open_path", { path });
}

/** Open an http(s) URL in the system browser, or a mailto: link in the mail client. */
export async function openExternalUrl(url: string): Promise<void> {
  const href = url.trim();
  if (!href) return;

  if (!isTauri()) {
    if (href.startsWith("mailto:") || href.startsWith("tel:")) {
      window.location.href = href;
      return;
    }
    window.open(href, "_blank", "noopener,noreferrer");
    return;
  }

  const isWeb = href.startsWith("http://") || href.startsWith("https://");

  if (isAndroidClient() && isWeb) {
    try {
      await openUrl(href, "inAppBrowser");
      return;
    } catch {
      await openUrl(href);
      return;
    }
  }

  try {
    await openUrl(href);
    return;
  } catch {
    await invoke("open_url", { url: href });
  }
}

/** Load backend default settings. */
export async function getDefaultSettings(): Promise<AppSettings> {
  return invoke<AppSettings>("get_default_settings");
}

/** Probe yt-dlp / ffmpeg availability. */
export async function checkBinaries(
  ytdlpPath?: string | null,
  ffmpegPath?: string | null,
): Promise<BinaryCheck> {
  return invoke<BinaryCheck>("check_binaries", {
    ytdlpPath: ytdlpPath || null,
    ffmpegPath: ffmpegPath || null,
  });
}

/** Read platform backend info. */
export async function getPlatformInfo(): Promise<PlatformInfo> {
  return invoke<PlatformInfo>("get_platform_info");
}

/** Subscribe to download progress events. */
export async function onDownloadProgress(
  handler: (progress: DownloadProgress) => void,
): Promise<UnlistenFn> {
  return listen<DownloadProgress>("download-progress", (event) => {
    handler(event.payload);
  });
}

/** Silently refresh guest YouTube cookies (Android only). */
export async function refreshYoutubeCookies(force = true): Promise<void> {
  if (!isTauri()) return;
  await invoke("refresh_youtube_cookies", { force });
}

/** Read YouTube cookie file status (Android only). */
export async function getYoutubeCookieStatus(): Promise<YoutubeCookieStatus> {
  if (!isTauri()) {
    return {
      exists: false,
      authenticated: false,
      ageMs: -1,
      path: "",
      state: "missing",
    };
  }
  return invoke<YoutubeCookieStatus>("get_youtube_cookie_status");
}
