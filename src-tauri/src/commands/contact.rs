use serde::Deserialize;

/// Kept for API compatibility; delivery is handled in the WebView via Web3Forms.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ContactPayload {
    pub name: String,
    pub email: String,
    pub message: String,
}

/// Contact form posts from the frontend (Web3Forms). Rust path is unused.
#[tauri::command]
pub async fn send_contact_message(_payload: ContactPayload) -> Result<(), String> {
    Err("Contact form uses Web3Forms from the UI. Update the app frontend.".into())
}
