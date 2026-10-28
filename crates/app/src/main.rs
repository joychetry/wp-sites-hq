//! Monks Central desktop app. The window is the only operator (plan D6): it
//! reaches the core through Tauri commands, never through the local socket.

// No console window on Windows release builds; `monks` is the console program.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::sync::Arc;

use monks_core::activity::{Actor, Entry};
use monks_core::connect::{Removed, SiteError};
use monks_core::content::{Draft, Listing, Media, Post, PostType, Query, Term};
use monks_core::control::{Activity, Approval, FeatureGroup, Setting};
use monks_core::fleet::{Change, Found, Job, SiteInventory};
use monks_core::ipc::{self, Role};
use monks_core::people::{Comments, NewUser, User, Users};
use monks_core::security::Report;
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

/// Record a change the person made in the window (plan 5.8), and hand its result on.
fn done<T>(core: &Core, site: Option<i64>, what: &str, r: Result<T, SiteError>) -> Res<T> {
    core.record_result(Actor::Human, site, what, r)
        .map_err(|e| e.to_string())
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
    let r = core.add_site_oauth(&url, browser).await;
    done(&core, None, &format!("Added {url}"), r)
}

#[tauri::command]
async fn site_add_basic(
    state: State<'_, AppCore>,
    url: String,
    username: String,
    password: String,
) -> Res<Site> {
    let core = core(&state)?;
    let r = core.add_site_basic(&url, &username, &password).await;
    done(&core, None, &format!("Added {url} in Basic mode"), r)
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
    done(&core, Some(id), "Signed in again", r)
}

