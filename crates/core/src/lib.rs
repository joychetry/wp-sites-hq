//! Monks Central core.

pub mod ipc;
pub mod lock;
pub mod net;
pub mod paths;
pub mod store;
pub mod vault;

pub use keyring_core::CredentialStore;

use std::path::{Path, PathBuf};
use std::sync::Mutex;

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
}

/// The one core for a data folder: owns the lock, the database and the socket.
pub struct Core {
    pub home: PathBuf,
    pub store: Mutex<store::Store>,
    socket: tokio::task::JoinHandle<()>,
    // Declared last so it is released after everything else.
    _lock: lock::CoreLock,
}

impl Core {
    /// Take the lock, open the database, then start answering on the socket.
    /// Needs a Tokio runtime.
    pub async fn start(home: &Path) -> Result<Self, CoreError> {
        paths::ensure_private_dir(home)?;
        let home = home.canonicalize()?;
        let lock = lock::CoreLock::acquire(&home)?;
        let store = store::Store::open(&paths::database(&home))?;
        let socket = ipc::bind(&home).await?;
        Ok(Self {
            home,
            store: Mutex::new(store),
            socket,
            _lock: lock,
        })
    }
}

impl Drop for Core {
    fn drop(&mut self) {
        self.socket.abort();
    }
}
