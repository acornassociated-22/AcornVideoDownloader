use crate::download::adapter::DownloadAdapter;
use crate::download::ytdlp::MetadataResult;
use tauri::AppHandle;

/// Fetch YouTube (or yt-dlp-supported) video/playlist metadata.
#[tauri::command]
pub async fn fetch_metadata(
    app: AppHandle,
    url: String,
    ytdlp_path: Option<String>,
    cookies_from_browser: Option<String>,
    cookies_file: Option<String>,
) -> Result<MetadataResult, String> {
    let trimmed = url.trim();
    if trimmed.is_empty() {
        return Err("URL is required".into());
    }
    DownloadAdapter::fetch_metadata(
        &app,
        trimmed,
        ytdlp_path.as_deref(),
        cookies_from_browser.as_deref(),
        cookies_file.as_deref(),
    )
    .await
}

/// Return platform download backend information.
#[tauri::command]
pub fn get_platform_info() -> serde_json::Value {
    serde_json::json!({
        "backend": DownloadAdapter::backend_name(),
        "supportsYtdlp": DownloadAdapter::supports_ytdlp(),
        "defaultOutputDir": DownloadAdapter::default_output_dir(),
        "os": std::env::consts::OS,
        "arch": std::env::consts::ARCH,
    })
}
