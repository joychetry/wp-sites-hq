// SPDX-License-Identifier: GPL-3.0-or-later
//! New versions of the app from GitHub Releases: a check at start and every six
//! hours (tray only too), a background download when installing by itself is on,
//! and an install that only the window can ask for.

use std::future::Future;
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use monks_core::Core;
use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager};
use tauri_plugin_updater::{Update, UpdaterExt};
use tokio::sync::RwLockWriteGuard;

/// How often a running app looks for a new version.
pub const EVERY: Duration = Duration::from_secs(6 * 60 * 60);

/// A newer version on GitHub Releases.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Found {
    pub version: String,
    /// latest.json "notes": the release's CHANGELOG section, plain text.
    pub notes: String,
    /// Unix seconds.
    pub date: Option<i64>,
}

/// What Settings shows; sent to the window as `app-update` on every change.
#[derive(Debug, Clone, Default, Serialize)]
pub struct Status {
    pub current: String,
    /// Unix seconds of the last check that reached GitHub.
    pub checked_at: Option<i64>,
    pub found: Option<Found>,
    /// Downloaded and its signature checked.
    pub ready: bool,
    /// Bytes so far and the total, while downloading.
    pub progress: Option<(u64, Option<u64>)>,
}

#[derive(Default)]
pub struct Updates(Mutex<Held>);

#[derive(Default)]
struct Held {
    status: Status,
    update: Option<Update>,
    bytes: Option<Vec<u8>>,
}

fn held(app: &AppHandle) -> MutexGuard<'_, Held> {
    app.state::<Updates>().inner().0.lock().unwrap()
}

pub fn status(app: &AppHandle) -> Status {
    Status {
        current: app.package_info().version.to_string(),
        ..held(app).status.clone()
    }
}

fn changed(app: &AppHandle) {
    let _ = app.emit("app-update", status(app));
}

/// The check failed: offline, GitHub down, or no release published yet.
fn unreachable(e: tauri_plugin_updater::Error) -> String {
    eprintln!("Monks Central update check: {e}");
    "Couldn't reach the Monks Central releases on GitHub. Check your internet connection and try again later.".into()
}

fn auto(core: Option<&Core>) -> bool {
    core.and_then(|c| c.app_settings().ok())
        .is_some_and(|s| s.auto_update)
}

/// Run `f` now and then every `period`, for as long as the app runs.
pub async fn every<F: FnMut() -> Fut, Fut: Future<Output = ()>>(period: Duration, mut f: F) {
    let mut t = tokio::time::interval(period);
    t.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
    loop {
        t.tick().await;
        f().await;
    }
}

/// Look for a new version. With installing by itself on, start downloading it.
pub async fn check(app: &AppHandle, core: Option<Arc<Core>>) -> Result<Status, String> {
    let update = app
        .updater()
        .map_err(|e| e.to_string())?
        .check()
        .await
        .map_err(unreachable)?;
    let fetch = {
        let mut h = held(app);
        h.status.checked_at = Some(monks_core::oauth::now());
        let version = update.as_ref().map(|u| &u.version);
        if h.status.found.as_ref().map(|f| &f.version) != version {
            h.status.found = update.as_ref().map(|u| Found {
                version: u.version.clone(),
                notes: u.body.clone().unwrap_or_default(),
                date: u.date.map(|d| d.unix_timestamp()),
            });
            h.bytes = None;
            h.status.ready = false;
        }
        h.update = update;
        h.update.is_some() && !h.status.ready && h.status.progress.is_none()
    };
    changed(app);
    if fetch && auto(core.as_deref()) {
        let app = app.clone();
        tauri::async_runtime::spawn(async move {
            if let Err(e) = download(&app).await {
                eprintln!("{e}");
            }
        });
    }
    Ok(status(app))
}

