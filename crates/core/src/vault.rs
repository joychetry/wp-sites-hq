// SPDX-License-Identifier: GPL-3.0-or-later
//! Secret vault: records encrypted with XChaCha20-Poly1305 in SQLite, under one
//! master key kept in the OS keychain.

use std::path::Path;
use std::sync::Arc;

use chacha20poly1305::aead::{Aead, Generate, KeyInit, Payload};
use chacha20poly1305::{Key, XChaCha20Poly1305, XNonce};
use keyring_core::{CredentialStore, Error as KeyringError};
use rusqlite::{Connection, OptionalExtension, params};
use sha2::{Digest, Sha256};
use zeroize::Zeroizing;

pub const KEYCHAIN_SERVICE: &str = "com.classicmonks.monks-central";
const KEY_LEN: usize = 32;
const NONCE_LEN: usize = 24;

#[derive(Debug, thiserror::Error)]
pub enum VaultError {
    #[error("Couldn't use the system keychain: {0}")]
    Keychain(#[from] KeyringError),
    #[error(
        "The WP Sites HQ key in the system keychain is damaged ({0} bytes). Nothing was changed."
    )]
    BadMasterKey(usize),
    #[error("The system keychain didn't keep the WP Sites HQ key. Check that it is unlocked.")]
    KeychainReadBack,
    #[error("This saved sign-in can't be read. Sign in again.")]
    SignInAgain,
    #[error("The sign-in couldn't be saved. Try again.")]
    SaveReadBack,
    #[error("database error: {0}")]
    Sqlite(#[from] rusqlite::Error),
}

/// The OS keychain for this platform.
pub fn os_keychain() -> Result<Arc<CredentialStore>, VaultError> {
    #[cfg(target_os = "macos")]
    let store = apple_native_keyring_store::keychain::Store::new()?;
    #[cfg(windows)]
    let store = windows_native_keyring_store::Store::new()?;
    #[cfg(all(unix, not(target_os = "macos")))]
    let store = zbus_secret_service_keyring_store::Store::new()?;
    Ok(store)
}

/// Keychain account for a data folder's master key: one item per folder, so a
/// test folder never reads or replaces the real one. Pass the canonical path.
pub fn keychain_account(home: &Path) -> String {
    let hash = Sha256::digest(home.to_string_lossy().as_bytes());
    let hex: String = hash[..8].iter().map(|b| format!("{b:02x}")).collect();
    format!("master-key-{hex}")
}

pub struct MasterKey(Zeroizing<[u8; KEY_LEN]>);

/// Load the data folder's master key, or create it if the keychain has none.
///
/// A key is created only on "no entry". Any other keychain error stops here,
/// so records sealed with an existing key are never orphaned.
pub fn load_or_create_master_key(
    keychain: &CredentialStore,
    home: &Path,
) -> Result<MasterKey, VaultError> {
    let entry = keychain.build(KEYCHAIN_SERVICE, &keychain_account(home), None)?;
    match entry.get_secret() {
        Ok(bytes) => master_key(Zeroizing::new(bytes)),
        Err(KeyringError::NoEntry) => {
            let key = Key::generate();
            entry.set_secret(&key)?;
            let back = Zeroizing::new(entry.get_secret()?);
            if back.as_slice() != key.as_slice() {
                return Err(VaultError::KeychainReadBack);
            }
            master_key(back)
        }
        Err(e) => Err(e.into()),
    }
}

/// Read the master key without ever making one: `None` if there is none yet. For
/// tools that run beside a core, which alone makes the key (under the core lock).
pub fn load_master_key(
    keychain: &CredentialStore,
    home: &Path,
) -> Result<Option<MasterKey>, VaultError> {
    let entry = keychain.build(KEYCHAIN_SERVICE, &keychain_account(home), None)?;
    match entry.get_secret() {
        Ok(bytes) => master_key(Zeroizing::new(bytes)).map(Some),
        Err(KeyringError::NoEntry) => Ok(None),
        Err(e) => Err(e.into()),
    }
}

