use super::ytdlp::{self, DownloadOptions, MetadataResult};
use tauri::{AppHandle, Runtime};

#[cfg(not(target_os = "android"))]
use super::ytdlp::DownloadProgress;
#[cfg(not(target_os = "android"))]
use tokio::process::Child;

/// Platform-aware download adapter (desktop yt-dlp / Android YoutubeDL plugin).
#[derive(Debug, Clone, Copy, Default)]
pub struct DownloadAdapter;

impl DownloadAdapter {
    /// Returns true when the current platform can run yt-dlp downloads.
    pub fn supports_ytdlp() -> bool {
        true
    }

    /// Describe the active download backend for Settings / UI.
    pub fn backend_name() -> &'static str {
        #[cfg(target_os = "android")]
        {
            "youtubedl-android"
        }
        #[cfg(not(target_os = "android"))]
        {
            "desktop-ytdlp"
        }
    }

    /// Fetch metadata using the platform backend.
    pub async fn fetch_metadata<R: Runtime>(
        app: &AppHandle<R>,
        url: &str,
        ytdlp_path: Option<&str>,
        cookies_from_browser: Option<&str>,
        cookies_file: Option<&str>,
    ) -> Result<MetadataResult, String> {
        let flat = ytdlp::looks_like_playlist(url);

        #[cfg(target_os = "android")]
        {
            let _ = (ytdlp_path, cookies_from_browser);
            return fetch_metadata_android(app, url, flat, cookies_file).await;
        }

        #[cfg(not(target_os = "android"))]
        {
            let _ = app;
            ytdlp::fetch_metadata(
                url,
                ytdlp_path,
                flat,
                cookies_from_browser,
                cookies_file,
            )
            .await
        }
    }

    /// Start a yt-dlp download process (desktop only).
    #[cfg(not(target_os = "android"))]
    pub async fn start_download(opts: &DownloadOptions) -> Result<Child, String> {
        ytdlp::spawn_download(opts).await
    }

    /// Run a full download via YoutubeDL.execute (Android).
    #[cfg(target_os = "android")]
    pub async fn run_download_android<R: Runtime>(
        app: &AppHandle<R>,
        opts: &DownloadOptions,
    ) -> Result<(), String> {
        run_download_android_inner(app, opts).await
    }

    /// Forward progress pumping to yt-dlp helper (desktop).
    #[cfg(not(target_os = "android"))]
    pub async fn pump_progress<F>(
        child: Child,
        id: String,
        on_progress: F,
    ) -> Result<Option<String>, String>
    where
        F: FnMut(DownloadProgress) + Send,
    {
        ytdlp::pump_progress(child, id, on_progress).await
    }

    /// Default output directory hint for the current platform.
    pub fn default_output_dir() -> String {
        #[cfg(target_os = "android")]
        {
            // App-private files; SAF export copies out after download.
            "/data/user/0/com.acorn.videodownloader/files/AcornDownloads".into()
        }
        #[cfg(not(target_os = "android"))]
        {
            std::env::var("HOME")
                .map(|home| format!("{home}/Downloads/Acorn"))
                .or_else(|_| {
                    std::env::var("USERPROFILE").map(|h| format!("{h}\\Downloads\\Acorn"))
                })
                .unwrap_or_else(|_| "downloads".into())
        }
    }
}

/// CookieBootstrap writes Netscape cookies here in parallel with engine init.
#[cfg(target_os = "android")]
fn android_default_cookies_file() -> Option<String> {
    let candidates = [
        "/data/user/0/com.acorn.videodownloader/files/youtube-cookies.txt",
        "/data/data/com.acorn.videodownloader/files/youtube-cookies.txt",
    ];
    for path in candidates {
        if std::path::Path::new(path).is_file() {
            return Some(path.to_string());
        }
    }
    None
}

/// Resolve cookies path: explicit setting, plugin path, else CookieBootstrap default.
#[cfg(target_os = "android")]
async fn resolve_android_cookies<R: Runtime>(
    app: &AppHandle<R>,
    cookies_file: Option<&str>,
) -> Option<String> {
    if let Some(path) = cookies_file.map(str::trim).filter(|s| !s.is_empty()) {
        if std::path::Path::new(path).is_file() {
            return Some(path.to_string());
        }
    }
    if let Ok(path) = crate::android_ytdlp::get_cookies_path(app).await {
        if std::path::Path::new(&path).is_file() {
            return Some(path);
        }
        // Path may not exist yet; still return for AcornYtdlpExecutor defensive attach.
        if !path.is_empty() {
            return Some(path);
        }
    }
    android_default_cookies_file()
}

