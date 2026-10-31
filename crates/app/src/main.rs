// SPDX-License-Identifier: GPL-3.0-or-later
//! WP Sites HQ desktop app. The window is the only operator (plan D6): it
//! reaches the core through Tauri commands, never through the local socket.

// No console window on Windows release builds; `wpshq` (and `monks`) is the console program.
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use std::collections::BTreeMap;
use std::sync::Arc;

use monks_core::activity::{Actor, Entry};
use monks_core::business::{AppSettings, Client, Cost, Imported};
use monks_core::connect::{Removed, SiteError};
use monks_core::content::{
    AcfSaved, Draft, Found as ContentFound, Listing, Post, PostType, Query, Revision, Term,
};
use monks_core::control::{Activity, Approval, CmReports, FeatureGroup, Setting};
use monks_core::fleet::{Change, Found, Job, SiteInventory};
use monks_core::ipc::{self, Role};
use monks_core::media::{self, Details, Library, Media, MediaQuery, Moved};
use monks_core::monitor::{Monitor, PageSpeed};
use monks_core::packages::{Bundle, PluginZip, Staged};
use monks_core::people::{Comments, NewUser, User, Users};
use monks_core::report::{ReportAsk, Saved};
use monks_core::security::Report;
use monks_core::seo::GscStatus;
use monks_core::shop::{Overview, ProductQuery, Products};
use monks_core::sites::{Mode, Site};
use monks_core::wporg::Kind;
use monks_core::{Core, Options, paths, vault};
use serde_json::Value;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::{AppHandle, Emitter, Manager, State, WindowEvent};
use tauri_plugin_notification::NotificationExt;

mod update;

/// The in-process core, or why it couldn't start (shown in the window).
struct AppCore(Result<Arc<Core>, String>);

type Res<T> = Result<T, String>;

fn core(state: &State<'_, AppCore>) -> Res<Arc<Core>> {
    state.0.clone()
}

/// Only web pages open: a site's sign-in details or links can't start another app
/// (smb:, file:, search-ms: and the like).
fn browser(url: &str) -> std::io::Result<()> {
    if !is_web(url) {
        return Err(std::io::Error::other("WP Sites HQ only opens web links."));
    }
    open::that_detached(url)
}

fn is_web(url: &str) -> bool {
    url.starts_with("https://") || url.starts_with("http://")
}

