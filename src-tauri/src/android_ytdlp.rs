//! Android yt-dlp bridge via YtdlpPlugin.kt (YoutubeDL.execute).
#![allow(dead_code)] // Used from #[cfg(target_os = "android")] call sites.

use serde::{Deserialize, Serialize};
use tauri::{
    plugin::{Builder, TauriPlugin},
    AppHandle, Runtime,
};

#[cfg(target_os = "android")]
use tauri::Manager;

/// Engine readiness from YtdlpPlugin.isEngineReady.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct EngineReadyInfo {
    pub ready: bool,
    #[serde(default)]
    pub ytdlp: Option<String>,
    #[serde(default)]
    pub ffmpeg: Option<String>,
    #[serde(default)]
    pub version: Option<String>,
    #[serde(default)]
    pub ffmpeg_ready: bool,
    #[serde(default)]
    pub ffmpeg_bin: Option<String>,
    #[serde(default)]
    pub staging_path: Option<String>,
}

/// Result of YtdlpPlugin.execute.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct YtdlpExecuteResult {
    pub exit_code: i32,
    pub out: String,
    pub err: String,
}

/// Args for YtdlpPlugin.execute.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct YtdlpExecuteArgs {
    pub url: String,
    /// Each entry is `[flag]` or `[flag, value]`.
    pub options: Vec<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub process_id: Option<String>,
}

/// Cookie file snapshot from CookieBootstrap.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct CookieStatus {
    #[serde(default)]
    pub exists: bool,
    #[serde(default)]
    pub authenticated: bool,
    #[serde(default)]
    pub age_ms: i64,
    #[serde(default)]
    pub path: String,
    #[serde(default)]
    pub state: String,
}

/// Progress snapshot written by Kotlin during download.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct YtdlpProgressSnapshot {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub percent: f64,
    #[serde(default)]
    pub eta: Option<String>,
    #[serde(default)]
    pub status: String,
    #[serde(default)]
    pub error: Option<String>,
    #[serde(default)]
    pub filename: Option<String>,
    #[serde(default)]
    pub export_mode: Option<String>,
}

#[cfg(target_os = "android")]
struct YtdlpPluginHandle<R: Runtime>(tauri::plugin::PluginHandle<R>);

/// Register Kotlin YtdlpPlugin.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("android-ytdlp")
        .setup(|app, api| {
            #[cfg(target_os = "android")]
            {
                let handle =
                    api.register_android_plugin("com.acorn.videodownloader", "YtdlpPlugin")?;
                app.manage(YtdlpPluginHandle(handle));
            }
            #[cfg(not(target_os = "android"))]
            {
                let _ = (app, api);
            }
            Ok(())
        })
        .build()
}

/// Block until YoutubeDL.init finishes (Android only).
/// Skips the plugin round-trip when the engine is already warm.
pub async fn await_engine_ready<R: Runtime>(
    app: &AppHandle<R>,
    timeout_ms: u64,
) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        let info = is_engine_ready(app).await?;
        if info.ready {
            return Ok(());
        }
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct AwaitArgs {
            timeout_ms: u64,
        }
        let state = app.state::<YtdlpPluginHandle<R>>();
        let _: serde_json::Value = state
            .0
            .run_mobile_plugin_async("awaitReady", AwaitArgs { timeout_ms })
            .await
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, timeout_ms);
        Ok(())
    }
}

/// Ask Kotlin whether YoutubeDL.init finished and binaries exist.
pub async fn is_engine_ready<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<EngineReadyInfo, String> {
    #[cfg(target_os = "android")]
    {
        let state = app.state::<YtdlpPluginHandle<R>>();
        state
            .0
            .run_mobile_plugin_async("isEngineReady", ())
            .await
            .map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Ok(EngineReadyInfo {
            ready: false,
            ..Default::default()
        })
    }
}

/// Run yt-dlp via YoutubeDL.execute (blocking on Kotlin thread pool).
pub async fn execute_ytdlp<R: Runtime>(
    app: &AppHandle<R>,
    args: YtdlpExecuteArgs,
) -> Result<YtdlpExecuteResult, String> {
    #[cfg(target_os = "android")]
    {
        let state = app.state::<YtdlpPluginHandle<R>>();
        state
            .0
            .run_mobile_plugin_async("execute", args)
            .await
            .map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, args);
        Err("YtdlpPlugin is only available on Android.".into())
    }
}

/// Fast single-video metadata via YtdlpPlugin.getInfo (-J / dump-single-json).
pub async fn get_info_ytdlp<R: Runtime>(
    app: &AppHandle<R>,
    args: YtdlpExecuteArgs,
) -> Result<YtdlpExecuteResult, String> {
    #[cfg(target_os = "android")]
    {
        let state = app.state::<YtdlpPluginHandle<R>>();
        state
            .0
            .run_mobile_plugin_async("getInfo", args)
            .await
            .map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, args);
        Err("YtdlpPlugin is only available on Android.".into())
    }
}

/// Cancel a running YoutubeDL process by id.
pub async fn cancel_ytdlp<R: Runtime>(app: &AppHandle<R>, id: String) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct CancelArgs {
            id: String,
        }
        let state = app.state::<YtdlpPluginHandle<R>>();
        let _: serde_json::Value = state
            .0
            .run_mobile_plugin_async("cancel", CancelArgs { id })
            .await
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, id);
        Ok(())
    }
}