/// Download the found version; the updater checks its signature. The bytes
/// stay here until it is installed.
async fn download(app: &AppHandle) -> Result<(), String> {
    let update = {
        let mut h = held(app);
        if h.status.ready {
            return Ok(());
        }
        if h.status.progress.is_some() {
            return Err("The new version is still downloading. Try again in a moment.".into());
        }
        let Some(u) = h.update.clone() else {
            return Err("You have the newest version.".into());
        };
        h.status.progress = Some((0, None));
        u
    };
    changed(app);
    let mut got = 0u64;
    let bytes = update
        .download(
            |n, total| {
                let before = got >> 20;
                got += n as u64;
                // One event per megabyte, not per chunk.
                if got >> 20 != before {
                    held(app).status.progress = Some((got, total));
                    changed(app);
                }
            },
            || {},
        )
        .await;
    let done = {
        let mut h = held(app);
        h.status.progress = None;
        match bytes {
            // A newer version found meanwhile replaces this one.
            Ok(b)
                if h.update
                    .as_ref()
                    .is_some_and(|u| u.version == update.version) =>
            {
                h.bytes = Some(b);
                h.status.ready = true;
                Ok(())
            }
            Ok(_) => Ok(()),
            Err(e) => Err(format!(
                "Couldn't download the new version: {e}. This version keeps working."
            )),
        }
    };
    changed(app);
    done
}

/// Installing by itself may go ahead: the setting is on, the new version is
/// downloaded and no site work or job runs. The guard keeps new work out.
fn gate(core: &Core, ready: bool) -> Option<RwLockWriteGuard<'_, ()>> {
    if ready && auto(Some(core)) {
        core.try_finish()
    } else {
        None
    }
}

fn put_in(app: &AppHandle) -> Result<(), String> {
    let h = held(app);
    let (Some(u), Some(b)) = (&h.update, &h.bytes) else {
        return Err("The new version isn't downloaded yet.".into());
    };
    u.install(b)
        .map_err(|e| format!("Couldn't install the new version: {e}. This version keeps working."))
}

/// Install the new version and restart. `when_idle` is installing by itself:
/// it goes ahead only through `gate`, else `Ok(false)` and the window tries
/// again later. A click downloads if needed and lets running work finish first.
pub async fn install(
    app: &AppHandle,
    core: Option<Arc<Core>>,
    when_idle: bool,
) -> Result<bool, String> {
    if when_idle {
        let Some(core) = core else {
            return Ok(false);
        };
        let Some(work) = gate(&core, status(app).ready) else {
            return Ok(false);
        };
        // Failing here drops the guard, so site work goes on.
        put_in(app)?;
        std::mem::forget(work);
        app.restart()
    }
    if !status(app).ready {
        if held(app).update.is_none() {
            check(app, None).await?;
        }
        download(app).await?;
    }
    put_in(app)?;
    if let Some(core) = core {
        core.finish().await;
    }
    app.restart()
}

#[cfg(test)]
mod tests {
    use super::*;
    use monks_core::Options;
    use monks_core::business::AppSettings;
    use std::sync::atomic::{AtomicU32, Ordering::SeqCst};

    #[tokio::test(start_paused = true)]
    async fn checks_at_start_then_every_six_hours() {
        let n = Arc::new(AtomicU32::new(0));
        let c = n.clone();
        let task = tokio::spawn(every(EVERY, move || {
            c.fetch_add(1, SeqCst);
            std::future::ready(())
        }));
        tokio::time::sleep(Duration::from_secs(1)).await;
        assert_eq!(n.load(SeqCst), 1, "at start");
        tokio::time::sleep(EVERY - Duration::from_secs(2)).await;
        assert_eq!(n.load(SeqCst), 1, "not before six hours");
        tokio::time::sleep(Duration::from_secs(2)).await;
        assert_eq!(n.load(SeqCst), 2);
        tokio::time::sleep(EVERY).await;
        assert_eq!(n.load(SeqCst), 3);
        task.abort();
    }

    #[tokio::test]
    async fn installs_by_itself_only_when_on_downloaded_and_idle() {
        let home = tempfile::tempdir().unwrap();
        let core = Core::start(home.path(), Options::default()).await.unwrap();
        assert!(gate(&core, true).is_none(), "off by default");
        core.save_app_settings(&AppSettings {
            auto_update: true,
            ..Default::default()
        })
        .unwrap();
        assert!(gate(&core, false).is_none(), "not downloaded");
        // Something else holds the core's work lock, as a running job does.
        let busy = core.try_finish().unwrap();
        assert!(gate(&core, true).is_none(), "work is running");
        drop(busy);
        assert!(gate(&core, true).is_some());
    }
}
