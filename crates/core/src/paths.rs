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

/// The user's Downloads folder (home if there is none).
pub fn downloads() -> io::Result<PathBuf> {
    dirs::download_dir().or_else(dirs::home_dir).ok_or_else(|| {
        io::Error::new(
            io::ErrorKind::NotFound,
            "no Downloads folder on this system",
        )
    })
}

/// Write `bytes` to `dir/name`, never over an existing file: "a.json" becomes
/// "a (2).json". Returns where it went.
pub fn save_new(dir: &Path, name: &str, bytes: &[u8]) -> io::Result<PathBuf> {
    std::fs::create_dir_all(dir)?;
    let (stem, ext) = name.rsplit_once('.').unwrap_or((name, ""));
    let dot = if ext.is_empty() { "" } else { "." };
    for n in 1..1000 {
        let file = if n == 1 {
            name.to_string()
        } else {
            format!("{stem} ({n}){dot}{ext}")
        };
        let path = dir.join(file);
        match std::fs::OpenOptions::new()
            .write(true)
            .create_new(true)
            .open(&path)
        {
            Ok(mut f) => {
                use std::io::Write;
                f.write_all(bytes)?;
                return Ok(path);
            }
            Err(e) if e.kind() == io::ErrorKind::AlreadyExists => continue,
            Err(e) => return Err(e),
        }
    }
    Err(io::Error::other("too many files with that name"))
}

/// A unix time's date in UTC, "2026-10-28".
pub fn day(unix: i64) -> String {
    // Howard Hinnant's civil_from_days.
    let z = unix.div_euclid(86_400) + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z - era * 146_097;
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = yoe + era * 400 + i64::from(m <= 2);
    format!("{y:04}-{m:02}-{d:02}")
}

#[cfg(test)]
mod tests {
    #[test]
    fn days_and_new_files() {
        assert_eq!(super::day(0), "1970-01-01");
        assert_eq!(super::day(1_793_145_600 + 86_399), "2026-10-28");
        assert_eq!(super::day(951_782_400), "2000-02-29");
        let tmp = tempfile::tempdir().unwrap();
        let a = super::save_new(tmp.path(), "r.json", b"1").unwrap();
        let b = super::save_new(tmp.path(), "r.json", b"2").unwrap();
        assert_eq!(b.file_name().unwrap(), "r (2).json");
        assert_eq!(std::fs::read(a).unwrap(), b"1");
        let c = super::save_new(tmp.path(), "noext", b"").unwrap();
        assert_eq!(
            super::save_new(tmp.path(), "noext", b"")
                .unwrap()
                .file_name()
                .unwrap(),
            "noext (2)"
        );
        assert!(c.exists());
    }

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
