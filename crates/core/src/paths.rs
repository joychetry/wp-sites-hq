//! Where Monks Central keeps its data.

use std::io;
use std::path::{Path, PathBuf};

/// Same folder as Tauri's app data folder for the app identifier.
pub const APP_ID: &str = "com.classicmonks.monks-central";

/// `MONKS_HOME` if set, else the OS app-data folder.
pub fn data_dir() -> io::Result<PathBuf> {
    if let Some(home) = std::env::var_os("MONKS_HOME").filter(|v| !v.is_empty()) {
        return Ok(PathBuf::from(home));
    }
    dirs::data_dir()
        .map(|d| d.join(APP_ID))
        .ok_or_else(|| io::Error::new(io::ErrorKind::NotFound, "no app data folder on this system"))
}

/// Create `dir` if needed and make it owner-only on Unix.
pub fn ensure_private_dir(dir: &Path) -> io::Result<()> {
    std::fs::create_dir_all(dir)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        std::fs::set_permissions(dir, std::fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}

pub fn database(home: &Path) -> PathBuf {
    home.join("monks.db")
}

#[cfg(test)]
mod tests {
    #[cfg(unix)]
    #[test]
    fn private_dir_is_owner_only() {
        use std::os::unix::fs::PermissionsExt;
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("a/b");
        super::ensure_private_dir(&dir).unwrap();
        let mode = std::fs::metadata(&dir).unwrap().permissions().mode();
        assert_eq!(mode & 0o777, 0o700);
    }
}
