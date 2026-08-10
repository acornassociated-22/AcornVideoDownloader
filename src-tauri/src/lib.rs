mod android_download;
mod android_storage;
mod android_ytdlp;
mod commands;
mod download;

use commands::download::DownloadState;
use std::sync::Arc;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let download_state = Arc::new(DownloadState::default());

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_store::Builder::new().build())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(android_storage::init())
        .plugin(android_ytdlp::init())
        .plugin(android_download::init())
        .manage(download_state)
        .invoke_handler(tauri::generate_handler![
            commands::metadata::fetch_metadata,
            commands::metadata::get_platform_info,
            commands::settings::get_default_settings,
            commands::settings::check_binaries,
            commands::settings::select_directory,
            commands::settings::select_file,
            commands::settings::open_path,
            commands::settings::open_url,
            commands::contact::send_contact_message,
            commands::download::start_download,
            commands::download::cancel_download,
            android_storage::pick_export_folder,
            android_storage::get_export_folder,
            android_storage::clear_export_folder,
            android_storage::export_downloaded_file,
            android_storage::open_export_folder,
            android_storage::pick_cookies_file,
            android_ytdlp::get_youtube_cookie_status,
            android_ytdlp::await_youtube_cookies,
            android_ytdlp::refresh_youtube_cookies,
            android_download::ensure_download_service,
            android_download::sync_orchestrator_queue,
            android_download::get_orchestrator_state,
            android_download::pause_orchestrator,
            android_download::resume_orchestrator,
            android_download::pause_active_job,
            android_download::resume_orchestrator_job,
            android_download::retry_orchestrator_job,
            android_download::cancel_orchestrator_job,
            android_download::requeue_failed_bot_items,
            android_download::request_notification_permission,
            android_download::get_pending_navigation,
            android_download::open_youtube_login,
            android_download::check_ytdlp_update,
            android_download::apply_ytdlp_update,
            android_download::open_battery_optimization_settings,
            android_download::android_log,
            android_download::prepare_android_download_options,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Acorn Video Downloader");
}
