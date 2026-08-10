//! Android download service + orchestrator bridge (DownloadPlugin.kt).

#[cfg(target_os = "android")]
use crate::download::adapter::build_android_base_download_args;
use crate::download::ytdlp::DownloadOptions;
use serde::{Deserialize, Serialize};
use tauri::{
    plugin::{Builder, TauriPlugin},
    AppHandle, Runtime,
};

#[cfg(target_os = "android")]
use tauri::Manager;

#[cfg(target_os = "android")]
struct DownloadPluginHandle<R: Runtime>(tauri::plugin::PluginHandle<R>);

/// Queue item payload from React for orchestrator sync.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrchestratorSyncItem {
    pub id: String,
    pub url: String,
    pub title: String,
    pub status: String,
    #[serde(default)]
    pub percent: f64,
    pub format: String,
    pub audio_only: bool,
    pub audio_format: String,
    pub container: String,
    pub write_subs: bool,
    pub sub_langs: String,
    pub write_thumbnail: bool,
    #[serde(default)]
    pub retry_count: i32,
    #[serde(default)]
    pub last_bot_error_at: i64,
    #[serde(default)]
    pub cooldown_until: i64,
    #[serde(default)]
    pub filename: Option<String>,
    #[serde(default)]
    pub error: Option<String>,
}

/// Full orchestrator sync payload from React store.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OrchestratorSyncPayload {
    pub items: Vec<OrchestratorSyncItem>,
    pub settings: serde_json::Value,
    #[serde(default)]
    pub active_id: Option<String>,
    #[serde(default)]
    pub global_bot_streak: i32,
    #[serde(default)]
    pub success_count: i32,
    #[serde(default)]
    pub paused_until: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct NotificationPermissionResult {
    pub granted: bool,
    #[serde(default)]
    pub requested: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct PendingNavigation {
    #[serde(default)]
    pub shared_url: Option<String>,
    #[serde(default)]
    pub open_page: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct YtdlpUpdateInfo {
    pub current_version: String,
    pub latest_version: String,
    pub update_available: bool,
    #[serde(default)]
    pub download_url: Option<String>,
    #[serde(default)]
    pub sha256: Option<String>,
}

/// Register Kotlin DownloadPlugin.
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("android-download")
        .setup(|app, api| {
            #[cfg(target_os = "android")]
            {
                let handle =
                    api.register_android_plugin("com.acorn.videodownloader", "DownloadPlugin")?;
                app.manage(DownloadPluginHandle(handle));
            }
            #[cfg(not(target_os = "android"))]
            {
                let _ = (app, api);
            }
            Ok(())
        })
        .build()
}

#[cfg(target_os = "android")]
async fn resolve_android_cookies<R: Runtime>(app: &AppHandle<R>, cookies_file: Option<&str>) -> Option<String> {
    if let Some(path) = cookies_file.filter(|p| !p.trim().is_empty()) {
        return Some(path.to_string());
    }
    crate::android_ytdlp::get_cookies_path(app).await.ok()
}

#[cfg(target_os = "android")]
fn sync_item_to_download_options(item: &OrchestratorSyncItem, settings: &serde_json::Value) -> DownloadOptions {
    DownloadOptions {
        id: item.id.clone(),
        url: item.url.clone(),
        format: if item.audio_only {
            "bestaudio/best".to_string()
        } else {
            item.format.clone()
        },
        output_dir: settings
            .get("outputDir")
            .and_then(|v| v.as_str())
            .unwrap_or("downloads")
            .to_string(),
        audio_only: item.audio_only,
        audio_format: Some(item.audio_format.clone()),
        container: Some(item.container.clone()),
        write_subs: item.write_subs,
        sub_langs: Some(item.sub_langs.clone()).filter(|s| !s.is_empty()),
        write_thumbnail: item.write_thumbnail,
        ytdlp_path: None,
        ffmpeg_path: None,
        cookies_from_browser: None,
        cookies_file: settings
            .get("cookiesFile")
            .and_then(|v| v.as_str())
            .map(str::to_string),
    }
}

#[cfg(target_os = "android")]
fn build_orchestrator_json(
    payload: &OrchestratorSyncPayload,
    options_by_id: &[(String, Vec<Vec<String>>)],
) -> String {
    use serde_json::json;

    let options_map: std::collections::HashMap<_, _> = options_by_id.iter().cloned().collect();
    let items: Vec<_> = payload
        .items
        .iter()
        .map(|item| {
            let options = options_map.get(&item.id).cloned().unwrap_or_default();
            json!({
                "id": item.id,
                "url": item.url,
                "title": item.title,
                "status": item.status,
                "percent": item.percent,
                "retryCount": item.retry_count,
                "lastBotErrorAt": item.last_bot_error_at,
                "cooldownUntil": item.cooldown_until,
                "filename": item.filename,
                "error": item.error,
                "options": options,
            })
        })
        .collect();

    serde_json::json!({
        "items": items,
        "settings": payload.settings,
        "activeId": payload.active_id,
        "globalBotStreak": payload.global_bot_streak,
        "successCount": payload.success_count,
        "pausedUntil": payload.paused_until,
    })
    .to_string()
}

/// Start foreground service and restore orchestrator state.
#[tauri::command]
pub async fn ensure_download_service<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        let state = app.state::<DownloadPluginHandle<R>>();
        let _: serde_json::Value = state
            .0
            .run_mobile_plugin_async("ensureDownloadService", ())
            .await
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Ok(())
    }
}

