use crate::download::adapter::DownloadAdapter;
use crate::download::ytdlp::DownloadOptions;
use parking_lot::Mutex;
use std::collections::HashMap;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{AppHandle, Emitter, State};

pub struct DownloadState {
    pub cancel_flags: Mutex<HashMap<String, Arc<AtomicBool>>>,
}

impl Default for DownloadState {
    fn default() -> Self {
        Self {
            cancel_flags: Mutex::new(HashMap::new()),
        }
    }
}

/// Start a download and emit `download-progress` events until completion.
#[tauri::command]
pub async fn start_download(
    app: AppHandle,
    state: State<'_, Arc<DownloadState>>,
    opts: DownloadOptions,
) -> Result<(), String> {
    let id = opts.id.clone();
    let cancel = Arc::new(AtomicBool::new(false));
    {
        let mut map = state.cancel_flags.lock();
        map.insert(id.clone(), cancel.clone());
    }

    #[cfg(target_os = "android")]
    {
        let result = start_download_android(app, state.inner().clone(), opts, cancel).await;
        return result;
    }

    #[cfg(not(target_os = "android"))]
    {
        start_download_desktop(app, state, opts, cancel).await
    }
}

/// Android: YoutubeDL.execute via plugin; poll progress file; cancel via destroyProcessById.
#[cfg(target_os = "android")]
async fn start_download_android(
    app: AppHandle,
    state: Arc<DownloadState>,
    opts: DownloadOptions,
    cancel: Arc<AtomicBool>,
) -> Result<(), String> {
    use crate::android_ytdlp::{cancel_ytdlp, read_progress};
    use crate::download::ytdlp::DownloadProgress;

    let id = opts.id.clone();
    let _ = app.emit(
        "download-progress",
        DownloadProgress {
            id: id.clone(),
            percent: 0.0,
            speed: None,
            eta: None,
            status: "downloading".into(),
            filename: None,
            error: None,
            export_mode: None,
        },
    );

    let app_poll = app.clone();
    let id_poll = id.clone();
    let cancel_poll = cancel.clone();
    let poll_task = tokio::spawn(async move {
        loop {
            if cancel_poll.load(Ordering::SeqCst) {
                let _ = cancel_ytdlp(&app_poll, id_poll.clone()).await;
                break;
            }
            if let Ok(snap) = read_progress(&app_poll, id_poll.clone()).await {
                if !snap.status.is_empty() {
                    let _ = app_poll.emit(
                        "download-progress",
                        DownloadProgress {
                            id: id_poll.clone(),
                            percent: snap.percent,
                            speed: None,
                            eta: snap.eta,
                            status: snap.status.clone(),
                            filename: snap.filename,
                            error: snap.error,
                            export_mode: snap.export_mode,
                        },
                    );
                    if snap.status == "completed"
                        || snap.status == "error"
                        || snap.status == "cancelled"
                    {
                        break;
                    }
                }
            }
            tokio::time::sleep(std::time::Duration::from_millis(250)).await;
        }
    });

    let result = DownloadAdapter::run_download_android(&app, &opts).await;
    poll_task.abort();

    state.cancel_flags.lock().remove(&id);

    match result {
        Ok(()) => {
            let snap = read_progress(&app, id.clone()).await.ok();
            let status = snap
                .as_ref()
                .map(|s| s.status.as_str())
                .unwrap_or("completed");
            let filename = snap
                .as_ref()
                .and_then(|s| s.filename.clone())
                .filter(|s| !s.is_empty());
            let error = snap.as_ref().and_then(|s| s.error.clone());
            let export_mode = snap.as_ref().and_then(|s| s.export_mode.clone());

            if status == "error" {
                let msg = error.unwrap_or_else(|| "Export to download folder failed".into());
                let _ = app.emit(
                    "download-progress",
                    DownloadProgress {
                        id: id.clone(),
                        percent: 0.0,
                        speed: None,
                        eta: None,
                        status: "error".into(),
                        filename: None,
                        error: Some(msg.clone()),
                        export_mode: None,
                    },
                );
                return Err(msg);
            }

            let _ = app.emit(
                "download-progress",
                DownloadProgress {
                    id: id.clone(),
                    percent: 100.0,
                    speed: None,
                    eta: None,
                    status: "completed".into(),
                    filename,
                    error: None,
                    export_mode,
                },
            );
            Ok(())
        }
        Err(err) if cancel.load(Ordering::SeqCst) || err.contains("Cancelled") => {
            let _ = app.emit(
                "download-progress",
                DownloadProgress {
                    id,
                    percent: 0.0,
                    speed: None,
                    eta: None,
                    status: "cancelled".into(),
                    filename: None,
                    error: Some("Cancelled by user".into()),
                    export_mode: None,
                },
            );
            Ok(())
        }
        Err(err) => {
            let _ = app.emit(
                "download-progress",
                DownloadProgress {
                    id,
                    percent: 0.0,
                    speed: None,
                    eta: None,
                    status: "error".into(),
                    filename: None,
                    error: Some(err.clone()),
                    export_mode: None,
                },
            );
            Err(err)
        }
    }
}

/// Desktop: spawn yt-dlp Child and pump stdout progress.
#[cfg(not(target_os = "android"))]
async fn start_download_desktop(
    app: AppHandle,
    state: State<'_, Arc<DownloadState>>,
    opts: DownloadOptions,
    cancel: Arc<AtomicBool>,
) -> Result<(), String> {
    let id = opts.id.clone();

    let child = match DownloadAdapter::start_download(&opts).await {
        Ok(child) => child,
        Err(err) => {
            state.cancel_flags.lock().remove(&id);
            return Err(err);
        }
    };

    let app2 = app.clone();
    let id2 = id.clone();
    let cancel2 = cancel.clone();

    let pump = DownloadAdapter::pump_progress(child, id2.clone(), move |mut progress| {
        if cancel2.load(Ordering::SeqCst) {
            progress.status = "cancelled".into();
        }
        let _ = app2.emit("download-progress", progress);
    });

    let cancel_watch = async {
        loop {
            if cancel.load(Ordering::SeqCst) {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(150)).await;
        }
    };

    let result = tokio::select! {
        res = pump => res,
        _ = cancel_watch => {
            let _ = app.emit(
                "download-progress",
                crate::download::ytdlp::DownloadProgress {
                    id: id.clone(),
                    percent: 0.0,
                    speed: None,
                    eta: None,
                    status: "cancelled".into(),
                    filename: None,
                    error: Some("Cancelled by user".into()),
                    export_mode: None,
                },
            );
            Err("Cancelled by user".into())
        }
    };

    state.cancel_flags.lock().remove(&id);

    match result {
        Ok(_) => Ok(()),
        Err(err) if cancel.load(Ordering::SeqCst) || err.contains("Cancelled") => Ok(()),
        Err(err) => Err(err),
    }
}

/// Request cancellation for an in-flight download.
#[tauri::command]
pub async fn cancel_download(
    app: AppHandle,
    state: State<'_, Arc<DownloadState>>,
    id: String,
) -> Result<(), String> {
    // Drop the non-Send MutexGuard before any .await.
    {
        let map = state.cancel_flags.lock();
        if let Some(flag) = map.get(&id) {
            flag.store(true, Ordering::SeqCst);
        } else {
            return Err("No active download with that id".into());
        }
    }

    #[cfg(target_os = "android")]
    {
        let _ = crate::android_ytdlp::cancel_ytdlp(&app, id).await;
    }
    #[cfg(not(target_os = "android"))]
    {
        let _ = app;
    }
    Ok(())
}
