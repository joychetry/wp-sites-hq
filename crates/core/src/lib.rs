//! Monks Central core.

pub mod connect;
pub mod fleet;
pub mod ipc;
pub mod lock;
pub mod net;
pub mod oauth;
pub mod paths;
pub mod sites;
pub mod store;
#[cfg(test)]
mod testsite;
pub mod vault;

pub use keyring_core::CredentialStore;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::atomic::AtomicU64;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tokio::sync::{Notify, RwLock, broadcast, oneshot};

/// Version of the core, shared by the app and the CLI.
pub const VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Debug, thiserror::Error)]
pub enum CoreError {
    #[error(transparent)]
    Lock(#[from] lock::LockError),
    #[error(transparent)]
    Store(#[from] store::StoreError),
    #[error("couldn't set up the data folder: {0}")]
    Io(#[from] std::io::Error),
    #[error("{0}")]
    TakeOver(String),
}

/// What changed, for the window to reload.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Changed {
    /// Added, removed, checked or edited.
    Sites,
    /// What a site runs: plugins, themes, updates.
    Inventory,
    /// A job started, moved on or finished.
    Jobs,
}

impl Changed {
    /// The window event name.
    pub fn event(self) -> &'static str {
        match self {
            Changed::Sites => "sites-changed",
            Changed::Inventory => "inventory-changed",
            Changed::Jobs => "jobs-changed",
        }
    }
}

#[derive(Clone)]
pub struct Options {
    /// Started by `monks core` (or by the CLI for itself), not by the app.
    /// Only a headless core stops when asked over the socket.
    pub headless: bool,
    /// Where the master key lives, or why there is none. Read on first use,
    /// so a core that never touches a secret never touches the keychain.
    pub keychain: Result<Arc<CredentialStore>, String>,
}

impl Default for Options {
    fn default() -> Self {
        Self {
            headless: false,
            keychain: Err("no system keychain was given to the core".into()),
        }
    }
}

/// The one core for a data folder: owns the lock, the database and the socket.
pub struct Core {
    pub home: PathBuf,
    pub store: Mutex<store::Store>,
    pub headless: bool,
    /// Token refreshes sent to sites since start.
    pub refreshes: AtomicU64,
    keychain: Result<Arc<CredentialStore>, String>,
    vault: Mutex<Option<Arc<vault::Vault>>>,
    http: reqwest::Client,
    limits: net::Limits,
    refresh_locks: Mutex<HashMap<i64, Arc<tokio::sync::Mutex<()>>>>,
    sign_in: Mutex<Option<oneshot::Sender<()>>>,
    changed: broadcast::Sender<Changed>,
    shutdown: Notify,
    /// Site work holds a read guard; `finish` takes the write guard.
    work: RwLock<()>,
    socket: Mutex<Option<tokio::task::JoinHandle<()>>>,
    // Declared last so it is released after everything else.
    _lock: lock::CoreLock,
}

impl Core {
    /// Take the lock, open the database, then start answering on the socket.
    /// Needs a Tokio runtime.
    pub async fn start(home: &Path, opts: Options) -> Result<Arc<Self>, CoreError> {
        paths::ensure_private_dir(home)?;
        let home = home.canonicalize()?;
        let lock = lock::CoreLock::acquire(&home)?;
        let store = store::Store::open(&paths::database(&home))?;
        let http = net::client().map_err(std::io::Error::other)?;
        let core = Arc::new(Self {
            home,
            store: Mutex::new(store),
            headless: opts.headless,
            refreshes: AtomicU64::new(0),
            keychain: opts.keychain.clone(),
            vault: Mutex::new(None),
            http,
            limits: net::Limits::default(),
            refresh_locks: Mutex::new(HashMap::new()),
            sign_in: Mutex::new(None),
            changed: broadcast::channel(16).0,
            shutdown: Notify::new(),
            work: RwLock::new(()),
            socket: Mutex::new(None),
            _lock: lock,
        });
        let socket = ipc::bind(&core.home, Arc::downgrade(&core)).await?;
        *core.socket.lock().unwrap() = Some(socket);
        Ok(core)
    }

    /// Start, or ask a running headless core to finish its work and exit,
    /// then start. A running app is never stopped: its error is returned.
    pub async fn start_or_take_over(home: &Path, opts: Options) -> Result<Arc<Self>, CoreError> {
        match Self::start(home, opts.clone()).await {
            Err(CoreError::Lock(lock::LockError::AlreadyRunning { .. })) => {}
            other => return other,
        }
        ipc::call(home, "core.shutdown", serde_json::Value::Null)
            .await
            .map_err(|e| CoreError::TakeOver(e.to_string()))?;
        // The headless core finishes in-flight site work before it lets go.
        for _ in 0..300 {
            tokio::time::sleep(Duration::from_millis(100)).await;
            match Self::start(home, opts.clone()).await {
                Err(CoreError::Lock(lock::LockError::AlreadyRunning { .. })) => continue,
                other => return other,
            }
        }
        Err(CoreError::TakeOver(
            "The Monks Central core running in the background didn't stop in time. Try again."
                .into(),
        ))
    }

    /// Resolves when a socket client asked this (headless) core to stop.
    pub async fn shutdown_requested(&self) {
        self.shutdown.notified().await;
    }

    /// Wait for in-flight site work to finish and refuse new work.
    pub async fn finish(&self) {
        std::mem::forget(self.work.write().await);
    }

    /// Hold while doing site work, so `finish` waits for it.
    pub(crate) async fn working(&self) -> tokio::sync::RwLockReadGuard<'_, ()> {
        self.work.read().await
    }

    /// Fires after sites, their inventory or a job change.
    pub fn subscribe(&self) -> broadcast::Receiver<Changed> {
        self.changed.subscribe()
    }

    pub(crate) fn request_shutdown(&self) {
        self.shutdown.notify_one();
    }
}

impl Drop for Core {
    fn drop(&mut self) {
        if let Some(socket) = self.socket.get_mut().unwrap().take() {
            socket.abort();
        }
    }
}
