//! `monks doctor`: checks the pieces a user can't see, in plain words.
//! Prints no secret.

use std::fmt;
use std::path::Path;

use monks_core::ipc::{self, ClientError};
use monks_core::{CredentialStore, net, paths, store::Store, vault};

/// Variables that can change which certificates are trusted. Names only, never values.
const TLS_ENV: &[&str] = &[
    "SSL_CERT_FILE",
    "SSL_CERT_DIR",
    "NODE_EXTRA_CA_CERTS",
    "REQUESTS_CA_BUNDLE",
    "CURL_CA_BUNDLE",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Level {
    Ok,
    Info,
    Warn,
    Fail,
}

pub struct Check {
    pub level: Level,
    pub name: &'static str,
    pub detail: String,
}

impl fmt::Display for Check {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let tag = match self.level {
            Level::Ok => "ok",
            Level::Info => "info",
            Level::Warn => "warn",
            Level::Fail => "FAIL",
        };
        write!(f, "  {tag:<5} {:<13} {}", self.name, self.detail)
    }
}

fn check(level: Level, name: &'static str, detail: impl Into<String>) -> Check {
    Check {
        level,
        name,
        detail: detail.into(),
    }
}

pub async fn run(
    home: &Path,
    keychain: Result<&CredentialStore, String>,
    url: Option<&str>,
) -> Vec<Check> {
    let mut out = Vec::new();

    if let Err(e) = paths::ensure_private_dir(home) {
        out.push(check(
            Level::Fail,
            "Data folder",
            format!("{}: {e}", home.display()),
        ));
        return out;
    }
    out.push(check(Level::Ok, "Data folder", home.display().to_string()));

    let store = match Store::open(&paths::database(home)) {
        Ok(s) => {
            let v = s.schema_version().unwrap_or_default();
            out.push(check(Level::Ok, "Database", format!("schema {v}")));
            Some(s)
        }
        Err(e) => {
            out.push(check(Level::Fail, "Database", e.to_string()));
            None
        }
    };

    out.push(match (keychain, &store) {
        (Err(e), _) => check(Level::Fail, "Keychain", e),
        (Ok(kc), store) => keychain_and_vault(kc, home, store.as_ref()),
    });

    out.push(
        match ipc::call(home, "status", serde_json::Value::Null).await {
            Ok(s) => check(
                Level::Ok,
                "Core",
                format!(
                    "running (pid {}), this client is an {}",
                    s["pid"],
                    s["role"].as_str().unwrap_or("?")
                ),
            ),
            Err(ClientError::NotRunning) => check(
                Level::Info,
                "Core",
                "not running (start it with `monks core` or open the app)",
            ),
            Err(e) => check(Level::Fail, "Core", e.to_string()),
        },
    );

    let set: Vec<&str> = TLS_ENV
        .iter()
        .copied()
        .filter(|v| std::env::var_os(v).is_some())
        .collect();
    out.push(if set.is_empty() {
        check(
            Level::Ok,
            "TLS settings",
            "no TLS environment variables; using the OS trust store",
        )
    } else {
        check(
            Level::Warn,
            "TLS settings",
            format!("set: {} (Monks Central doesn't need them)", set.join(", ")),
        )
    });

    if let Some(url) = url {
        out.push(match net::client() {
            Err(e) => check(Level::Fail, "HTTPS", e.to_string()),
            Ok(client) => match net::get_status(&client, url).await {
                Ok(code) if code < 500 => {
                    check(Level::Ok, "HTTPS", format!("{url} answered {code}"))
                }
                Ok(code) => check(Level::Fail, "HTTPS", format!("{url} answered {code}")),
                Err(e) => check(Level::Fail, "HTTPS", format!("{url}: {e}")),
            },
        });
    }
    out
}

fn keychain_and_vault(kc: &CredentialStore, home: &Path, store: Option<&Store>) -> Check {
    let home = home.canonicalize().unwrap_or_else(|_| home.to_path_buf());
    // Only the holder of the core lock may make the key: a running core could be making
    // its own right now, and two keys would leave one's records unreadable.
    let key = match monks_core::lock::CoreLock::acquire(&home) {
        Ok(_lock) => vault::load_or_create_master_key(kc, &home).map(Some),
        Err(_) => vault::load_master_key(kc, &home),
    };
    let key = match key {
        Ok(Some(k)) => k,
        Ok(None) => {
            return check(
                Level::Ok,
                "Keychain",
                "reachable; the master key is made when the first site is added",
            );
        }
        Err(e) => return check(Level::Fail, "Keychain", e.to_string()),
    };
    let Some(store) = store else {
        return check(
            Level::Warn,
            "Keychain",
            "master key read back; vault not checked (no database)",
        );
    };
    let v = vault::Vault::new(&key);
    let name = "doctor:round-trip";
    let result = v
        .put(store.conn(), name, b"monks doctor")
        .and_then(|()| v.delete(store.conn(), name));
    match result {
        Ok(_) => check(
            Level::Ok,
            "Keychain",
            "master key read back; vault write, read back and delete ok",
        ),
        Err(e) => check(Level::Fail, "Keychain", e.to_string()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn healthy_home_passes_and_unreachable_url_fails() {
        let home = tempfile::tempdir().unwrap();
        let kc = keyring_core::mock::Store::new().unwrap();
        let checks = run(home.path(), Ok(&*kc), None).await;
        let names: Vec<_> = checks.iter().map(|c| (c.name, c.level)).collect();
        assert_eq!(
            names[..4],
            [
                ("Data folder", Level::Ok),
                ("Database", Level::Ok),
                ("Keychain", Level::Ok),
                ("Core", Level::Info),
            ]
        );
        assert!(!checks.iter().any(|c| c.level == Level::Fail));

        let checks = run(home.path(), Ok(&*kc), Some("http://127.0.0.1:9/")).await;
        let https = checks.last().unwrap();
        assert_eq!((https.name, https.level), ("HTTPS", Level::Fail));
        assert!(
            https.detail.contains("Couldn't reach this site"),
            "{}",
            https.detail
        );
    }

    #[tokio::test]
    async fn running_core_reports_agent_role() {
        let home = tempfile::tempdir().unwrap();
        let _core = monks_core::Core::start(home.path(), Default::default())
            .await
            .unwrap();
        let kc = keyring_core::mock::Store::new().unwrap();
        let checks = run(home.path(), Ok(&*kc), None).await;
        let core = checks.iter().find(|c| c.name == "Core").unwrap();
        assert_eq!(core.level, Level::Ok);
        assert!(
            core.detail.ends_with("this client is an agent"),
            "{}",
            core.detail
        );
    }

    #[tokio::test]
    async fn missing_keychain_fails_in_plain_words() {
        let home = tempfile::tempdir().unwrap();
        let checks = run(
            home.path(),
            Err("Couldn't use the system keychain: no D-Bus".into()),
            None,
        )
        .await;
        let kc = checks.iter().find(|c| c.name == "Keychain").unwrap();
        assert_eq!(kc.level, Level::Fail);
    }
}
