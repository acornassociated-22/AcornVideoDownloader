//! Android SAF export folder plugin bridge (StoragePlugin.kt).

use serde::{Deserialize, Serialize};
use tauri::{
    plugin::{Builder, TauriPlugin},
    AppHandle, Runtime,
};

#[cfg(target_os = "android")]
use tauri::Manager;

/// Folder info returned by StoragePlugin.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportFolderInfo {
    pub tree_uri: Option<String>,
    pub display_name: String,
    pub mode: String,
}

/// Args for StoragePlugin.exportFile.
#[cfg(target_os = "android")]
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ExportFileArgs {
    source_path: String,
    file_name: Option<String>,
    tree_uri: Option<String>,
}

/// Args for StoragePlugin.openExportFolder.
#[cfg(target_os = "android")]
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct OpenExportFolderArgs {
    #[serde(skip_serializing_if = "Option::is_none")]
    path: Option<String>,
}

/// Args for StoragePlugin.openFile.
#[cfg(target_os = "android")]
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct OpenFileArgs {
    path: String,
}

#[cfg(target_os = "android")]
struct StoragePluginHandle<R: Runtime>(tauri::plugin::PluginHandle<R>);

/// Register Kotlin StoragePlugin (commands live on the app invoke handler).
pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("android-storage")
        .setup(|app, api| {
            #[cfg(target_os = "android")]
            {
                let handle =
                    api.register_android_plugin("com.acorn.videodownloader", "StoragePlugin")?;
                app.manage(StoragePluginHandle(handle));
            }
            #[cfg(not(target_os = "android"))]
            {
                let _ = (app, api);
            }
            Ok(())
        })
        .build()
}

/// Open SAF tree picker and persist write access.
#[tauri::command]
pub async fn pick_export_folder<R: Runtime>(
    app: AppHandle<R>,
) -> Result<ExportFolderInfo, String> {
    #[cfg(target_os = "android")]
    {
        let state = app.state::<StoragePluginHandle<R>>();
        state
            .0
            .run_mobile_plugin_async("pickExportFolder", ())
            .await
            .map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Err("Folder picking is only available on Android.".into())
    }
}

/// Read current export folder (SAF or public Downloads/Acorn).
#[tauri::command]
pub async fn get_export_folder<R: Runtime>(
    app: AppHandle<R>,
) -> Result<ExportFolderInfo, String> {
    #[cfg(target_os = "android")]
    {
        let state = app.state::<StoragePluginHandle<R>>();
        state
            .0
            .run_mobile_plugin_async("getExportFolder", ())
            .await
            .map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Ok(ExportFolderInfo {
            tree_uri: None,
            display_name: "Downloads/Acorn".into(),
            mode: "public".into(),
        })
    }
}

/// Clear SAF folder and fall back to public Downloads/Acorn.
#[tauri::command]
pub async fn clear_export_folder<R: Runtime>(
    app: AppHandle<R>,
) -> Result<ExportFolderInfo, String> {
    #[cfg(target_os = "android")]
    {
        let state = app.state::<StoragePluginHandle<R>>();
        state
            .0
            .run_mobile_plugin_async("clearExportFolder", ())
            .await
            .map_err(|e| e.to_string())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
        Ok(ExportFolderInfo {
            tree_uri: None,
            display_name: "Downloads/Acorn".into(),
            mode: "public".into(),
        })
    }
}

/// Copy a finished download into the chosen SAF/public folder.
#[tauri::command]
pub async fn export_downloaded_file<R: Runtime>(
    app: AppHandle<R>,
    source_path: String,
    file_name: Option<String>,
) -> Result<String, String> {
    export_downloaded_file_inner(&app, source_path, file_name).await
}

/// Shared export path used by the Tauri command and post-download hook.
#[cfg(target_os = "android")]
pub async fn export_downloaded_file_inner<R: Runtime>(
    app: &AppHandle<R>,
    source_path: String,
    file_name: Option<String>,
) -> Result<String, String> {
    let state = app.state::<StoragePluginHandle<R>>();
    let result: serde_json::Value = state
        .0
        .run_mobile_plugin_async(
            "exportFile",
            ExportFileArgs {
                source_path,
                file_name,
                tree_uri: None,
            },
        )
        .await
        .map_err(|e| e.to_string())?;
    Ok(result
        .get("destination")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .to_string())
}

#[cfg(not(target_os = "android"))]
pub async fn export_downloaded_file_inner<R: Runtime>(
    _app: &AppHandle<R>,
    _source_path: String,
    _file_name: Option<String>,
) -> Result<String, String> {
    Err("Export is only available on Android.".into())
}

/// Open a file or export folder via StoragePlugin (Android only).
#[cfg(target_os = "android")]
pub async fn open_file_inner<R: Runtime>(
    app: &AppHandle<R>,
    path: String,
) -> Result<(), String> {
    let state = app.state::<StoragePluginHandle<R>>();
    let _: serde_json::Value = state
        .0
        .run_mobile_plugin_async("openFile", OpenFileArgs { path })
        .await
        .map_err(|e| e.to_string())?;
    Ok(())
}

/// Open the configured export folder (SAF tree or Downloads/Acorn).
#[tauri::command]
pub async fn open_export_folder<R: Runtime>(
    app: AppHandle<R>,
    path: Option<String>,
) -> Result<(), String> {
    #[cfg(target_os = "android")]
    {
        let state = app.state::<StoragePluginHandle<R>>();
        let _: serde_json::Value = state
            .0
            .run_mobile_plugin_async(
                "openExportFolder",
                OpenExportFolderArgs {
                    path: path.filter(|s| !s.trim().is_empty()),
                },
            )
            .await
            .map_err(|e| e.to_string())?;
        Ok(())
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = (app, path);
        Err("Open export folder is only available on Android.".into())
    }
}

/// Open SAF document picker for cookies.txt and import into app storage.
#[tauri::command]
pub async fn pick_cookies_file<R: Runtime>(app: AppHandle<R>) -> Result<CookieImportResult, String> {
    pick_cookies_file_inner(&app).await
}

/// Result of importing a cookies.txt file on Android.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CookieImportResult {
    pub imported: bool,
    pub authenticated: bool,
    pub path: String,
    pub state: String,
}

/// Shared import path for the Tauri command.
#[cfg(target_os = "android")]
pub async fn pick_cookies_file_inner<R: Runtime>(
    app: &AppHandle<R>,
) -> Result<CookieImportResult, String> {
    let state = app.state::<StoragePluginHandle<R>>();
    state
        .0
        .run_mobile_plugin_async("pickCookiesFile", ())
        .await
        .map_err(|e| e.to_string())
}

#[cfg(not(target_os = "android"))]
pub async fn pick_cookies_file_inner<R: Runtime>(
    _app: &AppHandle<R>,
) -> Result<CookieImportResult, String> {
    Err("Cookie import is only available on Android.".into())
}

#[cfg(not(target_os = "android"))]
pub async fn open_file_inner<R: Runtime>(_app: &AppHandle<R>, _path: String) -> Result<(), String> {
    Err("Open file is only available on Android.".into())
}
