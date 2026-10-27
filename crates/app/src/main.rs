//! Monks Central desktop app. The window is the only operator (plan D6): it
//! reaches the core through Tauri commands, never through the local socket.

// No console window on Windows release builds; `monks` is the console program.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Arc;

use monks_core::connect::Removed;
use monks_core::fleet::{Change, Found, Job, SiteInventory};
use monks_core::ipc::{self, Role};
use monks_core::sites::{Mode, Site};
use monks_core::{Core, Options, paths, vault};
use serde_json::Value;
use tauri::{Emitter, State};

/// The in-process core, or why it couldn't start (shown in the window).
struct AppCore(Result<Arc<Core>, String>);

type Res<T> = Result<T, String>;

fn core(state: &State<'_, AppCore>) -> Res<Arc<Core>> {
    state.0.clone()
}

fn browser(url: &str) -> std::io::Result<()> {
    open::that_detached(url)
}

#[tauri::command]
fn core_status(state: State<'_, AppCore>) -> Res<Value> {
    let core = core(&state)?;
    let mut status = ipc::status(&core, Role::Operator);
    status["home"] = core.home.display().to_string().into();
    Ok(status)
}

#[tauri::command]
fn sites_list(state: State<'_, AppCore>) -> Res<Vec<Site>> {
    core(&state)?.sites().map_err(|e| e.to_string())
}

#[tauri::command]
fn groups_list(state: State<'_, AppCore>) -> Res<Vec<String>> {
    core(&state)?.groups().map_err(|e| e.to_string())
}

