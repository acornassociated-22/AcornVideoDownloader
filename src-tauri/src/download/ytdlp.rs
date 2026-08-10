use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use tokio::io::{AsyncBufReadExt, BufReader};
use tokio::process::{Child, Command};
use which::which;

/// Prefer a user-installed yt-dlp over the distro apt package when both exist.
fn prefer_ytdlp(a: PathBuf, b: PathBuf) -> PathBuf {
    let a_s = a.to_string_lossy();
    let b_s = b.to_string_lossy();
    // Official GitHub binary lives in ~/.local/bin; apt’s /usr/bin/yt-dlp is often stale.
    if a_s.contains("/.local/bin/") {
        return a;
    }
    if b_s.contains("/.local/bin/") {
        return b;
    }
    a
}

/// Look for a sidecar binary next to the app executable (deb/AppImage/NSIS layout).
fn sidecar_beside_exe(name: &str) -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    let dir = exe.parent()?;
    #[cfg(windows)]
    let candidate = dir.join(format!("{name}.exe"));
    #[cfg(not(windows))]
    let candidate = dir.join(name);
    candidate.exists().then_some(candidate)
}

/// Engine config written by MainActivity after YoutubeDL.init (Android only).
#[cfg(target_os = "android")]
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
struct AndroidEngineConfig {
    ready: bool,
    python: String,
    script: String,
    ffmpeg: String,
    ld_library_path: String,
    python_home: String,
    tmp_dir: String,
    #[serde(default)]
    native_library_dir: Option<String>,
    #[serde(default)]
    ssl_cert_file: Option<String>,
}

/// Candidate paths for filesDir/acorn-bin/engine.json.
#[cfg(target_os = "android")]
fn android_engine_json_candidates() -> Vec<PathBuf> {
    let mut paths = Vec::new();
    if let Ok(bin) = std::env::var("ACORN_BIN_DIR") {
        paths.push(PathBuf::from(bin).join("engine.json"));
    }
    paths.push(PathBuf::from(
        "/data/user/0/com.acorn.videodownloader/files/acorn-bin/engine.json",
    ));
    paths.push(PathBuf::from(
        "/data/data/com.acorn.videodownloader/files/acorn-bin/engine.json",
    ));
    paths
}

/// Load engine.json if present.
#[cfg(target_os = "android")]
fn load_android_engine() -> Option<AndroidEngineConfig> {
    for path in android_engine_json_candidates() {
        let Ok(raw) = std::fs::read_to_string(&path) else {
            continue;
        };
        if let Ok(cfg) = serde_json::from_str::<AndroidEngineConfig>(&raw) {
            return Some(cfg);
        }
    }
    None
}

/// Return ready engine config when python.so + script exist on disk.
#[cfg(target_os = "android")]
fn android_engine_ready() -> Option<AndroidEngineConfig> {
    let cfg = load_android_engine()?;
    if !cfg.ready {
        return None;
    }
    let python = PathBuf::from(&cfg.python);
    let script = PathBuf::from(&cfg.script);
    if python.is_file() && script.is_file() {
        Some(cfg)
    } else {
        None
    }
}

/// Apply env from engine.json (mirrors youtubedl-android ProcessBuilder).
#[cfg(target_os = "android")]
fn apply_android_engine_env(cmd: &mut Command, cfg: &AndroidEngineConfig) {
    if !cfg.ld_library_path.is_empty() {
        cmd.env("LD_LIBRARY_PATH", &cfg.ld_library_path);
    }
    if !cfg.python_home.is_empty() {
        cmd.env("PYTHONHOME", &cfg.python_home);
        cmd.env("HOME", &cfg.python_home);
    }
    if !cfg.tmp_dir.is_empty() {
        cmd.env("TMPDIR", &cfg.tmp_dir);
    }
    if let Some(cert) = &cfg.ssl_cert_file {
        if !cert.is_empty() {
            cmd.env("SSL_CERT_FILE", cert);
        }
    }
    if let Some(native) = &cfg.native_library_dir {
        if !native.is_empty() {
            let path = std::env::var("PATH").unwrap_or_default();
            let merged = if path.is_empty() {
                native.clone()
            } else {
                format!("{path}:{native}")
            };
            cmd.env("PATH", merged);
        }
    }
}

/// Build a process command for yt-dlp.
///
/// On Android: always `libpython.so` + yt-dlp script from engine.json.
/// Never use /system/bin/sh wrappers under filesDir (W^X / linker failures).
fn ytdlp_command(ytdlp: &Path) -> Command {
    #[cfg(target_os = "android")]
    {
        if let Some(cfg) = android_engine_ready() {
            let mut cmd = Command::new(&cfg.python);
            cmd.arg(&cfg.script);
            apply_android_engine_env(&mut cmd, &cfg);
            return cmd;
        }
        let _ = ytdlp;
    }
    Command::new(ytdlp)
}