/// Wait for CookieBootstrap; guest cookies are enough to proceed.
#[cfg(target_os = "android")]
async fn ensure_cookies_warm<R: Runtime>(app: &AppHandle<R>) {
    let _ = crate::android_ytdlp::await_cookies_ready(app, 20_000).await;
}

/// Ensure engine is warm; skip await when already ready (warm path = zero wait).
#[cfg(target_os = "android")]
async fn ensure_engine_warm<R: Runtime>(app: &AppHandle<R>) -> Result<(), String> {
    use crate::android_ytdlp::{await_engine_ready, is_engine_ready};
    let info = is_engine_ready(app).await?;
    if info.ready {
        return Ok(());
    }
    match await_engine_ready(app, 90_000).await {
        Ok(()) => Ok(()),
        Err(e) => Err(format!(
            "Download engine failed to initialize. Reopen the app and try again. ({e})"
        )),
    }
}

/// Build common yt-dlp option flags for Android metadata.
#[cfg(target_os = "android")]
fn android_metadata_args(
    playlist: bool,
    url: &str,
    cookies: Option<&str>,
    client_tier: u8,
) -> Vec<String> {
    let mut args = vec![
        "--no-warnings".to_string(),
        "--no-update".to_string(),
        "--no-check-certificates".to_string(),
        "--socket-timeout".to_string(),
        "30".to_string(),
    ];
    ytdlp::push_android_youtube_player_clients(&mut args, client_tier);
    ytdlp::push_auth_args(&mut args, None, cookies);
    if playlist {
        args.push("--flat-playlist".to_string());
        args.push("--yes-playlist".to_string());
        if is_youtube_mix_url(url) {
            args.push("--playlist-end".to_string());
            args.push("50".to_string());
        }
    } else {
        args.push("--no-playlist".to_string());
    }
    args
}

/// True for YouTube Mix / Radio URLs that can contain hundreds of entries.
#[cfg(target_os = "android")]
fn is_youtube_mix_url(url: &str) -> bool {
    let lower = url.to_lowercase();
    lower.contains("list=rd") || lower.contains("start_radio=1")
}

/// Strip yt-dlp noise and map cryptic failures to user-friendly text.
#[cfg(target_os = "android")]
fn sanitize_ytdlp_error(raw: &str) -> String {
    let cleaned: String = raw
        .lines()
        .filter(|line| !line.trim_start().starts_with("WARNING:"))
        .collect::<Vec<_>>()
        .join("\n")
        .trim()
        .to_string();
    if cleaned.is_empty() {
        return "Video bilgisi alınamadı".into();
    }
    let lower = cleaned.to_lowercase();
    if lower.contains("[generic]") && lower.contains("is not a valid url") {
        return "YouTube bu linki çözemedi. Birkaç saniye bekleyip tekrar deneyin.".into();
    }
    cleaned
}

/// Android: prefer pre-muxed single-file formats; merge is attempt 2 in Kotlin.
fn android_video_format(format: &str, container: &str) -> String {
    let trimmed = format.trim();
    if trimmed.is_empty() || trimmed == "best" || trimmed == "bv*+ba/b" {
        return format!(
            "b[ext={container}]/b/best[ext={container}]/best[height<=2160][ext={container}]/best[height<=2160]"
        );
    }
    if trimmed.chars().all(|c| c.is_ascii_digit()) {
        let h = trimmed;
        return format!(
            "b[ext={container}]/b[height<={h}]/best[height<={h}][ext={container}]/best[height<={h}]"
        );
    }
    if let Some(h) = trimmed.split("height<=").nth(1).and_then(|rest| {
        rest.chars()
            .take_while(|c| c.is_ascii_digit())
            .collect::<String>()
            .parse::<u32>()
            .ok()
    }) {
        return format!(
            "b[ext={container}]/b[height<={h}]/best[height<={h}][ext={container}]/best[height<={h}]"
        );
    }
    format!("b[ext={container}]/b/best[ext={container}]")
}

