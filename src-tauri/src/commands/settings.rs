use crate::download::adapter::DownloadAdapter;
use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::process::Stdio;
use tauri::AppHandle;
use tauri::Manager;
use tauri_plugin_dialog::DialogExt;

#[cfg(not(target_os = "android"))]
use crate::download::ytdlp::{resolve_ffmpeg_with_dirs, resolve_ytdlp_with_dirs};

/// Collect Android/app data dirs where MainActivity writes acorn-bin wrappers.
#[cfg(not(target_os = "android"))]
fn binary_search_dirs(app: &AppHandle) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Ok(dir) = app.path().app_local_data_dir() {
        dirs.push(dir.join("acorn-bin"));
        dirs.push(dir);
    }
    if let Ok(dir) = app.path().app_data_dir() {
        dirs.push(dir.join("acorn-bin"));
        dirs.push(dir);
    }
    if let Ok(dir) = app.path().app_cache_dir() {
        // App filesDir is typically sibling of cache on Android.
        if let Some(parent) = dir.parent() {
            dirs.push(parent.join("files/acorn-bin"));
            dirs.push(parent.join("files"));
        }
    }
    dirs
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub output_dir: String,
    pub theme: String,
    pub default_quality: String,
    pub ytdlp_path: Option<String>,
    pub ffmpeg_path: Option<String>,
    pub write_subs_default: bool,
    pub write_thumbnail_default: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            output_dir: DownloadAdapter::default_output_dir(),
            theme: "system".into(),
            default_quality: "1080".into(),
            ytdlp_path: None,
            ffmpeg_path: None,
            write_subs_default: false,
            write_thumbnail_default: true,
        }
    }
}

/// Return default settings plus resolved binary paths when available.
#[tauri::command]
pub fn get_default_settings() -> AppSettings {
    AppSettings::default()
}

/// Validate whether yt-dlp / ffmpeg resolve correctly.
#[tauri::command]
pub async fn check_binaries(
    app: AppHandle,
    ytdlp_path: Option<String>,
    ffmpeg_path: Option<String>,
) -> serde_json::Value {
    #[cfg(target_os = "android")]
    {
        let _ = (ytdlp_path, ffmpeg_path);
        match crate::android_ytdlp::is_engine_ready(&app).await {
            Ok(info) if info.ready => serde_json::json!({
                "ytdlp": info.ytdlp,
                "ytdlpError": null,
                "ffmpeg": info.ffmpeg_bin.or(info.ffmpeg),
                "ffmpegReady": info.ffmpeg_ready,
                "stagingPath": info.staging_path,
                "version": info.version,
                "backend": DownloadAdapter::backend_name(),
                "supportsYtdlp": true,
            }),
            Ok(_) => serde_json::json!({
                "ytdlp": null,
                "ytdlpError": "Download engine still initializing. Wait a moment and try again.",
                "ffmpeg": null,
                "backend": DownloadAdapter::backend_name(),
                "supportsYtdlp": true,
            }),
            Err(e) => serde_json::json!({
                "ytdlp": null,
                "ytdlpError": e,
                "ffmpeg": null,
                "backend": DownloadAdapter::backend_name(),
                "supportsYtdlp": true,
            }),
        }
    }

    #[cfg(not(target_os = "android"))]
    {
        let dirs = binary_search_dirs(&app);
        let ytdlp = resolve_ytdlp_with_dirs(ytdlp_path.as_deref(), &dirs);
        let ffmpeg = resolve_ffmpeg_with_dirs(ffmpeg_path.as_deref(), &dirs);
        serde_json::json!({
            "ytdlp": ytdlp.as_ref().map(|p| p.to_string_lossy().to_string()).ok(),
            "ytdlpError": ytdlp.err(),
            "ffmpeg": ffmpeg.map(|p| p.to_string_lossy().to_string()),
            "backend": DownloadAdapter::backend_name(),
            "supportsYtdlp": DownloadAdapter::supports_ytdlp(),
        })
    }
}

/// Open a native directory picker and return the selected path.
/// On mobile, folder picking is unavailable — returns Downloads/Acorn instead.
#[tauri::command]
pub async fn select_directory(app: tauri::AppHandle) -> Result<Option<String>, String> {
    #[cfg(desktop)]
    {
        let (tx, rx) = tokio::sync::oneshot::channel();
        app.dialog().file().pick_folder(move |folder| {
            let path = folder.map(|p| p.to_string());
            let _ = tx.send(path);
        });
        return Ok(rx.await.unwrap_or(None));
    }

    #[cfg(mobile)]
    {
        let base = app
            .path()
            .download_dir()
            .map_err(|e| e.to_string())
            .unwrap_or_else(|_| PathBuf::from(DownloadAdapter::default_output_dir()));
        let dir = if base.ends_with("Acorn") {
            base
        } else {
            base.join("Acorn")
        };
        std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
        Ok(Some(dir.to_string_lossy().into_owned()))
    }
}

/// Open a native file picker (cookies.txt) and return the selected path.
#[tauri::command]
pub async fn select_file(app: tauri::AppHandle) -> Result<Option<String>, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();
    app.dialog()
        .file()
        .add_filter("Cookies", &["txt"])
        .pick_file(move |file| {
            let path = file.map(|p| p.to_string());
            let _ = tx.send(path);
        });
    Ok(rx.await.unwrap_or(None))
}