/// Resolve yt-dlp executable from settings, bundled sidecar, PATH, or common locations.
pub fn resolve_ytdlp(custom: Option<&str>) -> Result<PathBuf, String> {
    resolve_ytdlp_with_dirs(custom, &[])
}

/// Like [`resolve_ytdlp`], with extra Android/app data directories to search.
pub fn resolve_ytdlp_with_dirs(
    custom: Option<&str>,
    extra_dirs: &[PathBuf],
) -> Result<PathBuf, String> {
    if let Some(path) = custom {
        let p = PathBuf::from(path);
        if p.exists() {
            return Ok(p);
        }
        return Err(format!("yt-dlp not found at custom path: {path}"));
    }

    #[cfg(target_os = "android")]
    {
        let _ = extra_dirs;
        if let Some(cfg) = android_engine_ready() {
            return Ok(PathBuf::from(cfg.script));
        }
        return Err(
            "Download engine still initializing. Wait a moment and try again.".into(),
        );
    }

    #[cfg(not(target_os = "android"))]
    {
        let _ = extra_dirs;
        // Bundled name avoids overwriting distro /usr/bin/yt-dlp in .deb packages.
        if let Some(bundled) = sidecar_beside_exe("acorn-yt-dlp") {
            return Ok(bundled);
        }

        let home = std::env::var("HOME").unwrap_or_default();
        let mut found: Option<PathBuf> = None;

        if !home.is_empty() {
            let local = PathBuf::from(&home).join(".local/bin/yt-dlp");
            if local.exists() {
                found = Some(local);
            }
        }

        if let Ok(path) = which("yt-dlp") {
            found = Some(match found {
                Some(prev) => prefer_ytdlp(prev, path),
                None => path,
            });
        }

        let candidates = [
            "/usr/local/bin/yt-dlp",
            "/opt/homebrew/bin/yt-dlp",
            "/usr/bin/yt-dlp",
        ];
        for candidate in candidates {
            let p = PathBuf::from(candidate);
            if p.exists() {
                found = Some(match found {
                    Some(prev) => prefer_ytdlp(prev, p),
                    None => p,
                });
                break;
            }
        }

        found.ok_or_else(|| {
            "yt-dlp not found. Install yt-dlp or set a custom path in Settings.".into()
        })
    }
}

/// Ensure Deno / local bins are on PATH for YouTube EJS challenge solving.
fn enriched_path() -> Option<String> {
    let home = std::env::var("HOME").ok()?;
    let mut parts: Vec<String> = Vec::new();
    for extra in [
        format!("{home}/.deno/bin"),
        format!("{home}/.local/bin"),
    ] {
        if Path::new(&extra).is_dir() {
            parts.push(extra);
        }
    }
    let current = std::env::var("PATH").unwrap_or_default();
    if !current.is_empty() {
        parts.push(current);
    }
    if parts.is_empty() {
        None
    } else {
        Some(parts.join(":"))
    }
}

/// Append flags so apt/stale yt-dlp can still fetch YouTube JS solvers.
fn push_youtube_runtime_args(args: &mut Vec<String>) {
    // Prefer clients that often work without interactive cookie setup.
    push_youtube_player_clients(args, false);

    // Deno is preferred (default). Node needs v22+; allow if present.
    if which("deno").is_ok()
        || std::env::var("HOME")
            .map(|h| Path::new(&h).join(".deno/bin/deno").exists())
            .unwrap_or(false)
    {
        // bundled EJS in official binary; remote github helps third-party packages
        args.push("--remote-components".to_string());
        args.push("ejs:github".to_string());
    } else if which("node").is_ok() {
        args.push("--js-runtimes".to_string());
        args.push("node".to_string());
        args.push("--remote-components".to_string());
        args.push("ejs:github".to_string());
    }
}

/// YouTube player_client chain (primary vs bot-retry fallback).
pub fn push_youtube_player_clients(args: &mut Vec<String>, retry: bool) {
    let extractor = if retry {
        // Alternate clients + skip webpage fetch when the first chain hits a bot wall.
        "youtube:player_client=tv_simply,tv_embedded,mweb,web_safari,web;player_skip=webpage"
    } else {
        "youtube:player_client=android_vr,tv,tv_embedded,mweb,web_safari"
    };
    args.push("--extractor-args".to_string());
    args.push(extractor.to_string());
}