fn master_key(bytes: Zeroizing<Vec<u8>>) -> Result<MasterKey, VaultError> {
    let key: [u8; KEY_LEN] = bytes
        .as_slice()
        .try_into()
        .map_err(|_| VaultError::BadMasterKey(bytes.len()))?;
    Ok(MasterKey(Zeroizing::new(key)))
}

pub struct Vault {
    cipher: XChaCha20Poly1305,
}

impl Vault {
    pub fn new(key: &MasterKey) -> Self {
        Self {
            cipher: XChaCha20Poly1305::new(&Key::from(*key.0)),
        }
    }

    /// Seal `secret` under `name`, store it, then read it back and open it
    /// before reporting success.
    pub fn put(&self, conn: &Connection, name: &str, secret: &[u8]) -> Result<(), VaultError> {
        let blob = self.seal(name, secret);
        conn.execute(
            "INSERT INTO credentials (name, blob) VALUES (?1, ?2)
             ON CONFLICT (name) DO UPDATE SET blob = excluded.blob, updated_at = unixepoch()",
            params![name, blob],
        )?;
        match self.get(conn, name) {
            Ok(Some(back)) if back.as_slice() == secret => Ok(()),
            Err(VaultError::Sqlite(e)) => Err(e.into()),
            _ => Err(VaultError::SaveReadBack),
        }
    }

    pub fn get(
        &self,
        conn: &Connection,
        name: &str,
    ) -> Result<Option<Zeroizing<Vec<u8>>>, VaultError> {
        let blob: Option<Vec<u8>> = conn
            .query_row(
                "SELECT blob FROM credentials WHERE name = ?1",
                [name],
                |r| r.get(0),
            )
            .optional()?;
        blob.map(|b| self.open(name, &b)).transpose()
    }

    pub fn delete(&self, conn: &Connection, name: &str) -> Result<bool, VaultError> {
        Ok(conn.execute("DELETE FROM credentials WHERE name = ?1", [name])? > 0)
    }

    /// nonce || ciphertext, with `name` as associated data so a blob moved to
    /// another record does not open.
    fn seal(&self, name: &str, secret: &[u8]) -> Vec<u8> {
        let nonce = XNonce::generate();
        let ct = self
            .cipher
            .encrypt(
                &nonce,
                Payload {
                    msg: secret,
                    aad: name.as_bytes(),
                },
            )
            .expect("encrypting into a Vec cannot fail");
        [nonce.as_slice(), &ct].concat()
    }