/// App-private staging directory where yt-dlp writes before SAF/public export.
pub async fn get_staging_dir<R: Runtime>(app: &AppHandle<R>) -> Result<String, String> {
    #[cfg(target_os = "android")]
    {
        let state = app.state::<YtdlpPluginHandle<R>>();
        let result: serde_json::Value = state
            .0
            .run_mobile_plugin_async("getStagingDir", ())
            .await
            .map_err(|e| e.to_string())?;
        result
            .get("path")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .ok_or_else(|| "Staging directory path missing from plugin".to_string())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Err("Staging dir is only available on Android.".into())
    }
}

/// Read last progress snapshot for a download id.
pub async fn read_progress<R: Runtime>(
    app: &AppHandle<R>,
    id: String,
) -> Result<YtdlpProgressSnapshot, String> {
    #[cfg(target_os = "android")]
    {
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct IdArgs {
            id: String,
        }
        let state = app.state::<YtdlpPluginHandle<R>>();
        state
            .0
            .run_mobile_plugin_async("readProgress", IdArgs { id })
            .await
            .map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, id);
        Ok(YtdlpProgressSnapshot::default())
    }
}

/// Read cookie file path from Kotlin (dynamic filesDir).
pub async fn get_cookies_path<R: Runtime>(app: &AppHandle<R>) -> Result<String, String> {
    #[cfg(target_os = "android")]
    {
        let state = app.state::<YtdlpPluginHandle<R>>();
        let result: serde_json::Value = state
            .0
            .run_mobile_plugin_async("getCookiesPath", ())
            .await
            .map_err(|e| e.to_string())?;
        result
            .get("path")
            .and_then(|v| v.as_str())
            .map(str::trim)
            .filter(|s| !s.is_empty())
            .map(str::to_string)
            .ok_or_else(|| "Cookie path missing from plugin".to_string())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Err("Cookies are only available on Android.".into())
    }
}

/// Read cookie authentication state.
pub async fn get_cookie_status<R: Runtime>(app: &AppHandle<R>) -> Result<CookieStatus, String> {
    #[cfg(target_os = "android")]
    {
        let state = app.state::<YtdlpPluginHandle<R>>();
        state
            .0
            .run_mobile_plugin_async("getCookieStatus", ())
            .await
            .map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Ok(CookieStatus::default())
    }
}

/// Wait for CookieBootstrap to finish (guest or authenticated).
pub async fn await_cookies_ready<R: Runtime>(
    app: &AppHandle<R>,
    timeout_ms: u64,
) -> Result<CookieStatus, String> {
    #[cfg(target_os = "android")]
    {
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct CookieAwaitArgs {
            timeout_ms: u64,
        }
        let state = app.state::<YtdlpPluginHandle<R>>();
        state
            .0
            .run_mobile_plugin_async(
                "awaitCookiesReady",
                CookieAwaitArgs { timeout_ms },
            )
            .await
            .map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, timeout_ms);
        Ok(CookieStatus::default())
    }
}

/// Force silent WebView cookie harvest via plugin.
pub async fn refresh_cookies<R: Runtime>(
    app: &AppHandle<R>,
    force: bool,
) -> Result<CookieStatus, String> {
    #[cfg(target_os = "android")]
    {
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct RefreshArgs {
            force: bool,
        }
        let state = app.state::<YtdlpPluginHandle<R>>();
        state
            .0
            .run_mobile_plugin_async("refreshCookies", RefreshArgs { force })
            .await
            .map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, force);
        Ok(CookieStatus::default())
    }
}

/// Convert flat yt-dlp argv (no URL) into `[flag]` / `[flag, value]` pairs.
pub fn flat_args_to_options(args: &[String]) -> Vec<Vec<String>> {
    let mut out = Vec::new();
    let mut i = 0;
    while i < args.len() {
        let cur = &args[i];
        if cur.starts_with('-')
            && i + 1 < args.len()
            && !args[i + 1].starts_with('-')
        {
            out.push(vec![cur.clone(), args[i + 1].clone()]);
            i += 2;
        } else {
            out.push(vec![cur.clone()]);
            i += 1;
        }
    }
    out
}

/// Tauri command: read YouTube cookie status.
#[tauri::command]
pub async fn get_youtube_cookie_status<R: Runtime>(
    app: AppHandle<R>,
) -> Result<CookieStatus, String> {
    get_cookie_status(&app).await
}

/// Tauri command: wait for cookie bootstrap.
#[tauri::command]
pub async fn await_youtube_cookies<R: Runtime>(
    app: AppHandle<R>,
    timeout_ms: Option<u64>,
) -> Result<CookieStatus, String> {
    await_cookies_ready(&app, timeout_ms.unwrap_or(8_000)).await
}

/// Tauri command: force silent cookie refresh.
#[tauri::command]
pub async fn refresh_youtube_cookies<R: Runtime>(
    app: AppHandle<R>,
    force: Option<bool>,
) -> Result<CookieStatus, String> {
    refresh_cookies(&app, force.unwrap_or(true)).await
}