/// A report or export WP Sites HQ saved: right in the Downloads folder.
fn saved_by_us(p: &std::path::Path) -> bool {
    paths::downloads().is_ok_and(|d| p.parent() == Some(d.as_path()))
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

/// The site's icon as a `data:` URL, or null.
#[tauri::command]
fn site_icon(state: State<'_, AppCore>, id: i64) -> Res<Option<String>> {
    Ok(core(&state)?.site_icon(id))
}

/// A plugin's icon or a theme's screenshot from WordPress.org as a `data:` URL, or null.
#[tauri::command]
fn package_icon(state: State<'_, AppCore>, kind: Kind, slug: String) -> Res<Option<String>> {
    Ok(core(&state)?.package_icon(kind, &slug))
}

/// Every cached WordPress.org image, `plugin/akismet` to when it was saved.
#[tauri::command]
fn package_icons(state: State<'_, AppCore>) -> Res<BTreeMap<String, i64>> {
    Ok(core(&state)?.package_icons())
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

/// Switch a site to the connection of the plugin installed on it (from Basic mode),
/// keeping its group, tags and notes.
#[tauri::command]
async fn site_connect_plugin(state: State<'_, AppCore>, id: i64) -> Res<Site> {
    let core = core(&state)?;
    let r = core.sign_in_again_oauth(id, browser).await;
    done(&core, Some(id), "Connected through the site's plugin", r)
}

/// The WP Sites HQ plugin's newest release, checksum checked, saved in Downloads
/// for the site's Upload Plugin page.
#[tauri::command]
async fn plugin_download(app: AppHandle, state: State<'_, AppCore>, id: i64) -> Res<PluginZip> {
    let core = core(&state)?;
    let dir = app.path().download_dir().map_err(|e| e.to_string())?;
    let r = core.save_monks_central(&dir).await;
    done(
        &core,
        Some(id),
        "Saved the WP Sites HQ plugin in Downloads",
        r,
    )
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
async fn content_revisions(state: State<'_, AppCore>, id: i64, post_id: i64) -> Res<Vec<Revision>> {
    core(&state)?
        .revisions(id, post_id)
        .await
        .map_err(|e| e.to_string())
}

/// The human picked a saved version to put back.
#[tauri::command]
async fn content_restore_revision(
    state: State<'_, AppCore>,
    id: i64,
    post_id: i64,
    revision_id: i64,
) -> Res<String> {
    let core = core(&state)?;
    let r = core.restore_revision(id, revision_id).await;
    done(
        &core,
        Some(id),
        &format!("Restored an earlier version of entry {post_id}"),
        r,
    )
}

#[tauri::command]
async fn content_untrash(state: State<'_, AppCore>, id: i64, post_id: i64) -> Res<String> {
    let core = core(&state)?;
    let r = core.untrash_post(id, post_id).await;
    done(
        &core,
        Some(id),
        &format!("Brought entry {post_id} back from the trash"),
        r,
    )
}

/// The entry's ACF field groups and values; null when the site has no ACF.
#[tauri::command]
async fn content_acf(state: State<'_, AppCore>, id: i64, post_id: i64) -> Res<Option<Value>> {
    let core = core(&state)?;
    core.acf_fields(id, post_id)
        .await
        .map_err(|e| e.to_string())
}

/// The human saved ACF fields in the editor.
#[tauri::command]
async fn content_acf_save(
    state: State<'_, AppCore>,
    id: i64,
    post_id: i64,
    fields: serde_json::Map<String, Value>,
) -> Res<AcfSaved> {
    let core = core(&state)?;
    let r = core.save_acf(id, post_id, fields).await;
    done(
        &core,
        Some(id),
        &format!("Saved ACF fields of entry {post_id}"),
        r,
    )
}

#[tauri::command]
async fn media_list(state: State<'_, AppCore>, id: i64, query: MediaQuery) -> Res<Library> {
    let core = core(&state)?;
    core.media(id, &query).await.map_err(|e| e.to_string())
}

/// One item with the number of entries using it.
#[tauri::command]
async fn media_get(state: State<'_, AppCore>, id: i64, media_id: i64) -> Res<Media> {
    let core = core(&state)?;
    core.media_item(id, media_id)
        .await
        .map_err(|e| e.to_string())
}

/// Uploads and replaces under way, by the window's key, so Stop can reach them.
#[derive(Default)]
struct Sending(std::sync::Mutex<BTreeMap<String, Arc<std::sync::atomic::AtomicBool>>>);

impl Sending {
    fn start(&self, key: &str) -> Arc<std::sync::atomic::AtomicBool> {
        let stop = Arc::new(std::sync::atomic::AtomicBool::new(false));
        self.0.lock().unwrap().insert(key.into(), stop.clone());
        stop
    }
    fn end(&self, key: &str) {
        self.0.lock().unwrap().remove(key);
    }
}

/// `media-progress` events for the window: bytes sent of all, by key.
fn progress(app: &AppHandle, key: &str) -> impl Fn(u64, u64) + Send + Sync + use<> {
    let (app, key) = (app.clone(), key.to_string());
    move |sent, total| {
        let _ = app.emit(
            "media-progress",
            serde_json::json!({ "key": key, "sent": sent, "total": total }),
        );
    }
}

/// A file the person picked or dropped in the window, as base64. Never a path.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
async fn media_upload(
    app: AppHandle,
    state: State<'_, AppCore>,
    sending: State<'_, Sending>,
    id: i64,
    key: String,
    name: String,
    data: String,
    details: Details,
) -> Res<Media> {
    let core = core(&state)?;
    let stop = sending.start(&key);
    let r = match media::decode_file(&data) {
        Ok(bytes) => {
            drop(data);
            core.upload_media(id, &name, &bytes, &details, &progress(&app, &key), &stop)
                .await
        }
        Err(e) => Err(e),
    };
    sending.end(&key);
    done(&core, Some(id), &format!("Uploaded {name}"), r)
}

/// Put a picked file in place of an item's file (same ID and, unless `keep_name`, address).
#[tauri::command]
#[allow(clippy::too_many_arguments)]
async fn media_replace(
    app: AppHandle,
    state: State<'_, AppCore>,
    sending: State<'_, Sending>,
    id: i64,
    media_id: i64,
    key: String,
    name: String,
    data: String,
    keep_name: bool,
) -> Res<Media> {
    let core = core(&state)?;
    let stop = sending.start(&key);
    let r = match media::decode_file(&data) {
        Ok(bytes) => {
            drop(data);
            let tell = progress(&app, &key);
            core.replace_media(id, media_id, &name, &bytes, keep_name, &tell, &stop)
                .await
        }
        Err(e) => Err(e),
    };
    sending.end(&key);
    done(
        &core,
        Some(id),
        &format!("Replaced the file of media item {media_id} with {name}"),
        r,
    )
}

/// Stop an upload or replace between chunks.
#[tauri::command]
fn media_stop(sending: State<'_, Sending>, key: String) {
    if let Some(stop) = sending.0.lock().unwrap().get(&key) {
        stop.store(true, std::sync::atomic::Ordering::Relaxed);
    }
}

#[tauri::command]
async fn media_update(
    state: State<'_, AppCore>,
    id: i64,
    media_id: i64,
    details: Details,
) -> Res<Media> {
    let core = core(&state)?;
    let r = core.update_media(id, media_id, &details).await;
    done(
        &core,
        Some(id),
        &format!("Changed the details of media item {media_id}"),
        r,
    )
}

/// Put back the file an item had before its last replace.
#[tauri::command]
async fn media_restore_file(state: State<'_, AppCore>, id: i64, media_id: i64) -> Res<Media> {
    let core = core(&state)?;
    let r = core.restore_replaced_media(id, media_id).await;
    done(
        &core,
        Some(id),
        &format!("Put back the earlier file of media item {media_id}"),
        r,
    )
}

/// Move items to the media trash, or bring them back (`back`).
#[tauri::command]
async fn media_trash(state: State<'_, AppCore>, id: i64, ids: Vec<i64>, back: bool) -> Res<Moved> {
    let core = core(&state)?;
    let r = core.trash_media(id, &ids, back).await;
    let what = match (back, ids.len()) {
        (false, 1) => "Moved 1 media item to the trash".to_string(),
        (false, n) => format!("Moved {n} media items to the trash"),
        (true, 1) => "Brought 1 media item back from the trash".to_string(),
        (true, n) => format!("Brought {n} media items back from the trash"),
    };
    done(&core, Some(id), &what, r)
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
async fn cm_reports(state: State<'_, AppCore>, id: i64, days: u32) -> Res<CmReports> {
    let core = core(&state)?;
    core.cm_reports(id, days).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn store_products(state: State<'_, AppCore>, id: i64, query: ProductQuery) -> Res<Products> {
    let core = core(&state)?;
    core.products(id, &query).await.map_err(|e| e.to_string())
}

#[tauri::command]
async fn store_overview(state: State<'_, AppCore>, id: i64, days: u32) -> Res<Overview> {
    let core = core(&state)?;
    core.store_overview(id, days, None)
        .await
        .map_err(|e| e.to_string())
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

#[tauri::command]
fn clients_list(state: State<'_, AppCore>) -> Res<Vec<Client>> {
    core(&state)?.clients().map_err(|e| e.to_string())
}

#[tauri::command]
fn client_save(state: State<'_, AppCore>, client: Client) -> Res<Client> {
    core(&state)?
        .save_client(&client)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn client_delete(state: State<'_, AppCore>, id: i64) -> Res<()> {
    core(&state)?.delete_client(id).map_err(|e| e.to_string())
}

#[tauri::command]
fn site_set_client(state: State<'_, AppCore>, id: i64, client: Option<i64>) -> Res<()> {
    core(&state)?
        .set_site_client(id, client)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn costs_list(state: State<'_, AppCore>) -> Res<Vec<Cost>> {
    core(&state)?.costs().map_err(|e| e.to_string())
}

#[tauri::command]
fn cost_save(state: State<'_, AppCore>, cost: Cost) -> Res<Cost> {
    core(&state)?.save_cost(&cost).map_err(|e| e.to_string())
}

#[tauri::command]
fn cost_delete(state: State<'_, AppCore>, id: i64) -> Res<()> {
    core(&state)?.delete_cost(id).map_err(|e| e.to_string())
}

#[tauri::command]
fn app_settings_get(state: State<'_, AppCore>) -> Res<AppSettings> {
    core(&state)?.app_settings().map_err(|e| e.to_string())
}

#[tauri::command]
fn app_settings_save(state: State<'_, AppCore>, settings: AppSettings) -> Res<AppSettings> {
    core(&state)?
        .save_app_settings(&settings)
        .map_err(|e| e.to_string())
}

/// Current version, last check, the version found and its download.
#[tauri::command]
fn app_update_status(app: AppHandle) -> update::Status {
    update::status(&app)
}

/// Look for a newer WP Sites HQ on GitHub Releases now.
#[tauri::command]
async fn app_update_check(app: AppHandle, state: State<'_, AppCore>) -> Res<update::Status> {
    update::check(&app, core(&state).ok()).await
}

/// Install the new version (its signature checked against the public key in
/// tauri.conf.json) and restart. `false`: not now, nothing was installed.
#[tauri::command]
async fn app_update_install(
    app: AppHandle,
    state: State<'_, AppCore>,
    when_idle: bool,
) -> Res<bool> {
    update::install(&app, core(&state).ok(), when_idle).await
}

/// Save to the Downloads folder and return where it went.
fn save_download(name: &str, bytes: &[u8]) -> Res<String> {
    paths::downloads()
        .and_then(|d| paths::save_new(&d, name, bytes))
        .map(|p| p.display().to_string())
        .map_err(|e| format!("Couldn't save {name} in Downloads: {e}"))
}

/// Every site, client and cost as JSON, or the site list as CSV, into Downloads.
#[tauri::command]
fn sites_export(state: State<'_, AppCore>, csv: bool) -> Res<String> {
    let text = core(&state)?.export(csv).map_err(|e| e.to_string())?;
    let today = paths::day(monks_core::oauth::now());
    let ext = if csv { "csv" } else { "json" };
    save_download(&format!("wp-sites-hq-sites-{today}.{ext}"), text.as_bytes())
}

/// A monthly report as HTML and PDF, into Downloads.
#[tauri::command]
async fn report_make(state: State<'_, AppCore>, ask: ReportAsk) -> Res<Saved> {
    let core = core(&state)?;
    let dir = paths::downloads().map_err(|e| e.to_string())?;
    core.client_report(&ask, &dir)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn file_open(path: String) -> Res<()> {
    let p = std::path::Path::new(&path);
    // Only the reports and exports WP Sites HQ wrote.
    let ours = saved_by_us(p);
    let kind = p.extension().and_then(|e| e.to_str());
    if !ours || !matches!(kind, Some("html" | "pdf")) {
        return Err("WP Sites HQ only opens the reports it saved.".into());
    }
    open::that_detached(p).map_err(|e| e.to_string())
}

#[tauri::command]
fn gsc_status(state: State<'_, AppCore>) -> Res<GscStatus> {
    core(&state)?.gsc_status().map_err(|e| e.to_string())
}

#[tauri::command]
fn gsc_set_client(state: State<'_, AppCore>, id: String, secret: String) -> Res<GscStatus> {
    core(&state)?
        .gsc_set_client(&id, &secret)
        .map_err(|e| e.to_string())
}

#[tauri::command]
async fn gsc_connect(state: State<'_, AppCore>) -> Res<GscStatus> {
    let core = core(&state)?;
    let r = core.gsc_connect(browser).await;
    done(&core, None, "Connected Google Search Console", r)
}

#[tauri::command]
fn gsc_forget(state: State<'_, AppCore>) -> Res<GscStatus> {
    let core = core(&state)?;
    let r = core.gsc_forget();
    done(
        &core,
        None,
        "Removed the Google Search Console connection",
        r,
    )
}

#[tauri::command]
fn sites_import(state: State<'_, AppCore>, text: String) -> Res<Imported> {
    core(&state)?.import(&text).map_err(|e| e.to_string())
}

/// Show a saved file in the file manager.
#[tauri::command]
fn file_show(path: String) -> Res<()> {
    let p = std::path::Path::new(&path);
    if !saved_by_us(p) {
        return Err("WP Sites HQ only shows the files it saved.".into());
    }
    let folder = p
        .parent()
        .filter(|_| p.is_file())
        .ok_or("That file isn't there any more.")?;
    open::that_detached(folder).map_err(|e| e.to_string())
}

#[tauri::command]
async fn content_search(state: State<'_, AppCore>, query: String) -> Res<ContentFound> {
    core(&state)?
        .search_content(&query)
        .await
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn bundles_list(state: State<'_, AppCore>) -> Res<Vec<Bundle>> {
    core(&state)?.bundles().map_err(|e| e.to_string())
}

#[tauri::command]
fn bundle_save(state: State<'_, AppCore>, bundle: Bundle) -> Res<Bundle> {
    core(&state)?
        .save_bundle(&bundle)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn bundle_delete(state: State<'_, AppCore>, id: i64) -> Res<()> {
    core(&state)?.delete_bundle(id).map_err(|e| e.to_string())
}

/// A zip the person picked, kept for an install job.
#[tauri::command]
fn zip_stage(state: State<'_, AppCore>, name: String, data: String) -> Res<Staged> {
    core(&state)?
        .stage_zip_base64(&name, &data)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn monitors_list(state: State<'_, AppCore>) -> Res<Vec<Monitor>> {
    core(&state)?.monitors().map_err(|e| e.to_string())
}

/// Load every home page and look up every domain now.
#[tauri::command]
async fn monitors_check(state: State<'_, AppCore>) -> Res<()> {
    core(&state)?.check_monitors(true).await;
    Ok(())
}

#[tauri::command]
async fn pagespeed_run(state: State<'_, AppCore>, id: i64) -> Res<PageSpeed> {
    core(&state)?
        .run_pagespeed(id)
        .await
        .map_err(|e| e.to_string())
}

/// Open a link from an outside feed (a vulnerability report) in the browser.
#[tauri::command]
fn link_open(state: State<'_, AppCore>, url: String, site: Option<i64>) -> Res<()> {
    if !link_scheme_ok(&url, site) {
        return Err("Only https links open from WP Sites HQ.".into());
    }
    // A site's own link must point at that site.
    if let Some(id) = site {
        core(&state)?
            .link_on_site(id, &url)
            .map_err(|e| e.to_string())?;
    }
    browser(&url).map_err(|e| e.to_string())
}

/// https, or http for a site's own address (a local test site the person added over http).
fn link_scheme_ok(url: &str, site: Option<i64>) -> bool {
    url.starts_with("https://") || (site.is_some() && url.starts_with("http://"))
}

/// The window only ever shows the app's own pages: a link in site content can't take it elsewhere.
fn app_page(url: &tauri::Url) -> bool {
    match (url.scheme(), url.host_str()) {
        ("tauri", Some("localhost")) => true,
        ("http" | "https", Some("tauri.localhost")) => true, // Windows
        ("http", Some("localhost")) => cfg!(debug_assertions) && url.port() == Some(1420), // devUrl
        _ => url.as_str() == "about:blank",
    }
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

/// The "still watching from the tray" notice was shown this run.
struct TrayHinted;

/// The tray's status line, changed as checks come in.
struct TrayStatus(MenuItem<tauri::Wry>);

fn show_window(app: &AppHandle) {
    if let Some(w) = app.get_webview_window("main") {
        let _ = w.show();
        let _ = w.unminimize();
        let _ = w.set_focus();
    }
}

/// The tray agent: closing the window leaves WP Sites HQ watching the
/// sites from here; Quit stops it. Linux trays show only the menu, so the
/// menu opens the window too.
fn tray(app: &AppHandle, core: Arc<Core>) -> tauri::Result<()> {
    let status = MenuItem::with_id(app, "status", "Checking your sites…", false, None::<&str>)?;
    let open = MenuItem::with_id(app, "open", "Open WP Sites HQ", true, None::<&str>)?;
    let check = MenuItem::with_id(app, "check", "Load every home page now", true, None::<&str>)?;
    let quit = MenuItem::with_id(app, "quit", "Quit WP Sites HQ", true, None::<&str>)?;
    let line = PredefinedMenuItem::separator(app)?;
    let line2 = PredefinedMenuItem::separator(app)?;
    let menu = Menu::with_items(app, &[&status, &line, &open, &check, &line2, &quit])?;
    let icon = app
        .default_window_icon()
        .cloned()
        .ok_or(tauri::Error::InvalidIcon(std::io::Error::other(
            "no window icon",
        )))?;
    tauri::tray::TrayIconBuilder::with_id("main")
        .icon(icon)
        .tooltip("WP Sites HQ")
        .menu(&menu)
        .show_menu_on_left_click(false)
        .on_tray_icon_event(|tray, event| {
            if let tauri::tray::TrayIconEvent::Click {
                button: tauri::tray::MouseButton::Left,
                button_state: tauri::tray::MouseButtonState::Up,
                ..
            } = event
            {
                show_window(tray.app_handle());
            }
        })
        .on_menu_event(move |app, event| match event.id.as_ref() {
            "open" => show_window(app),
            "check" => {
                let core = core.clone();
                tauri::async_runtime::spawn(async move { core.check_monitors(true).await });
            }
            "quit" => {
                let (core, app) = (core.clone(), app.clone());
                // Let in-flight site work finish, then go.
                tauri::async_runtime::spawn(async move {
                    core.finish().await;
                    app.exit(0);
                });
            }
            _ => {}
        })
        .build(app)?;
    app.manage(TrayStatus(status));
    Ok(())
}

/// After a round of checks: the tray line, and a notice per site that went
/// down or came back.
fn monitors_changed(app: &AppHandle, core: &Core, was_down: &mut std::collections::HashSet<i64>) {
    let (Ok(monitors), Ok(sites)) = (core.monitors(), core.sites()) else {
        return;
    };
    let names: Vec<(i64, &str)> = sites.iter().map(|s| (s.id, s.name.as_str())).collect();
    let line = monks_core::monitor::tray_line(&monitors, &names);
    if let Some(status) = app.try_state::<TrayStatus>() {
        let _ = status.0.set_text(&line);
    }
    if let Some(tray) = app.tray_by_id("main") {
        let _ = tray.set_tooltip(Some(format!("WP Sites HQ: {line}")));
    }
    for (title, body) in monks_core::monitor::news(was_down, &monitors, &names) {
        let _ = app.notification().builder().title(title).body(body).show();
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
        // A headless core (`wpshq core`, or one the CLI started) finishes and hands over.
        Core::start_or_take_over(&home, opts)
            .await
            .map_err(|e| e.to_string())
    });
    let background = core.clone().ok();
    tauri::Builder::default()
        .plugin(tauri_plugin_notification::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(
            tauri::plugin::Builder::<tauri::Wry>::new("stay-in-app")
                .on_navigation(|_, url| app_page(url))
                .build(),
        )
        .manage(AppCore(core))
        .manage(Sending::default())
        .manage(update::Updates::default())
        .on_window_event(|window, event| {
            // With a tray, closing the window keeps the sites watched.
            if let WindowEvent::CloseRequested { api, .. } = event
                && window.app_handle().tray_by_id("main").is_some()
            {
                api.prevent_close();
                let _ = window.hide();
                let app = window.app_handle();
                if app.try_state::<TrayHinted>().is_none() {
                    app.manage(TrayHinted);
                    let _ = app
                        .notification()
                        .builder()
                        .title("WP Sites HQ is still watching your sites")
                        .body("It keeps checking them from the tray. To stop, choose Quit in the tray menu.")
                        .show();
                }
            }
        })
        .setup(move |app| {
            // New versions: at start, then every six hours, window open or not.
            let handle = app.handle().clone();
            let core = background.clone();
            tauri::async_runtime::spawn(update::every(update::EVERY, move || {
                let (app, core) = (handle.clone(), core.clone());
                async move {
                    // Offline: quiet, the next round tries again.
                    let _ = update::check(&app, core).await;
                }
            }));
            if let Some(core) = background {
                let handle = app.handle().clone();
                // No tray (no tray host on this desktop): closing the window quits, as before.
                if let Err(e) = tray(&handle, core.clone()) {
                    eprintln!("WP Sites HQ couldn't add its tray icon: {e}");
                }
                tauri::async_runtime::spawn(async move {
                    let mut was_down = std::collections::HashSet::new();
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
                                    Changed::Monitors,
                                ]
                            }
                            Err(RecvError::Closed) => break,
                        };
                        for c in events {
                            if c == Changed::Monitors {
                                monitors_changed(&handle, &core, &mut was_down);
                            }
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
            site_icon,
            package_icon,
            package_icons,
            groups_list,
            site_add_oauth,
            site_add_basic,
            sign_in_cancel,
            site_sign_in_again,
            site_connect_plugin,
            plugin_download,
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
            content_revisions,
            content_restore_revision,
            content_untrash,
            content_acf,
            content_acf_save,
            media_list,
            media_get,
            media_upload,
            media_replace,
            media_stop,
            media_update,
            media_restore_file,
            media_trash,
            media_import,
            clients_list,
            client_save,
            client_delete,
            site_set_client,
            costs_list,
            cost_save,
            cost_delete,
            app_settings_get,
            app_settings_save,
            app_update_status,
            app_update_check,
            app_update_install,
            sites_export,
            sites_import,
            file_show,
            content_search,
            bundles_list,
            bundle_save,
            bundle_delete,
            zip_stage,
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
            cm_reports,
            report_make,
            file_open,
            gsc_status,
            gsc_set_client,
            gsc_connect,
            gsc_forget,
            store_products,
            store_overview,
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
            monitors_list,
            monitors_check,
            pagespeed_run,
        ])
        .run(tauri::generate_context!())
        .expect("WP Sites HQ couldn't open its window");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_window_stays_on_the_apps_own_pages() {
        let page = |u: &str| app_page(&u.parse().unwrap());
        assert!(page("tauri://localhost/index.html") && page("http://tauri.localhost/"));
        for away in [
            "https://evil.example/",
            "https://mc-a.local/wp-admin/",
            "tauri://evil/",
            "file:///etc/passwd",
            "http://localhost:8787/",
        ] {
            assert!(!page(away), "{away}");
        }
        assert_eq!(page("http://localhost:1420/"), cfg!(debug_assertions));
    }

    #[test]
    fn http_links_open_only_for_a_sites_own_address() {
        assert!(link_scheme_ok("https://x.test/", None));
        assert!(!link_scheme_ok("http://x.test/", None));
        assert!(link_scheme_ok(
            "http://mc-a.local/?p=1&preview=true",
            Some(1)
        ));
        assert!(!link_scheme_ok("javascript:alert(1)", Some(1)));
    }

    #[test]
    fn only_web_links_and_our_own_files_open() {
        for bad in [
            "smb://host/x",
            "file:///etc/passwd",
            "search-ms:query=x",
            "javascript:1",
        ] {
            assert!(browser(bad).is_err(), "{bad}");
        }
        assert!(is_web("https://mc-a.local/wp-admin/") && is_web("http://localhost:8881"));
        let d = paths::downloads().unwrap();
        assert!(saved_by_us(&d.join("report.pdf")));
        assert!(!saved_by_us(&d.join("sub").join("report.pdf")));
        assert!(!saved_by_us(std::path::Path::new("/etc/passwd")));
    }
}