/// Faster mobile client chain for Android APK (tier 0–3 bot fallbacks).
#[allow(dead_code)] // Used from #[cfg(target_os = "android")] adapter.
pub fn push_android_youtube_player_clients(args: &mut Vec<String>, tier: u8) {
    let extractor = match tier {
        // Prefer TV/iOS clients first — less bot friction than android_vr from WebView cookies.
        0 => "youtube:player_client=default,-android_sdkless,ios,tv_embedded,mweb,web_safari",
        1 => "youtube:player_client=default,-android_sdkless,tv_simply,tv_embedded,mweb,web_safari;player_skip=webpage",
        2 => "youtube:player_client=default,-android_sdkless,android_vr,tv_embedded,tv,mweb",
        _ => "youtube:player_client=default,-android_sdkless,web,web_safari,web_embedded,mweb;player_skip=webpage",
    };
    args.push("--extractor-args".to_string());
    args.push(extractor.to_string());
}

/// True when yt-dlp stderr looks like a YouTube bot / sign-in wall.
pub fn is_youtube_bot_error(err: &str) -> bool {
    let e = err.to_lowercase();
    e.contains("sign in to confirm")
        || e.contains("not a bot")
        || e.contains("cookies-from-browser")
        || e.contains("confirm you're not a bot")
        || e.contains("confirm you are not a bot")
        || e.contains("please sign in")
        || e.contains("login required")
        || e.contains("bot detection")
        || e.contains("blocked this request")
        || e.contains("http error 429")
        || e.contains("too many requests")
        || e.contains("unable to extract")
        || e.contains("video unavailable")
        || e.contains("http error 403")
        || e.contains("no longer supported")
        || e.contains("not supported in this application")
        || (e.contains("[generic]") && e.contains("is not a valid url"))
}

/// True when an 11-char id looks like a YouTube video id (not channel/playlist).
fn is_likely_youtube_video_id(id: &str) -> bool {
    id.len() == 11
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || c == '_' || c == '-')
        && !id.starts_with("UC")
        && !id.starts_with("PL")
        && !id.starts_with("LL")
        && !id.starts_with("UU")
        && !id.starts_with("RD")
        && !id.starts_with("FL")
        && !id.starts_with("OL")
}

/// True when Kotlin plugin finished yt-dlp but could not locate the output file.
pub fn is_output_not_found_error(err: &str) -> bool {
    let e = err.to_lowercase();
    e.contains("output file was not found")
        || e.contains("only thumbnails/metadata were saved")
}

/// Resolve ffmpeg executable for stream merging.
pub fn resolve_ffmpeg(custom: Option<&str>) -> Option<PathBuf> {
    resolve_ffmpeg_with_dirs(custom, &[])
}