#[tauri::command]
async fn site_add_oauth(state: State<'_, AppCore>, url: String) -> Res<Site> {
    let core = core(&state)?;
    core.add_site_oauth(&url, browser)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn site_add_basic(
    state: State<'_, AppCore>,
    url: String,
    username: String,
    password: String,
) -> Res<Site> {
    let core = core(&state)?;
    core.add_site_basic(&url, &username, &password)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn sign_in_cancel(state: State<'_, AppCore>) -> Res<()> {
    core(&state)?.cancel_sign_in();
    Ok(())
}

#[tauri::command]
async fn site_sign_in_again(
    state: State<'_, AppCore>,
    id: i64,
    username: Option<String>,
    password: Option<String>,
) -> Res<Site> {
    let core = core(&state)?;
    let site = core.site(id).map_err(|e| e.to_string())?;
    let r = match site.mode {
        Mode::ClassicMonks => core.sign_in_again_oauth(id, browser).await,
        Mode::Basic => {
            core.sign_in_again_basic(
                id,
                username.as_deref().unwrap_or_default(),
                password.as_deref().unwrap_or_default(),
            )
            .await
        }
    };
    r.map_err(|e| e.to_string())
}

#[tauri::command]
async fn site_remove(state: State<'_, AppCore>, id: i64) -> Res<Removed> {
    let core = core(&state)?;
    core.remove_site(id).await.map_err(|e| e.to_string())
}

/// Check one site, or every site when `id` is missing.
#[tauri::command]
async fn site_check(state: State<'_, AppCore>, id: Option<i64>) -> Res<()> {
    let core = core(&state)?;
    match id {
        Some(id) => core.check_site(id).await,
        None => core.check_all().await,
    }
    Ok(())
}

/// Open the site's home page in the default browser.
#[tauri::command]
fn site_open(state: State<'_, AppCore>, id: i64) -> Res<()> {
    let site = core(&state)?.site(id).map_err(|e| e.to_string())?;
    browser(&site.url).map_err(|e| e.to_string())
}

#[tauri::command]
fn site_set_group(state: State<'_, AppCore>, id: i64, group: Option<String>) -> Res<Site> {
    core(&state)?
        .set_group(id, group.as_deref())
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn site_set_tags(state: State<'_, AppCore>, id: i64, tags: Vec<String>) -> Res<Site> {
    core(&state)?.set_tags(id, &tags).map_err(|e| e.to_string())
}

#[tauri::command]
fn site_add_note(state: State<'_, AppCore>, id: i64, body: String) -> Res<Site> {
    core(&state)?.add_note(id, &body).map_err(|e| e.to_string())
}

#[tauri::command]
fn site_delete_note(state: State<'_, AppCore>, id: i64, note_id: i64) -> Res<Site> {
    core(&state)?
        .delete_note(id, note_id)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn inventory_list(state: State<'_, AppCore>) -> Res<Vec<SiteInventory>> {
    core(&state)?.inventories().map_err(|e| e.to_string())
}

/// Read one site's plugins and themes again, or every site's.
#[tauri::command]
async fn inventory_refresh(state: State<'_, AppCore>, id: Option<i64>) -> Res<()> {
    let core = core(&state)?;
    let ids = match id {
        Some(id) => vec![id],
        None => core
            .sites()
            .map_err(|e| e.to_string())?
            .iter()
            .map(|s| s.id)
            .collect(),
    };
    let mut first_error = None;
    for id in ids {
        if let Err(e) = core.refresh_inventory(id).await {
            first_error.get_or_insert(e.to_string());
        }
    }
    first_error.map_or(Ok(()), Err)
}

#[tauri::command]
async fn plugin_versions(state: State<'_, AppCore>, id: i64, plugin: String) -> Res<Value> {
    let core = core(&state)?;
    core.plugin_versions(id, &plugin)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn plugin_search(state: State<'_, AppCore>, query: String) -> Res<Vec<Found>> {
    let core = core(&state)?;
    core.search_plugins(&query).await.map_err(|e| e.to_string())
}

/// The human confirmed these changes in the window: run them.
#[tauri::command]
async fn job_start(state: State<'_, AppCore>, title: String, changes: Vec<Change>) -> Res<Job> {
    core(&state)?
        .start_job(&title, changes)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn job_get(state: State<'_, AppCore>, id: i64) -> Res<Job> {
    core(&state)?.job(id).map_err(|e| e.to_string())
}

#[tauri::command]
fn jobs_list(state: State<'_, AppCore>) -> Res<Vec<Job>> {
    core(&state)?.jobs(20).map_err(|e| e.to_string())
}

fn main() {
    let core = tauri::async_runtime::block_on(async {
        let home = paths::data_dir().map_err(|e| e.to_string())?;
        let opts = Options {
            headless: false,
            keychain: vault::os_keychain().map_err(|e| e.to_string()),
        };
        // A headless core (`monks core`, or one the CLI started) finishes and hands over.
        Core::start_or_take_over(&home, opts)
            .await
            .map_err(|e| e.to_string())
    });
    let background = core.clone().ok();
    tauri::Builder::default()
        .manage(AppCore(core))
        .setup(move |app| {
            if let Some(core) = background {
                let handle = app.handle().clone();
                tauri::async_runtime::spawn(async move {
                    let mut changed = core.subscribe();
                    // Renew every grant, then check sites every 15 minutes.
                    core.start_background();
                    use monks_core::Changed;
                    use tokio::sync::broadcast::error::RecvError;
                    loop {
                        let events = match changed.recv().await {
                            Ok(c) => vec![c],
                            // Missed some: reload everything.
                            Err(RecvError::Lagged(_)) => {
                                vec![Changed::Sites, Changed::Inventory, Changed::Jobs]
                            }
                            Err(RecvError::Closed) => break,
                        };
                        for c in events {
                            let _ = handle.emit(c.event(), ());
                        }
                    }
                });
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            core_status,
            sites_list,
            groups_list,
            site_add_oauth,
            site_add_basic,
            sign_in_cancel,
            site_sign_in_again,
            site_remove,
            site_check,
            site_open,
            site_set_group,
            site_set_tags,
            site_add_note,
            site_delete_note,
            inventory_list,
            inventory_refresh,
            plugin_versions,
            plugin_search,
            job_start,
            job_get,
            jobs_list,
        ])
        .run(tauri::generate_context!())
        .expect("Monks Central couldn't open its window");
}