    fn open(&self, name: &str, blob: &[u8]) -> Result<Zeroizing<Vec<u8>>, VaultError> {
        if blob.len() < NONCE_LEN {
            return Err(VaultError::SignInAgain);
        }
        let (nonce, ct) = blob.split_at(NONCE_LEN);
        let nonce = XNonce::try_from(nonce).map_err(|_| VaultError::SignInAgain)?;
        self.cipher
            .decrypt(
                &nonce,
                Payload {
                    msg: ct,
                    aad: name.as_bytes(),
                },
            )
            .map(Zeroizing::new)
            .map_err(|_| VaultError::SignInAgain)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::Store;
    use keyring_core::mock;

    const HOME: &str = "/data/monks";

    fn mock_keychain() -> Arc<CredentialStore> {
        mock::Store::new().unwrap()
    }

    fn store() -> (tempfile::TempDir, Store) {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(&dir.path().join("monks.db")).unwrap();
        (dir, store)
    }

    #[test]
    fn master_key_is_created_once_and_reused() {
        let kc = mock_keychain();
        // Reading alone never makes one.
        assert!(load_master_key(&*kc, HOME.as_ref()).unwrap().is_none());
        assert!(load_master_key(&*kc, HOME.as_ref()).unwrap().is_none());
        let a = load_or_create_master_key(&*kc, HOME.as_ref()).unwrap();
        let b = load_or_create_master_key(&*kc, HOME.as_ref()).unwrap();
        assert_eq!(*a.0, *b.0);
        let read = load_master_key(&*kc, HOME.as_ref()).unwrap().unwrap();
        assert_eq!(*read.0, *a.0);
        assert_ne!(*a.0, [0u8; KEY_LEN]);
    }

    #[test]
    fn keychain_error_never_creates_a_new_key() {
        let kc = mock_keychain();
        let entry = kc
            .build(KEYCHAIN_SERVICE, &keychain_account(HOME.as_ref()), None)
            .unwrap();
        let cred: &mock::Cred = entry.as_any().downcast_ref().unwrap();
        cred.set_error(KeyringError::PlatformFailure("locked".into()));
        assert!(matches!(
            load_or_create_master_key(&*kc, HOME.as_ref()),
            Err(VaultError::Keychain(_))
        ));
        assert!(matches!(entry.get_secret(), Err(KeyringError::NoEntry)));
    }

    #[test]
    fn each_data_folder_has_its_own_key() {
        let kc = mock_keychain();
        let a = load_or_create_master_key(&*kc, Path::new("/data/a")).unwrap();
        let b = load_or_create_master_key(&*kc, Path::new("/data/b")).unwrap();
        assert_ne!(*a.0, *b.0);
        let again = load_or_create_master_key(&*kc, Path::new("/data/a")).unwrap();
        assert_eq!(*a.0, *again.0);
        assert_eq!(
            keychain_account(Path::new("/data/a")).len(),
            "master-key-".len() + 16
        );
    }

    #[test]
    fn damaged_master_key_is_refused_and_kept() {
        let kc = mock_keychain();
        let entry = kc
            .build(KEYCHAIN_SERVICE, &keychain_account(HOME.as_ref()), None)
            .unwrap();
        entry.set_secret(&[1, 2, 3]).unwrap();
        assert!(matches!(
            load_or_create_master_key(&*kc, HOME.as_ref()),
            Err(VaultError::BadMasterKey(3))
        ));
        assert_eq!(entry.get_secret().unwrap(), vec![1, 2, 3]);
    }

    #[test]
    fn put_get_delete_round_trip() {
        let (_d, store) = store();
        let vault =
            Vault::new(&load_or_create_master_key(&*mock_keychain(), HOME.as_ref()).unwrap());
        let c = store.conn();
        assert!(vault.get(c, "site:1").unwrap().is_none());
        vault.put(c, "site:1", b"app-password").unwrap();
        vault.put(c, "site:1", b"rotated").unwrap();
        assert_eq!(
            vault.get(c, "site:1").unwrap().unwrap().as_slice(),
            b"rotated"
        );
        let raw: Vec<u8> = c
            .query_row("SELECT blob FROM credentials", [], |r| r.get(0))
            .unwrap();
        assert!(!raw.windows(7).any(|w| w == b"rotated"), "stored in clear");
        assert!(vault.delete(c, "site:1").unwrap());
        assert!(vault.get(c, "site:1").unwrap().is_none());
    }

    #[test]
    fn wrong_key_or_moved_blob_says_sign_in_again() {
        let (_d, store) = store();
        let c = store.conn();
        let vault =
            Vault::new(&load_or_create_master_key(&*mock_keychain(), HOME.as_ref()).unwrap());
        vault.put(c, "site:1", b"one").unwrap();

        let other =
            Vault::new(&load_or_create_master_key(&*mock_keychain(), HOME.as_ref()).unwrap());
        let err = other.get(c, "site:1").unwrap_err();
        assert!(matches!(err, VaultError::SignInAgain));
        assert_eq!(
            err.to_string(),
            "This saved sign-in can't be read. Sign in again."
        );

        c.execute(
            "INSERT INTO credentials (name, blob) SELECT 'site:2', blob FROM credentials WHERE name = 'site:1'",
            [],
        )
        .unwrap();
        assert!(matches!(
            vault.get(c, "site:2"),
            Err(VaultError::SignInAgain)
        ));

        c.execute(
            "UPDATE credentials SET blob = x'' WHERE name = 'site:1'",
            [],
        )
        .unwrap();
        assert!(matches!(
            vault.get(c, "site:1"),
            Err(VaultError::SignInAgain)
        ));
    }
}
