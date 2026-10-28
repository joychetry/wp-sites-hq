// SPDX-License-Identifier: GPL-3.0-or-later
//! One core per data folder, guarded by an OS file lock.

use std::fs::{File, OpenOptions, TryLockError};
use std::io::{self, Seek, Write};
use std::path::Path;

#[derive(Debug, thiserror::Error)]
pub enum LockError {
    #[error("Monks Central is already running{}.", .pid.map(|p| format!(" (pid {p})")).unwrap_or_default())]
    AlreadyRunning { pid: Option<u32> },
    #[error("couldn't open the core lock file: {0}")]
    Io(#[from] io::Error),
}

/// Held for the life of the core. The OS drops the lock if the process dies,
/// so a crash never leaves a stale lock behind.
#[derive(Debug)]
pub struct CoreLock {
    _file: File,
}

impl CoreLock {
    pub fn acquire(home: &Path) -> Result<Self, LockError> {
        let path = home.join("core.lock");
        let mut file = OpenOptions::new()
            .read(true)
            .write(true)
            .create(true)
            .truncate(false)
            .open(&path)?;
        match file.try_lock() {
            Ok(()) => {}
            Err(TryLockError::WouldBlock) => {
                // Windows blocks reads of a locked file, so the pid may be unknown.
                let pid = std::fs::read_to_string(&path)
                    .ok()
                    .and_then(|s| s.trim().parse().ok());
                return Err(LockError::AlreadyRunning { pid });
            }
            Err(TryLockError::Error(e)) => return Err(e.into()),
        }
        file.set_len(0)?;
        file.rewind()?;
        write!(file, "{}", std::process::id())?;
        file.flush()?;
        Ok(Self { _file: file })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn second_core_is_refused_until_the_first_is_gone() {
        let home = tempfile::tempdir().unwrap();
        let first = CoreLock::acquire(home.path()).unwrap();
        let err = CoreLock::acquire(home.path()).unwrap_err();
        let LockError::AlreadyRunning { pid } = err else {
            panic!("{err}")
        };
        if cfg!(unix) {
            assert_eq!(pid, Some(std::process::id()));
        }
        drop(first);
        CoreLock::acquire(home.path()).unwrap();
    }
}
