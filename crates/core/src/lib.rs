//! Monks Central core.

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

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tokio::sync::{Notify, RwLock};

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

#[derive(Debug, Default, Clone, Copy)]
pub struct Options {
    /// Started by `monks core` (or by the CLI for itself), not by the app.
    /// Only a headless core stops when asked over the socket.
    pub headless: bool,
}

/// The one core for a data folder: owns the lock, the database and the socket.
pub struct Core {
    pub home: PathBuf,
    pub store: Mutex<store::Store>,
    pub headless: bool,
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
        let core = Arc::new(Self {
            home,
            store: Mutex::new(store),
            headless: opts.headless,
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
        match Self::start(home, opts).await {
            Err(CoreError::Lock(lock::LockError::AlreadyRunning { .. })) => {}
            other => return other,
        }
        ipc::call(home, "core.shutdown", serde_json::Value::Null)
            .await
            .map_err(|e| CoreError::TakeOver(e.to_string()))?;
        // The headless core finishes in-flight site work before it lets go.
        for _ in 0..300 {
            tokio::time::sleep(Duration::from_millis(100)).await;
            match Self::start(home, opts).await {
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