/// Sync React queue snapshot to Kotlin DownloadOrchestrator.
#[tauri::command]
pub async fn sync_orchestrator_queue<R: Runtime>(
    app: AppHandle<R>,
    payload: OrchestratorSyncPayload,
) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        let cookies = resolve_android_cookies(
            &app,
            payload
                .settings
                .get("cookiesFile")
                .and_then(|v| v.as_str()),
        )
        .await;

        let mut options_by_id = Vec::new();
        for item in &payload.items {
            let opts = sync_item_to_download_options(item, &payload.settings);
            let flat = build_android_base_download_args(&opts, cookies.as_deref());
            let options = crate::android_ytdlp::flat_args_to_options(&flat);
            options_by_id.push((item.id.clone(), options));
        }

        let json = build_orchestrator_json(&payload, &options_by_id);
        #[derive(Serialize)]
        struct SyncArgs {
            json: String,
        }
        let state = app.state::<DownloadPluginHandle<R>>();
        let _: serde_json::Value = state
            .0
            .run_mobile_plugin_async("syncOrchestratorQueue", SyncArgs { json })
            .await
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, payload);
        Ok(())
    }
}

/// Read orchestrator state JSON from Kotlin.
#[tauri::command]
pub async fn get_orchestrator_state<R: Runtime>(app: AppHandle<R>) -> Result<String, String> {
    #[cfg(target_os = "android")]
    {
        let state = app.state::<DownloadPluginHandle<R>>();
        let result: serde_json::Value = state
            .0
            .run_mobile_plugin_async("getOrchestratorState", ())
            .await
            .map_err(|e| e.to_string())?;
        result
            .get("state")
            .and_then(|v| v.as_str())
            .map(str::to_string)
            .ok_or_else(|| "Orchestrator state missing".to_string())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Ok("{}".into())
    }
}

#[tauri::command]
pub async fn pause_orchestrator<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        let state = app.state::<DownloadPluginHandle<R>>();
        let _: serde_json::Value = state
            .0
            .run_mobile_plugin_async("pauseOrchestrator", ())
            .await
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Ok(())
    }
}

#[tauri::command]
pub async fn resume_orchestrator<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        let state = app.state::<DownloadPluginHandle<R>>();
        let _: serde_json::Value = state
            .0
            .run_mobile_plugin_async("resumeOrchestrator", ())
            .await
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Ok(())
    }
}

#[tauri::command]
pub async fn pause_active_job<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        let state = app.state::<DownloadPluginHandle<R>>();
        let _: serde_json::Value = state
            .0
            .run_mobile_plugin_async("pauseActiveJob", ())
            .await
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Ok(())
    }
}

#[tauri::command]
pub async fn resume_orchestrator_job<R: Runtime>(
    app: AppHandle<R>,
    id: String,
) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        #[derive(Serialize)]
        struct IdArgs {
            id: String,
        }
        let state = app.state::<DownloadPluginHandle<R>>();
        let _: serde_json::Value = state
            .0
            .run_mobile_plugin_async("resumeOrchestratorJob", IdArgs { id })
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

#[tauri::command]
pub async fn retry_orchestrator_job<R: Runtime>(
    app: AppHandle<R>,
    id: String,
) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        #[derive(Serialize)]
        struct IdArgs {
            id: String,
        }
        let state = app.state::<DownloadPluginHandle<R>>();
        let _: serde_json::Value = state
            .0
            .run_mobile_plugin_async("retryOrchestratorJob", IdArgs { id })
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