/// Parse execute/getInfo plugin result into MetadataResult.
#[cfg(target_os = "android")]
fn parse_android_metadata_result(
    result: crate::android_ytdlp::YtdlpExecuteResult,
) -> Result<MetadataResult, String> {
    if result.exit_code != 0 {
        return Err(if result.err.trim().is_empty() {
            "Video bilgisi alınamadı".into()
        } else {
            sanitize_ytdlp_error(&result.err)
        });
    }
    let out = result.out.trim();
    if out.is_empty() {
        return Err("Video bilgisi alınamadı (boş yanıt)".into());
    }
    let json: serde_json::Value = serde_json::from_str(out)
        .map_err(|e| format!("Geçersiz yt-dlp JSON: {e}"))?;
    ytdlp::parse_metadata(&json)
}

/// Single-video metadata via YtdlpPlugin.getInfo (-J).
#[cfg(target_os = "android")]
async fn fetch_video_info_android<R: Runtime>(
    app: &AppHandle<R>,
    url: &str,
    cookies: Option<&str>,
    client_tier: u8,
) -> Result<MetadataResult, String> {
    use crate::android_ytdlp::{flat_args_to_options, get_info_ytdlp, YtdlpExecuteArgs};

    let args = android_metadata_args(false, url, cookies, client_tier);
    let result = tokio::time::timeout(
        std::time::Duration::from_secs(120),
        get_info_ytdlp(
            app,
            YtdlpExecuteArgs {
                url: url.to_string(),
                options: flat_args_to_options(&args),
                process_id: None,
            },
        ),
    )
    .await
    .map_err(|_| {
        "Metadata fetch timed out after 120s. Check the link and try again.".to_string()
    })??;
    parse_android_metadata_result(result)
}

/// Playlist metadata via YtdlpPlugin.getInfo (-J --flat-playlist).
#[cfg(target_os = "android")]
async fn fetch_playlist_metadata_android<R: Runtime>(
    app: &AppHandle<R>,
    url: &str,
    cookies: Option<&str>,
    client_tier: u8,
) -> Result<MetadataResult, String> {
    use crate::android_ytdlp::{flat_args_to_options, get_info_ytdlp, YtdlpExecuteArgs};

    let args = android_metadata_args(true, url, cookies, client_tier);
    let result = tokio::time::timeout(
        std::time::Duration::from_secs(240),
        get_info_ytdlp(
            app,
            YtdlpExecuteArgs {
                url: url.to_string(),
                options: flat_args_to_options(&args),
                process_id: None,
            },
        ),
    )
    .await
    .map_err(|_| {
        "Metadata fetch timed out after 240s. Check the link and try again.".to_string()
    })??;
    parse_android_metadata_result(result)
}

/// Android metadata via YtdlpPlugin + Rust JSON parse.
#[cfg(target_os = "android")]
async fn fetch_metadata_android<R: Runtime>(
    app: &AppHandle<R>,
    url: &str,
    flat_playlist: bool,
    cookies_file: Option<&str>,
) -> Result<MetadataResult, String> {
    ensure_engine_warm(app).await?;
    ensure_cookies_warm(app).await;

    let playlist = flat_playlist || ytdlp::looks_like_playlist(url);
    let cookies = resolve_android_cookies(app, cookies_file).await;
    if playlist {
        fetch_playlist_metadata_android(app, url, cookies.as_deref(), 0).await
    } else {
        fetch_video_info_android(app, url, cookies.as_deref(), 0).await
    }
}

/// Android download via YtdlpPlugin.execute (no Rust Child spawn).
#[cfg(target_os = "android")]
async fn run_download_android_inner<R: Runtime>(
    app: &AppHandle<R>,
    opts: &DownloadOptions,
) -> Result<(), String> {
    ensure_cookies_warm(app).await;
    let cookies = resolve_android_cookies(app, opts.cookies_file.as_deref()).await;
    run_download_android_attempt(app, opts, cookies.as_deref(), 0).await
}