/// Like [`resolve_ffmpeg`], with extra Android/app data directories to search.
pub fn resolve_ffmpeg_with_dirs(
    custom: Option<&str>,
    extra_dirs: &[PathBuf],
) -> Option<PathBuf> {
    if let Some(path) = custom {
        let p = PathBuf::from(path);
        if p.exists() {
            return Some(p);
        }
    }
    #[cfg(target_os = "android")]
    {
        let _ = extra_dirs;
        if let Some(cfg) = android_engine_ready() {
            let p = PathBuf::from(&cfg.ffmpeg);
            if p.is_file() {
                return Some(p);
            }
        }
        return None;
    }

    #[cfg(not(target_os = "android"))]
    {
        let _ = extra_dirs;
        if let Some(bundled) = sidecar_beside_exe("acorn-ffmpeg") {
            return Some(bundled);
        }
        which("ffmpeg").ok().or_else(|| {
            [
                "/usr/bin/ffmpeg",
                "/usr/local/bin/ffmpeg",
                "/opt/homebrew/bin/ffmpeg",
            ]
            .into_iter()
            .map(PathBuf::from)
            .find(|p| p.exists())
        })
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FormatInfo {
    pub format_id: String,
    pub ext: String,
    pub resolution: Option<String>,
    pub fps: Option<f64>,
    pub vcodec: Option<String>,
    pub acodec: Option<String>,
    pub filesize: Option<u64>,
    pub tbr: Option<f64>,
    pub format_note: Option<String>,
    pub height: Option<u64>,
    pub width: Option<u64>,
    pub is_audio: bool,
    pub is_video: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubtitleTrack {
    pub language: String,
    pub name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct VideoEntry {
    pub id: String,
    pub title: String,
    pub webpage_url: String,
    pub thumbnail: Option<String>,
    pub duration: Option<f64>,
    pub uploader: Option<String>,
    pub channel: Option<String>,
    pub description: Option<String>,
    pub formats: Vec<FormatInfo>,
    pub subtitles: Vec<SubtitleTrack>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetadataResult {
    pub kind: String,
    pub title: String,
    pub entries: Vec<VideoEntry>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadOptions {
    pub id: String,
    pub url: String,
    pub format: String,
    pub output_dir: String,
    pub audio_only: bool,
    pub audio_format: Option<String>,
    pub container: Option<String>,
    pub write_subs: bool,
    pub sub_langs: Option<String>,
    pub write_thumbnail: bool,
    pub ytdlp_path: Option<String>,
    pub ffmpeg_path: Option<String>,
    /// Browser name for `--cookies-from-browser` (`auto`, `firefox`, `chrome`, …).
    pub cookies_from_browser: Option<String>,
    /// Netscape cookies.txt path for `--cookies`.
    pub cookies_file: Option<String>,
}

/// True when a browser profile directory looks installed for cookie extraction.
fn browser_profile_exists(name: &str) -> bool {
    let home = std::env::var("HOME")
        .or_else(|_| std::env::var("USERPROFILE"))
        .unwrap_or_default();
    if home.is_empty() {
        return false;
    }
    let home = Path::new(&home);
    let candidates: &[&str] = match name {
        "firefox" => &[
            ".mozilla/firefox",
            "Library/Application Support/Firefox/Profiles",
            "AppData/Roaming/Mozilla/Firefox/Profiles",
        ],
        "chrome" => &[
            ".config/google-chrome",
            "Library/Application Support/Google/Chrome",
            "AppData/Local/Google/Chrome/User Data",
        ],
        "chromium" => &[".config/chromium", "Library/Application Support/Chromium"],
        "brave" => &[
            ".config/BraveSoftware/Brave-Browser",
            "Library/Application Support/BraveSoftware/Brave-Browser",
            "AppData/Local/BraveSoftware/Brave-Browser/User Data",
        ],
        "edge" => &[
            ".config/microsoft-edge",
            "Library/Application Support/Microsoft Edge",
            "AppData/Local/Microsoft/Edge/User Data",
        ],
        _ => return false,
    };
    candidates.iter().any(|rel| home.join(rel).exists())
}

/// Pick the first installed browser yt-dlp can read cookies from.
pub fn detect_cookies_browser() -> Option<&'static str> {
    // Firefox decrypts most reliably on Linux; prefer it for YouTube bot checks.
    for name in ["firefox", "chrome", "chromium", "brave", "edge"] {
        if browser_profile_exists(name) {
            return Some(name);
        }
    }
    None
}

/// Resolve cookie browser preference (`auto` → first installed browser).
pub fn resolve_cookies_browser(preference: Option<&str>) -> Option<String> {
    match preference.map(str::trim).filter(|s| !s.is_empty()) {
        None | Some("none") => None,
        Some("auto") => detect_cookies_browser().map(str::to_string),
        Some(name) => Some(name.to_string()),
    }
}

/// Append yt-dlp cookie authentication flags.
pub fn push_auth_args(
    args: &mut Vec<String>,
    cookies_from_browser: Option<&str>,
    cookies_file: Option<&str>,
) {
    if let Some(file) = cookies_file.map(str::trim).filter(|s| !s.is_empty()) {
        if Path::new(file).exists() {
            args.push("--cookies".to_string());
            args.push(file.to_string());
        }
    }
    if let Some(browser) = resolve_cookies_browser(cookies_from_browser) {
        args.push("--cookies-from-browser".to_string());
        args.push(browser);
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DownloadProgress {
    pub id: String,
    pub percent: f64,
    pub speed: Option<String>,
    pub eta: Option<String>,
    pub status: String,
    pub filename: Option<String>,
    pub error: Option<String>,
    #[serde(default)]
    pub export_mode: Option<String>,
}

/// Parse yt-dlp JSON dump into a normalized metadata result.
pub fn parse_metadata(json: &serde_json::Value) -> Result<MetadataResult, String> {
    let kind = json
        .get("_type")
        .and_then(|v| v.as_str())
        .unwrap_or("video");

    if kind == "playlist" {
        let title = json
            .get("title")
            .and_then(|v| v.as_str())
            .unwrap_or("Playlist")
            .to_string();
        let entries = json
            .get("entries")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|entry| {
                        if entry.is_null() {
                            return None;
                        }
                        parse_video_entry(entry).ok()
                    })
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();
        return Ok(MetadataResult {
            kind: "playlist".into(),
            title,
            entries,
        });
    }

    let entry = parse_video_entry(json)?;
    let title = entry.title.clone();
    Ok(MetadataResult {
        kind: "video".into(),
        title,
        entries: vec![entry],
    })
}

fn parse_video_entry(json: &serde_json::Value) -> Result<VideoEntry, String> {
    let id = json
        .get("id")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown")
        .to_string();
    let title = json
        .get("title")
        .and_then(|v| v.as_str())
        .unwrap_or("Untitled")
        .to_string();
    let mut webpage_url = json
        .get("webpage_url")
        .or_else(|| json.get("original_url"))
        .or_else(|| json.get("url"))
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    if webpage_url.is_empty() && id != "unknown" && is_likely_youtube_video_id(&id) {
        webpage_url = format!("https://www.youtube.com/watch?v={id}");
    }

    let formats = json
        .get("formats")
        .and_then(|v| v.as_array())
        .map(|arr| arr.iter().filter_map(parse_format).collect())
        .unwrap_or_default();

    let mut subtitles = Vec::new();
    if let Some(subs) = json.get("subtitles").and_then(|v| v.as_object()) {
        for (lang, tracks) in subs {
            let name = tracks
                .as_array()
                .and_then(|a| a.first())
                .and_then(|t| t.get("name"))
                .and_then(|n| n.as_str())
                .map(|s| s.to_string());
            subtitles.push(SubtitleTrack {
                language: lang.clone(),
                name,
            });
        }
    }
    if let Some(subs) = json.get("automatic_captions").and_then(|v| v.as_object()) {
        for (lang, _) in subs {
            if !subtitles.iter().any(|s| s.language == *lang) {
                subtitles.push(SubtitleTrack {
                    language: lang.clone(),
                    name: Some(format!("{lang} (auto)")),
                });
            }
        }
    }

    Ok(VideoEntry {
        id,
        title,
        webpage_url,
        thumbnail: json
            .get("thumbnail")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .or_else(|| {
                json.get("thumbnails")
                    .and_then(|v| v.as_array())
                    .and_then(|arr| arr.last())
                    .and_then(|t| t.get("url"))
                    .and_then(|u| u.as_str())
                    .map(|s| s.to_string())
            }),
        duration: json.get("duration").and_then(|v| v.as_f64()),
        uploader: json
            .get("uploader")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        channel: json
            .get("channel")
            .or_else(|| json.get("uploader"))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        description: json
            .get("description")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        formats,
        subtitles,
    })
}

fn parse_format(value: &serde_json::Value) -> Option<FormatInfo> {
    let format_id = value.get("format_id")?.as_str()?.to_string();
    let ext = value
        .get("ext")
        .and_then(|v| v.as_str())
        .unwrap_or("unknown")
        .to_string();
    let vcodec = value
        .get("vcodec")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let acodec = value
        .get("acodec")
        .and_then(|v| v.as_str())
        .map(|s| s.to_string());
    let is_audio = matches!(vcodec.as_deref(), Some("none") | None)
        && !matches!(acodec.as_deref(), Some("none") | None);
    let is_video = !matches!(vcodec.as_deref(), Some("none") | None);

    Some(FormatInfo {
        format_id,
        ext,
        resolution: value
            .get("resolution")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
            .or_else(|| {
                value
                    .get("height")
                    .and_then(|v| v.as_u64())
                    .map(|h| format!("{h}p"))
            }),
        fps: value.get("fps").and_then(|v| v.as_f64()),
        vcodec,
        acodec,
        filesize: value
            .get("filesize")
            .or_else(|| value.get("filesize_approx"))
            .and_then(|v| v.as_u64()),
        tbr: value.get("tbr").and_then(|v| v.as_f64()),
        format_note: value
            .get("format_note")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string()),
        height: value.get("height").and_then(|v| v.as_u64()),
        width: value.get("width").and_then(|v| v.as_u64()),
        is_audio,
        is_video,
    })
}

/// True when the URL likely points at a playlist/channel listing.
pub fn looks_like_playlist(url: &str) -> bool {
    let u = url.to_lowercase();
    u.contains("/playlist")
        || u.contains("list=")
        || u.contains("/channel/")
        || u.contains("/c/")
        || u.contains("/user/")
        || u.contains("/videos")
        || u.contains("/streams")
        || u.contains("/playlist?")
}

/// Fetch video/playlist metadata via yt-dlp JSON dump.
/// Playlists use `--flat-playlist` and a longer timeout so listing stays usable.
pub async fn fetch_metadata(
    url: &str,
    ytdlp_path: Option<&str>,
    flat_playlist: bool,
    cookies_from_browser: Option<&str>,
    cookies_file: Option<&str>,
) -> Result<MetadataResult, String> {
    match fetch_metadata_once(
        url,
        ytdlp_path,
        flat_playlist,
        cookies_from_browser,
        cookies_file,
        false,
    )
    .await
    {
        Ok(ok) => Ok(ok),
        Err(err) if is_youtube_bot_error(&err) => {
            // One automatic retry with an alternate player_client chain.
            fetch_metadata_once(
                url,
                ytdlp_path,
                flat_playlist,
                cookies_from_browser,
                cookies_file,
                true,
            )
            .await
            .map_err(|_| err)
        }
        Err(err) => Err(err),
    }
}

/// Single yt-dlp metadata attempt.
async fn fetch_metadata_once(
    url: &str,
    ytdlp_path: Option<&str>,
    flat_playlist: bool,
    cookies_from_browser: Option<&str>,
    cookies_file: Option<&str>,
    bot_retry: bool,
) -> Result<MetadataResult, String> {
    let ytdlp = resolve_ytdlp(ytdlp_path)?;
    let playlist = flat_playlist || looks_like_playlist(url);
    let timeout_secs: u64 = if playlist { 180 } else { 60 };

    let mut args = vec![
        "-J".to_string(),
        "--no-warnings".to_string(),
        "--no-check-certificates".to_string(),
        "--socket-timeout".to_string(),
        "30".to_string(),
    ];
    push_auth_args(&mut args, cookies_from_browser, cookies_file);
    if bot_retry {
        push_youtube_player_clients(&mut args, true);
        // Still attach Deno/Node helpers when available.
        if which("deno").is_ok()
            || std::env::var("HOME")
                .map(|h| Path::new(&h).join(".deno/bin/deno").exists())
                .unwrap_or(false)
        {
            args.push("--remote-components".to_string());
            args.push("ejs:github".to_string());
        } else if which("node").is_ok() {
            args.push("--js-runtimes".to_string());
            args.push("node".to_string());
            args.push("--remote-components".to_string());
            args.push("ejs:github".to_string());
        }
    } else {
        push_youtube_runtime_args(&mut args);
    }
    if playlist {
        // Avoid downloading full format metadata for every playlist item.
        args.push("--flat-playlist".to_string());
        args.push("--yes-playlist".to_string());
    } else {
        args.push("--no-playlist".to_string());
    }
    args.push(url.to_string());

    let mut cmd = ytdlp_command(&ytdlp);
    cmd.args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    if let Some(path) = enriched_path() {
        cmd.env("PATH", path);
    }
    let run = cmd.output();

    let output = match tokio::time::timeout(std::time::Duration::from_secs(timeout_secs), run).await
    {
        Ok(Ok(output)) => output,
        Ok(Err(e)) => return Err(format!("yt-dlp çalıştırılamadı: {e}")),
        Err(_) => {
            return Err(format!(
                "Zaman aşımı — {} saniyede alınamadı. Playlist ise bağlantıyı kontrol edin veya daha küçük bir liste deneyin.",
                timeout_secs
            ));
        }
    };

    if !output.status.success() {
        let err = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if err.is_empty() {
            "Video bilgisi alınamadı".into()
        } else {
            err
        });
    }

    let json: serde_json::Value = serde_json::from_slice(&output.stdout)
        .map_err(|e| format!("Geçersiz yt-dlp JSON: {e}"))?;
    parse_metadata(&json)
}

/// Resolve a writable output directory.
fn resolve_writable_output_dir(preferred: &str) -> Result<PathBuf, String> {
    let preferred_path = PathBuf::from(preferred);
    if std::fs::create_dir_all(&preferred_path).is_ok()
        && preferred_path.is_dir()
        && can_write_dir(&preferred_path)
    {
        return Ok(preferred_path);
    }

    Err(format!(
        "Cannot create or write output directory: {preferred}"
    ))
}

/// Probe whether a directory accepts new files.
fn can_write_dir(dir: &Path) -> bool {
    let probe = dir.join(".acorn-write-test");
    match std::fs::write(&probe, b"ok") {
        Ok(()) => {
            let _ = std::fs::remove_file(&probe);
            true
        }
        Err(_) => false,
    }
}

/// Spawn a yt-dlp download process with progress reporting.
pub async fn spawn_download(opts: &DownloadOptions) -> Result<Child, String> {
    let ytdlp = resolve_ytdlp(opts.ytdlp_path.as_deref())?;
    let out_dir = resolve_writable_output_dir(&opts.output_dir)?;

    let ffmpeg = resolve_ffmpeg(opts.ffmpeg_path.as_deref());

    let template = out_dir
        .join("%(title).200B [%(id)s].%(ext)s")
        .to_string_lossy()
        .to_string();

    let mut args = vec![
        "--newline".to_string(),
        "--no-playlist".to_string(),
        "--no-warnings".to_string(),
        // Sanitize `:` and other illegal characters (Android/FAT errno 2 otherwise).
        "--windows-filenames".to_string(),
        "-o".to_string(),
        template,
        "--progress".to_string(),
        "--progress-template".to_string(),
        "download:%(progress.downloaded_bytes)s|%(progress.total_bytes)s|%(progress.total_bytes_estimate)s|%(progress.speed)s|%(progress.eta)s|%(progress.filename)s".to_string(),
    ];
    push_auth_args(
        &mut args,
        opts.cookies_from_browser.as_deref(),
        opts.cookies_file.as_deref(),
    );
    push_youtube_runtime_args(&mut args);

    if let Some(ffmpeg) = ffmpeg {
        args.push("--ffmpeg-location".to_string());
        args.push(ffmpeg.to_string_lossy().to_string());
    }

    if opts.audio_only {
        let audio_ext = opts
            .container
            .clone()
            .or_else(|| opts.audio_format.clone())
            .unwrap_or_else(|| "mp3".to_string());
        args.push("-x".to_string());
        args.push("--audio-format".to_string());
        args.push(audio_ext);
        if !opts.format.is_empty() && opts.format != "bestaudio" {
            args.push("-f".to_string());
            args.push(opts.format.clone());
        } else {
            args.push("-f".to_string());
            args.push("bestaudio/best".to_string());
        }
    } else {
        let container = opts
            .container
            .clone()
            .unwrap_or_else(|| "mp4".to_string());
        args.push("-f".to_string());
        args.push(if opts.format.is_empty() {
            "bv*+ba/b".to_string()
        } else {
            opts.format.clone()
        });
        args.push("--merge-output-format".to_string());
        args.push(container);
    }

    if opts.write_subs {
        // Subtitle 429 / missing tracks must not abort the video download.
        args.push("--ignore-errors".to_string());
        args.push("--write-subs".to_string());
        // Auto-captions hit YouTube harder and often trigger 429; only use manual subs.
        if let Some(langs) = &opts.sub_langs {
            if !langs.is_empty() {
                args.push("--sub-langs".to_string());
                args.push(langs.clone());
            }
        }
        args.push("--convert-subs".to_string());
        args.push("srt".to_string());
        args.push("--retries".to_string());
        args.push("5".to_string());
        args.push("--extractor-retries".to_string());
        args.push("3".to_string());
    }

    if opts.write_thumbnail {
        args.push("--write-thumbnail".to_string());
        args.push("--convert-thumbnails".to_string());
        args.push("jpg".to_string());
    }

    args.push(opts.url.clone());

    let mut cmd = ytdlp_command(&ytdlp);
    cmd.args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    if let Some(path) = enriched_path() {
        cmd.env("PATH", path);
    }
    cmd.spawn()
        .map_err(|e| format!("Failed to start download: {e}"))
}

/// Parse a yt-dlp progress template line into percent/speed/eta.
///
/// Note: in `--progress-template "download:..."`, the `download:` prefix selects
/// the template type — it is NOT printed on each progress line.
pub fn parse_progress_line(id: &str, line: &str) -> Option<DownloadProgress> {
    let line = line.trim();
    let rest = line.strip_prefix("download:").unwrap_or(line);

    if let Some(progress) = parse_pipe_progress(id, rest) {
        return Some(progress);
    }

    // Fallback: classic "[download]  12.3%" lines
    if line.contains("[download]") && line.contains('%') {
        if let Some(pct_str) = line.split_whitespace().find(|p| p.ends_with('%')) {
            let percent = pct_str.trim_end_matches('%').parse().unwrap_or(0.0);
            return Some(DownloadProgress {
                id: id.to_string(),
                percent,
                speed: None,
                eta: None,
                status: "downloading".into(),
                filename: None,
                error: None,
                export_mode: None,
            });
        }
    }

    None
}

/// Parse `downloaded|total|estimate|speed|eta|filename` progress lines.
fn parse_pipe_progress(id: &str, rest: &str) -> Option<DownloadProgress> {
    let mut parts = rest.splitn(6, '|');
    let downloaded_s = parts.next()?;
    let total_s = parts.next()?;
    let estimate_s = parts.next()?;
    let speed_s = parts.next()?;
    let eta_s = parts.next()?;
    let filename_s = parts.next().unwrap_or("");

    // First field must be a number so log lines with `|` are ignored.
    let downloaded: f64 = downloaded_s.parse().ok()?;
    let total: f64 = total_s
        .parse()
        .ok()
        .filter(|v: &f64| *v > 0.0)
        .or_else(|| estimate_s.parse().ok().filter(|v: &f64| *v > 0.0))
        .unwrap_or(0.0);
    let percent = if total > 0.0 {
        ((downloaded / total) * 100.0).clamp(0.0, 100.0)
    } else {
        0.0
    };
    let speed = if speed_s.is_empty() || speed_s == "NA" {
        None
    } else {
        Some(format_bytes_speed(speed_s))
    };
    let eta = if eta_s.is_empty() || eta_s == "NA" {
        None
    } else {
        Some(format_eta(eta_s))
    };
    let filename = if filename_s.is_empty() || filename_s == "NA" {
        None
    } else {
        Some(filename_s.to_string())
    };

    Some(DownloadProgress {
        id: id.to_string(),
        percent,
        speed,
        eta,
        status: "downloading".into(),
        filename,
        error: None,
        export_mode: None,
    })
}

fn format_bytes_speed(raw: &str) -> String {
    if let Ok(bps) = raw.parse::<f64>() {
        if bps >= 1_000_000.0 {
            return format!("{:.1} MB/s", bps / 1_000_000.0);
        }
        if bps >= 1_000.0 {
            return format!("{:.1} KB/s", bps / 1_000.0);
        }
        return format!("{bps:.0} B/s");
    }
    raw.to_string()
}

fn format_eta(raw: &str) -> String {
    if let Ok(secs) = raw.parse::<f64>() {
        let secs = secs.max(0.0) as u64;
        let h = secs / 3600;
        let m = (secs % 3600) / 60;
        let s = secs % 60;
        if h > 0 {
            return format!("{h}:{m:02}:{s:02}");
        }
        return format!("{m}:{s:02}");
    }
    raw.to_string()
}

/// Prefer the merged output file when yt-dlp left a fragment path in progress.
fn finalize_output_path(last_filename: Option<String>) -> Option<String> {
    let Some(raw) = last_filename else {
        return None;
    };
    let path = Path::new(&raw);
    if path.exists() {
        return Some(raw);
    }
    let parent = path.parent()?;
    let stem = path.file_stem()?.to_string_lossy();
    // Strip yt-dlp format id suffix: "Title [id].f251" → "Title [id]"
    let base = stem
        .rsplit_once(".f")
        .filter(|(_, rest)| rest.chars().all(|c| c.is_ascii_digit()))
        .map(|(head, _)| head)
        .unwrap_or(&stem);
    for ext in ["mp4", "webm", "mkv", "m4a", "mp3", "opus", "flac", "wav"] {
        let candidate = parent.join(format!("{base}.{ext}"));
        if candidate.exists() {
            return Some(candidate.to_string_lossy().to_string());
        }
    }
    // Fall back to any matching "base.*" that isn't a temp fragment.
    if let Ok(entries) = std::fs::read_dir(parent) {
        for entry in entries.flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            if name.starts_with(base)
                && !name.contains(".f")
                && !name.ends_with(".part")
                && !name.ends_with(".ytdl")
            {
                return Some(entry.path().to_string_lossy().to_string());
            }
        }
    }
    Some(raw)
}

/// Pump stdout/stderr from a child process and invoke a progress callback.
pub async fn pump_progress<F>(
    mut child: Child,
    id: String,
    mut on_progress: F,
) -> Result<Option<String>, String>
where
    F: FnMut(DownloadProgress) + Send,
{
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Missing stdout".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Missing stderr".to_string())?;

    let mut last_filename = None;
    let mut err_buf = String::new();

    let mut stdout_reader = BufReader::new(stdout).lines();
    let mut stderr_reader = BufReader::new(stderr).lines();
    let mut stdout_done = false;
    let mut stderr_done = false;

    while !stdout_done || !stderr_done {
        tokio::select! {
            line = stdout_reader.next_line(), if !stdout_done => {
                match line {
                    Ok(Some(text)) => {
                        if let Some(progress) = parse_progress_line(&id, &text) {
                            if progress.filename.is_some() {
                                last_filename = progress.filename.clone();
                            }
                            on_progress(progress);
                        } else if text.contains("Destination:") {
                            if let Some(name) = text.split("Destination:").nth(1) {
                                last_filename = Some(name.trim().to_string());
                            }
                        }
                    }
                    Ok(None) => stdout_done = true,
                    Err(e) => {
                        err_buf.push_str(&format!("stdout read error: {e}\n"));
                        stdout_done = true;
                    }
                }
            }
            line = stderr_reader.next_line(), if !stderr_done => {
                match line {
                    Ok(Some(text)) => {
                        if let Some(progress) = parse_progress_line(&id, &text) {
                            if progress.filename.is_some() {
                                last_filename = progress.filename.clone();
                            }
                            on_progress(progress);
                        } else if !text.trim().is_empty() {
                            err_buf.push_str(&text);
                            err_buf.push('\n');
                        }
                    }
                    Ok(None) => stderr_done = true,
                    Err(e) => {
                        err_buf.push_str(&format!("stderr read error: {e}\n"));
                        stderr_done = true;
                    }
                }
            }
        }
    }

    let status = child
        .wait()
        .await
        .map_err(|e| format!("Failed waiting for yt-dlp: {e}"))?;

    if status.success() {
        let filename = finalize_output_path(last_filename);
        on_progress(DownloadProgress {
            id,
            percent: 100.0,
            speed: None,
            eta: None,
            status: "completed".into(),
            filename: filename.clone(),
            error: None,
            export_mode: None,
        });
        Ok(filename)
    } else {
        let error = err_buf.trim().to_string();
        let message = if error.is_empty() {
            "Download failed".into()
        } else {
            error
        };
        on_progress(DownloadProgress {
            id,
            percent: 0.0,
            speed: None,
            eta: None,
            status: "error".into(),
            filename: last_filename,
            error: Some(message.clone()),
            export_mode: None,
        });
        Err(message)
    }
}