#[tauri::command]
pub async fn cancel_orchestrator_job<R: Runtime>(app: AppHandle<R>, id: String) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        #[derive(Serialize)]
        struct IdArgs {
            id: String,
        }
        let state = app.state::<DownloadPluginHandle<R>>();
        let _: serde_json::Value = state
            .0
            .run_mobile_plugin_async("cancelOrchestratorJob", IdArgs { id })
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

#[tauri::command]
pub async fn requeue_failed_bot_items<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        let state = app.state::<DownloadPluginHandle<R>>();
        let _: serde_json::Value = state
            .0
            .run_mobile_plugin_async("requeueFailedBotItems", ())
            .await
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Ok(())
    }
}

#[tauri::command]
pub async fn request_notification_permission<R: Runtime>(
    app: AppHandle<R>,
) -> Result<NotificationPermissionResult, String> {
    #[cfg(target_os = "android")]
    {
        let state = app.state::<DownloadPluginHandle<R>>();
        state
            .0
            .run_mobile_plugin_async("requestNotificationPermission", ())
            .await
            .map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Ok(NotificationPermissionResult {
            granted: true,
            requested: false,
        })
    }
}

#[tauri::command]
pub async fn get_pending_navigation<R: Runtime>(
    app: AppHandle<R>,
) -> Result<PendingNavigation, String> {
    #[cfg(target_os = "android")]
    {
        let state = app.state::<DownloadPluginHandle<R>>();
        state
            .0
            .run_mobile_plugin_async("getPendingNavigation", ())
            .await
            .map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Ok(PendingNavigation::default())
    }
}

#[tauri::command]
pub async fn open_youtube_login<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        let state = app.state::<DownloadPluginHandle<R>>();
        let _: serde_json::Value = state
            .0
            .run_mobile_plugin_async("openYoutubeLogin", ())
            .await
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Err("YouTube login is only available on Android.".into())
    }
}

#[tauri::command]
pub async fn check_ytdlp_update<R: Runtime>(
    app: AppHandle<R>,
    force: Option<bool>,
) -> Result<YtdlpUpdateInfo, String> {
    #[cfg(target_os = "android")]
    {
        #[derive(Serialize)]
        struct ForceArgs {
            force: bool,
        }
        let state = app.state::<DownloadPluginHandle<R>>();
        state
            .0
            .run_mobile_plugin_async(
                "checkYtdlpUpdate",
                ForceArgs {
                    force: force.unwrap_or(false),
                },
            )
            .await
            .map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Err("yt-dlp update is only available on Android.".into())
    }
}

#[tauri::command]
pub async fn apply_ytdlp_update<R: Runtime>(app: AppHandle<R>) -> Result<serde_json::Value, String> {
    #[cfg(target_os = "android")]
    {
        let state = app.state::<DownloadPluginHandle<R>>();
        state
            .0
            .run_mobile_plugin_async("applyYtdlpUpdate", ())
            .await
            .map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Err("yt-dlp update is only available on Android.".into())
    }
}

#[tauri::command]
pub async fn open_battery_optimization_settings<R: Runtime>(app: AppHandle<R>) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        let state = app.state::<DownloadPluginHandle<R>>();
        let _: serde_json::Value = state
            .0
            .run_mobile_plugin_async("openBatteryOptimizationSettings", ())
            .await
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Ok(())
    }
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AndroidLogArgs {
    pub tag: String,
    pub message: String,
}

#[tauri::command]
pub async fn android_log<R: Runtime>(app: AppHandle<R>, tag: String, message: String) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        let state = app.state::<DownloadPluginHandle<R>>();
        let _: serde_json::Value = state
            .0
            .run_mobile_plugin_async("androidLog", AndroidLogArgs { tag, message })
            .await
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, tag, message);
        Ok(())
    }
}

/// Build yt-dlp option pairs for one Android download (used by orchestrator sync).
#[tauri::command]
pub async fn prepare_android_download_options<R: Runtime>(
    app: AppHandle<R>,
    opts: DownloadOptions,
) -> Result<Vec<Vec<String>>, String> {
    #[cfg(target_os = "android")]
    {
        let cookies = resolve_android_cookies(&app, opts.cookies_file.as_deref()).await;
        let flat = build_android_base_download_args(&opts, cookies.as_deref());
        Ok(crate::android_ytdlp::flat_args_to_options(&flat))
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, opts);
        Ok(vec![])
    }
}