/// Open a path in the system file manager (folder; reveal file when possible).
#[tauri::command]
pub async fn open_path(app: AppHandle, path: String) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        return crate::android_storage::open_file_inner(&app, path).await;
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        opener_open(&path)
    }
}

/// Open an http(s) URL in the system browser, or a mailto: link in the mail client.
#[tauri::command]
pub async fn open_url(app: AppHandle, url: String) -> Result<(), String> {
    let url = url.trim();
    if !(url.starts_with("https://")
        || url.starts_with("http://")
        || url.starts_with("mailto:"))
    {
        return Err("Only http(s) and mailto: URLs are allowed".into());
    }
    #[cfg(mobile)]
    {
        use tauri_plugin_opener::OpenerExt;
        return app
            .opener()
            .open_url(url, None::<&str>)
            .map_err(|e| e.to_string());
    }
    #[cfg(target_os = "windows")]
    {
        let _ = app;
        return spawn_detached("cmd", &["/C", "start", "", url]);
    }
    #[cfg(target_os = "macos")]
    {
        let _ = app;
        return spawn_detached("open", &[url]);
    }
    #[cfg(all(
        not(target_os = "windows"),
        not(target_os = "macos"),
        not(mobile)
    ))]
    {
        let _ = app;
        spawn_detached("xdg-open", &[url])
            .or_else(|_| spawn_detached("gio", &["open", url]))
            .map_err(|e| format!("Could not open URL: {e}"))
    }
}

/// Resolve a user/history path to an absolute existing file or directory.
fn resolve_open_path(path: &str) -> Result<PathBuf, String> {
    let raw = path.trim();
    if raw.is_empty() {
        return Err("Empty path".into());
    }
    let candidate = PathBuf::from(raw);
    let absolute = if candidate.is_absolute() {
        candidate
    } else {
        std::env::current_dir()
            .map_err(|e| e.to_string())?
            .join(&candidate)
    };
    let absolute = absolute.canonicalize().unwrap_or(absolute);
    if absolute.exists() {
        return Ok(absolute);
    }
    // yt-dlp progress often reports fragment names (e.g. `.f251.webm`) before merge.
    if let Some(parent) = absolute.parent() {
        if parent.is_dir() {
            return Ok(parent.to_path_buf());
        }
    }
    Err(format!("Path not found: {}", absolute.display()))
}

/// Prefer the containing folder so "Open" always shows the file manager.
fn folder_for_path(path: &Path) -> PathBuf {
    if path.is_dir() {
        path.to_path_buf()
    } else {
        path.parent()
            .map(Path::to_path_buf)
            .unwrap_or_else(|| path.to_path_buf())
    }
}

/// Spawn a detached process without inheriting Tauri's custom library path.
fn spawn_detached(program: &str, args: &[&str]) -> Result<(), String> {
    let mut cmd = std::process::Command::new(program);
    cmd.args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    // Tauri/dev shells often set LD_LIBRARY_PATH to bundled GTK/WebKit libs;
    // file managers crash or no-op if they inherit that.
    cmd.env_remove("LD_LIBRARY_PATH");
    cmd.env_remove("LD_PRELOAD");
    cmd.spawn().map_err(|e| format!("{program}: {e}"))?;
    Ok(())
}

fn opener_open(path: &str) -> Result<(), String> {
    let target = resolve_open_path(path)?;
    let target_s = target.to_string_lossy().to_string();
    let folder = folder_for_path(&target);
    let folder_s = folder.to_string_lossy().to_string();

    #[cfg(target_os = "windows")]
    {
        if target.is_file() {
            spawn_detached("explorer", &["/select,", &target_s])?;
        } else {
            spawn_detached("explorer", &[&folder_s])?;
        }
        return Ok(());
    }

    #[cfg(target_os = "macos")]
    {
        if target.is_file() {
            spawn_detached("open", &["-R", &target_s])?;
        } else {
            spawn_detached("open", &[&folder_s])?;
        }
        return Ok(());
    }

    #[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
    {
        let _ = target_s;
        // Reveal file via D-Bus when possible; fall back to opening the folder.
        if target.is_file() {
            let uri = file_uri(&target);
            let arr = format!("array:string:{uri}");
            if spawn_detached(
                "dbus-send",
                &[
                    "--session",
                    "--dest=org.freedesktop.FileManager1",
                    "--type=method_call",
                    "/org/freedesktop/FileManager1",
                    "org.freedesktop.FileManager1.ShowItems",
                    &arr,
                    "string:",
                ],
            )
            .is_ok()
            {
                return Ok(());
            }
        }

        spawn_detached("xdg-open", &[&folder_s])
            .or_else(|_| spawn_detached("nautilus", &[&folder_s]))
            .map_err(|e| format!("Could not open folder: {e}"))?;
        Ok(())
    }
}

/// Build a file:// URI with percent-encoding for non-ASCII / reserved chars.
#[cfg(all(not(target_os = "windows"), not(target_os = "macos")))]
fn file_uri(path: &Path) -> String {
    let mut uri = String::from("file://");
    for byte in path.to_string_lossy().as_bytes() {
        match *byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'/' | b'.' | b'_' | b'-' | b'~' => {
                uri.push(*byte as char);
            }
            _ => uri.push_str(&format!("%{byte:02X}")),
        }
    }
    uri
}
