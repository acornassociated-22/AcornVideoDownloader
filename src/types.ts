import type { Locale } from "./i18n/types";

export type ThemeMode = "light" | "dark" | "system";
export type PageId = "home" | "queue" | "history" | "settings" | "about";
export type { Locale };

export interface FormatInfo {
  formatId: string;
  ext: string;
  resolution?: string | null;
  fps?: number | null;
  vcodec?: string | null;
  acodec?: string | null;
  filesize?: number | null;
  tbr?: number | null;
  formatNote?: string | null;
  height?: number | null;
  width?: number | null;
  isAudio: boolean;
  isVideo: boolean;
}

export interface SubtitleTrack {
  language: string;
  name?: string | null;
}

export interface VideoEntry {
  id: string;
  title: string;
  webpageUrl: string;
  thumbnail?: string | null;
  duration?: number | null;
  uploader?: string | null;
  channel?: string | null;
  description?: string | null;
  formats: FormatInfo[];
  subtitles: SubtitleTrack[];
}

export interface MetadataResult {
  kind: "video" | "playlist" | string;
  title: string;
  entries: VideoEntry[];
}

export type VideoContainer = "mp4" | "webm" | "mkv";
export type AudioContainer = "mp3" | "m4a" | "opus" | "wav";
export type MediaContainer = VideoContainer | AudioContainer;

export type CookiesBrowser =
  | "auto"
  | "none"
  | "firefox"
  | "chrome"
  | "chromium"
  | "brave"
  | "edge";

export interface DownloadOptions {
  id: string;
  url: string;
  format: string;
  outputDir: string;
  audioOnly: boolean;
  audioFormat?: string | null;
  container: string;
  writeSubs: boolean;
  subLangs?: string | null;
  writeThumbnail: boolean;
  ytdlpPath?: string | null;
  ffmpegPath?: string | null;
  cookiesFromBrowser?: string | null;
  cookiesFile?: string | null;
}

export type DownloadPhase =
  | "download"
  | "merge"
  | "convert"
  | "export"
  | "finalize";

export interface DownloadProgress {
  id: string;
  percent: number;
  speed?: string | null;
  eta?: string | null;
  status: string;
  filename?: string | null;
  error?: string | null;
  exportMode?: string | null;
  phase?: DownloadPhase | null;
}

export type QueueStatus =
  | "queued"
  | "downloading"
  | "paused"
  | "completed"
  | "error"
  | "cancelled";

export interface QueueItem {
  id: string;
  url: string;
  title: string;
  thumbnail?: string | null;
  format: string;
  audioOnly: boolean;
  audioFormat: string;
  container: string;
  writeSubs: boolean;
  subLangs: string;
  writeThumbnail: boolean;
  status: QueueStatus;
  percent: number;
  speed?: string | null;
  eta?: string | null;
  filename?: string | null;
  error?: string | null;
  createdAt: number;
  /** Android orchestrator: bot retry count. */
  retryCount?: number;
  /** Android orchestrator: last bot error timestamp. */
  lastBotErrorAt?: number;
  /** Android orchestrator: backoff until timestamp. */
  cooldownUntil?: number;
  /** Kotlin orchestrator job id sync. */
  orchestratorJobId?: string;
  /** Active processing phase during download (merge, convert, export). */
  phase?: DownloadPhase | null;
}

export interface HistoryItem {
  id: string;
  url: string;
  title: string;
  thumbnail?: string | null;
  filename?: string | null;
  outputDir: string;
  audioOnly: boolean;
  completedAt: number;
}

export interface AppSettings {
  outputDir: string;
  theme: ThemeMode;
  locale: Locale;
  defaultQuality: string;
  defaultContainer: string;
  defaultAudioOnly: boolean;
  ytdlpPath?: string | null;
  ffmpegPath?: string | null;
  writeSubsDefault: boolean;
  writeThumbnailDefault: boolean;
  /** yt-dlp `--cookies-from-browser` preference. */
  cookiesFromBrowser: CookiesBrowser;
  /** Netscape cookies.txt path for `--cookies`. */
  cookiesFile?: string | null;
  /** Android: random 2–5s pause between successful YouTube downloads. */
  androidDownloadJitter?: boolean;
  /** Android: pause every N videos to reduce YouTube rate limits. */
  androidSafeBulkMode?: boolean;
  /** Android: videos between safe-bulk pauses (default 10). */
  androidSafeBulkInterval?: number;
  /** Android: refresh guest cookies every N successful downloads. */
  androidCookieRotateInterval?: number;
  /** Android: slow guest downloads (15–30s between videos) to reduce bot blocks. */
  androidGuestPaceMode?: boolean;
  /** Android: automatically install compatible yt-dlp updates when idle. */
  androidYtdlpAutoUpdate?: boolean;
}

export interface PlatformInfo {
  backend: string;
  supportsYtdlp: boolean;
  defaultOutputDir: string;
  os: string;
  arch: string;
}

export interface BinaryCheck {
  ytdlp?: string | null;
  ytdlpError?: string | null;
  ffmpeg?: string | null;
  ffmpegReady?: boolean;
  stagingPath?: string | null;
  version?: string | null;
  backend: string;
  supportsYtdlp: boolean;
}

/** YouTube cookie snapshot from Android CookieBootstrap. */
export interface YoutubeCookieStatus {
  exists: boolean;
  authenticated: boolean;
  ageMs: number;
  path: string;
  state: string;
}