#[tauri::command]
async fn site_remove(state: State<'_, AppCore>, id: i64) -> Res<Removed> {
    let core = core(&state)?;
    let name = core.site(id).map(|s| s.name).unwrap_or_default();
    let r = core.remove_site(id).await;
    done(&core, None, &format!("Removed {name}"), r)
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

#[tauri::command]
async fn content_types(state: State<'_, AppCore>, id: i64) -> Res<Vec<PostType>> {
    let core = core(&state)?;
    core.post_types(id).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn content_list(state: State<'_, AppCore>, id: i64, query: Query) -> Res<Listing> {
    let core = core(&state)?;
    core.posts(id, &query).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn content_get(
    state: State<'_, AppCore>,
    id: i64,
    post_type: String,
    post_id: i64,
) -> Res<Post> {
    let core = core(&state)?;
    core.post(id, &post_type, post_id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn content_terms(
    state: State<'_, AppCore>,
    id: i64,
    taxonomy: String,
    search: String,
) -> Res<Vec<Term>> {
    let core = core(&state)?;
    core.terms(id, &taxonomy, &search)
        .await
        .map_err(|e| e.to_string())
}

/// The human pressed Save in the editor.
#[tauri::command]
async fn content_create(
    state: State<'_, AppCore>,
    id: i64,
    post_type: String,
    draft: Draft,
) -> Res<Post> {
    let core = core(&state)?;
    let what = format!(
        "Added a {post_type}: {}",
        draft.title.as_deref().unwrap_or("")
    );
    let r = core.create_post(id, &post_type, draft).await;
    done(&core, Some(id), &what, r)
}

#[tauri::command]
async fn content_edit(
    state: State<'_, AppCore>,
    id: i64,
    post_type: String,
    post_id: i64,
    draft: Draft,
) -> Res<Post> {
    let core = core(&state)?;
    let r = core.edit_post(id, &post_type, post_id, draft).await;
    let what = match &r {
        Ok(p) => format!("Edited {post_type} {post_id}: {}", p.title),
        Err(_) => format!("Edited {post_type} {post_id}"),
    };
    done(&core, Some(id), &what, r)
}

/// The human confirmed moving it to the trash.
#[tauri::command]
async fn content_trash(
    state: State<'_, AppCore>,
    id: i64,
    post_type: String,
    post_id: i64,
) -> Res<()> {
    let core = core(&state)?;
    let r = core.trash_post(id, &post_type, post_id).await;
    done(
        &core,
        Some(id),
        &format!("Moved {post_type} {post_id} to the trash"),
        r,
    )
}

#[tauri::command]
async fn media_list(
    state: State<'_, AppCore>,
    id: i64,
    page: u32,
    search: String,
    images: bool,
) -> Res<Vec<Media>> {
    let core = core(&state)?;
    core.media(id, page, &search, images)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn media_import(state: State<'_, AppCore>, id: i64, url: String, alt: String) -> Res<Media> {
    let core = core(&state)?;
    let r = core.import_media(id, &url, &alt).await;
    done(&core, Some(id), &format!("Added an image from {url}"), r)
}

#[tauri::command]
async fn users_list(state: State<'_, AppCore>, id: i64, search: String, page: u32) -> Res<Users> {
    let core = core(&state)?;
    core.users(id, &search, page)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn user_create(state: State<'_, AppCore>, id: i64, user: NewUser) -> Res<User> {
    let core = core(&state)?;
    let what = format!("Added the user {} as {}", user.username, user.role);
    let r = core.create_user(id, user).await;
    done(&core, Some(id), &what, r)
}

#[tauri::command]
async fn user_set_role(state: State<'_, AppCore>, id: i64, user_id: i64, role: String) -> Res<()> {
    let core = core(&state)?;
    let r = core.set_role(id, user_id, &role).await;
    done(&core, Some(id), &format!("Made user {user_id} {role}"), r)
}

/// The human confirmed deleting the user and who gets their content.
#[tauri::command]
async fn user_delete(state: State<'_, AppCore>, id: i64, user_id: i64, reassign: i64) -> Res<()> {
    let core = core(&state)?;
    let r = core.delete_user(id, user_id, reassign).await;
    let what = format!("Deleted user {user_id}, content to user {reassign}");
    done(&core, Some(id), &what, r)
}

/// Returns the address the email went to.
#[tauri::command]
async fn user_reset(state: State<'_, AppCore>, id: i64, user_id: i64) -> Res<String> {
    let core = core(&state)?;
    let r = core.send_password_reset(id, user_id).await;
    done(
        &core,
        Some(id),
        &format!("Emailed user {user_id} a password reset"),
        r,
    )
}

#[tauri::command]
async fn comments_list(state: State<'_, AppCore>, id: i64, status: String) -> Res<Comments> {
    let core = core(&state)?;
    core.comments(id, &status).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn comment_moderate(
    state: State<'_, AppCore>,
    id: i64,
    comment_id: i64,
    action: String,
) -> Res<()> {
    let core = core(&state)?;
    let r = core.moderate(id, comment_id, &action).await;
    done(
        &core,
        Some(id),
        &format!("Comment {comment_id}: {action}"),
        r,
    )
}

#[tauri::command]
async fn comment_reply(
    state: State<'_, AppCore>,
    id: i64,
    comment_id: i64,
    post_id: i64,
    text: String,
) -> Res<()> {
    let core = core(&state)?;
    let r = core.reply(id, comment_id, post_id, &text).await;
    done(
        &core,
        Some(id),
        &format!("Replied to comment {comment_id}"),
        r,
    )
}

/// Sign into the site's wp-admin in the browser, as the connected user.
#[tauri::command]
async fn site_login(state: State<'_, AppCore>, id: i64) -> Res<()> {
    let core = core(&state)?;
    let r = core.login_link(id).await;
    let link = done(&core, Some(id), "Logged in to the dashboard", r)?;
    browser(&link).map_err(|e| e.to_string())
}

#[tauri::command]
async fn cm_features(state: State<'_, AppCore>, id: i64) -> Res<Vec<FeatureGroup>> {
    let core = core(&state)?;
    core.features(id).await.map_err(|e| e.to_string())
}

/// Returns the activity row that undoes the change, if the site has one.
#[tauri::command]
async fn cm_set_feature(
    state: State<'_, AppCore>,
    id: i64,
    name: String,
    on: bool,
) -> Res<Option<i64>> {
    let core = core(&state)?;
    let r = core.set_feature(id, &name, on).await;
    let what = format!("Turned {} {name}", if on { "on" } else { "off" });
    done(&core, Some(id), &what, r)
}

#[tauri::command]
async fn cm_settings(state: State<'_, AppCore>, id: i64) -> Res<Vec<Setting>> {
    let core = core(&state)?;
    core.settings(id).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn cm_set_setting(
    state: State<'_, AppCore>,
    id: i64,
    name: String,
    value: Value,
) -> Res<Option<i64>> {
    let core = core(&state)?;
    let what = format!("Set {name} to {value}");
    let r = core.set_setting(id, &name, value).await;
    done(&core, Some(id), &what, r)
}

#[tauri::command]
async fn cm_activity(state: State<'_, AppCore>, id: i64, page: u32) -> Res<Activity> {
    let core = core(&state)?;
    core.activity(id, page).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn cm_undo(state: State<'_, AppCore>, id: i64, row: i64) -> Res<()> {
    let core = core(&state)?;
    let r = core.undo(id, row).await;
    done(
        &core,
        Some(id),
        &format!("Undid Classic Monks activity row {row}"),
        r,
    )
}

#[tauri::command]
async fn cm_approvals(state: State<'_, AppCore>, id: i64) -> Res<Vec<Approval>> {
    let core = core(&state)?;
    core.approvals(id).await.map_err(|e| e.to_string())
}

/// Open the site's own page to approve or decline a waiting change.
#[tauri::command]
async fn cm_approval_open(state: State<'_, AppCore>, id: i64, op: i64) -> Res<()> {
    let core = core(&state)?;
    let link = core
        .approval_link(id, op)
        .await
        .map_err(|e| e.to_string())?;
    browser(&link).map_err(|e| e.to_string())
}

/// Give AI agents their own grant on the site: the person signs in in the
/// browser and leaves "operator" unticked.
#[tauri::command]
async fn agent_access_on(state: State<'_, AppCore>, id: i64) -> Res<Site> {
    let core = core(&state)?;
    let r = core.add_agent_access(id, browser).await;
    done(&core, Some(id), "Turned on AI agent access", r)
}

#[tauri::command]
async fn agent_access_off(state: State<'_, AppCore>, id: i64) -> Res<Site> {
    let core = core(&state)?;
    let r = core.remove_agent_access(id).await;
    done(&core, Some(id), "Turned off AI agent access", r)
}

/// AI agents' plans waiting for the person.
#[tauri::command]
fn plans_waiting(state: State<'_, AppCore>) -> Res<Vec<Job>> {
    core(&state)?.waiting_plans().map_err(|e| e.to_string())
}

/// The person pressed Confirm on an agent's plan: only the window can.
#[tauri::command]
async fn plan_confirm(state: State<'_, AppCore>, id: i64) -> Res<Job> {
    core(&state)?
        .confirm_plan(id)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn plan_decline(state: State<'_, AppCore>, id: i64) -> Res<Job> {
    core(&state)?.decline_plan(id).map_err(|e| e.to_string())
}

#[tauri::command]
fn activity_list(state: State<'_, AppCore>, before: Option<i64>) -> Res<Vec<Entry>> {
    core(&state)?
        .activity_log(before)
        .map_err(|e| e.to_string())
}

/// Open a link from an outside feed (a vulnerability report) in the browser.
#[tauri::command]
fn link_open(url: String) -> Res<()> {
    if !url.starts_with("https://") {
        return Err("Only https links open from Monks Central.".into());
    }
    browser(&url).map_err(|e| e.to_string())
}

#[tauri::command]
fn security_list(state: State<'_, AppCore>) -> Res<Vec<Report>> {
    core(&state)?.security_reports().map_err(|e| e.to_string())
}

/// Scan one site, or every site.
#[tauri::command]
async fn security_scan(state: State<'_, AppCore>, id: Option<i64>) -> Res<()> {
    let core = core(&state)?;
    match id {
        Some(id) => core
            .scan_security(id)
            .await
            .map(drop)
            .map_err(|e| e.to_string()),
        None => {
            core.scan_all_security(false).await;
            Ok(())
        }
    }
}

fn main() {
    let core = tauri::async_runtime::block_on(async {
        let home = paths::data_dir().map_err(|e| e.to_string())?;
        let opts = Options {
            headless: false,
            keychain: vault::os_keychain().map_err(|e| e.to_string()),
            ..Default::default()
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
                                vec![
                                    Changed::Sites,
                                    Changed::Inventory,
                                    Changed::Jobs,
                                    Changed::Activity,
                                    Changed::Security,
                                ]
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
            content_types,
            content_list,
            content_get,
            content_terms,
            content_create,
            content_edit,
            content_trash,
            media_list,
            media_import,
            users_list,
            user_create,
            user_set_role,
            user_delete,
            user_reset,
            comments_list,
            comment_moderate,
            comment_reply,
            site_login,
            cm_features,
            cm_set_feature,
            cm_settings,
            cm_set_setting,
            cm_activity,
            cm_undo,
            cm_approvals,
            cm_approval_open,
            agent_access_on,
            agent_access_off,
            plans_waiting,
            plan_confirm,
            plan_decline,
            activity_list,
            security_list,
            security_scan,
            link_open,
        ])
        .run(tauri::generate_context!())
        .expect("Monks Central couldn't open its window");
}