/// Build base yt-dlp argv for Android (no URL, no player_client — Kotlin adds tiers).
#[cfg(target_os = "android")]
pub fn build_android_base_download_args(
    opts: &DownloadOptions,
    cookies: Option<&str>,
) -> Vec<String> {
    let mut args = vec![
        "--newline".to_string(),
        "--no-playlist".to_string(),
        "--no-warnings".to_string(),
        "--no-update".to_string(),
        "--progress".to_string(),
        "--force-ipv4".to_string(),
        "--socket-timeout".to_string(),
        "30".to_string(),
        "--retries".to_string(),
        "3".to_string(),
        "--fragment-retries".to_string(),
        "3".to_string(),
    ];
    ytdlp::push_auth_args(&mut args, None, cookies);

    if opts.audio_only {
        let audio_ext = opts
            .container
            .clone()
            .or_else(|| opts.audio_format.clone())
            .unwrap_or_else(|| "mp3".to_string());
        args.push("-x".to_string());
        args.push("--audio-format".to_string());
        args.push(audio_ext);
        args.push("-f".to_string());
        args.push(if !opts.format.is_empty() && opts.format != "bestaudio" {
            opts.format.clone()
        } else {
            "bestaudio/best".to_string()
        });
    } else {
        let container = opts
            .container
            .clone()
            .unwrap_or_else(|| "mp4".to_string());
        let format = android_video_format(&opts.format, &container);
        args.push("-f".to_string());
        args.push(format.clone());
        if format.contains('+') {
            args.push("--merge-output-format".to_string());
            args.push(container);
        }
    }

    if opts.write_subs {
        args.push("--ignore-errors".to_string());
        args.push("--write-subs".to_string());
        if let Some(langs) = &opts.sub_langs {
            if !langs.is_empty() {
                args.push("--sub-langs".to_string());
                args.push(langs.clone());
            }
        }
        args.push("--convert-subs".to_string());
        args.push("srt".to_string());
    }

    if opts.write_thumbnail {
        args.push("--ignore-errors".to_string());
        args.push("--write-thumbnail".to_string());
        args.push("--convert-thumbnails".to_string());
        args.push("jpg".to_string());
    }

    args
}

/// One yt-dlp download attempt with optional bot-retry player clients.
#[cfg(target_os = "android")]
async fn run_download_android_attempt<R: Runtime>(
    app: &AppHandle<R>,
    opts: &DownloadOptions,
    cookies: Option<&str>,
    client_tier: u8,
) -> Result<(), String> {
    use crate::android_ytdlp::{execute_ytdlp, flat_args_to_options, YtdlpExecuteArgs};
    use std::path::PathBuf;

    ensure_engine_warm(app).await?;

    let staging = crate::android_ytdlp::get_staging_dir(app).await?;
    if staging.trim().is_empty() {
        return Err("Cannot resolve Android staging directory".into());
    }
    let out_dir = PathBuf::from(&staging);
    std::fs::create_dir_all(&out_dir)
        .map_err(|e| format!("Cannot create output directory: {e}"))?;

    let mut args = build_android_base_download_args(opts, cookies);
    ytdlp::push_android_youtube_player_clients(&mut args, client_tier);

    let result = execute_ytdlp(
        app,
        YtdlpExecuteArgs {
            url: opts.url.clone(),
            options: flat_args_to_options(&args),
            process_id: Some(opts.id.clone()),
        },
    )
    .await
    .map_err(|e| sanitize_ytdlp_error(&e))?;

    if result.exit_code != 0 {
        let raw = if result.err.trim().is_empty() {
            format!("yt-dlp failed (exit {})", result.exit_code)
        } else {
            result.err
        };
        return Err(sanitize_ytdlp_error(&raw));
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::android_video_format;

    #[test]
    fn android_video_format_best_prefers_muxed() {
        let f = android_video_format("best", "mp4");
        assert!(f.starts_with("b[ext=mp4]/b/"));
        assert!(f.contains("best[ext=mp4]"));
        assert!(!f.contains('+'));
    }

    #[test]
    fn android_video_format_height_from_quality() {
        let f = android_video_format("1080", "mp4");
        assert!(f.contains("height<=1080"));
        assert!(f.starts_with("b[ext=mp4]/"));
        assert!(f.ends_with("best[height<=1080]"));
        assert!(!f.contains('+'));
    }

    #[test]
    fn android_video_format_unknown_falls_back_to_muxed_only() {
        let f = android_video_format("custom+merge/format", "mp4");
        assert_eq!(f, "b[ext=mp4]/b/best[ext=mp4]");
        assert!(!f.contains('+'));
    }

    #[test]
    fn android_video_format_height_from_merge_string() {
        let f = android_video_format("bv*[height<=720]+ba/b[height<=720]/bv*+ba/b", "mp4");
        assert!(f.contains("height<=720"));
        assert!(f.starts_with("b[ext=mp4]/"));
        assert!(!f.contains('+'));
    }
}
