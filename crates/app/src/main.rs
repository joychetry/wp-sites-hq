//! Monks Central desktop app. The window is the only operator (plan D6): it
//! reaches the core through Tauri commands, never through the local socket.

// No console window on Windows release builds; `monks` is the console program.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Arc;

use monks_core::ipc::{self, Role};
use monks_core::{Core, paths};
use serde_json::Value;

/// The in-process core, or why it couldn't start (shown in the window).
struct AppCore(Result<Arc<Core>, String>);

#[tauri::command]
fn core_status(core: tauri::State<'_, AppCore>) -> Result<Value, String> {
    let core = core.0.as_ref().map_err(Clone::clone)?;
    let mut status = ipc::status(core, Role::Operator);
    status["home"] = core.home.display().to_string().into();
    Ok(status)
}

fn main() {
    let core = tauri::async_runtime::block_on(async {
        let home = paths::data_dir().map_err(|e| e.to_string())?;
        // A headless core (`monks core`, or one the CLI started) finishes and hands over.
        Core::start_or_take_over(&home, Default::default())
            .await
            .map_err(|e| e.to_string())
    });
    tauri::Builder::default()
        .manage(AppCore(core))
        .invoke_handler(tauri::generate_handler![core_status])
        .run(tauri::generate_context!())
        .expect("Monks Central couldn't open its window");
}
