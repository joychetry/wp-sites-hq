// SPDX-License-Identifier: GPL-3.0-or-later
//! SQLite store with versioned migrations tracked in `PRAGMA user_version`.

use std::path::Path;

use rusqlite::{Connection, TransactionBehavior};

/// Migrations in order. Index + 1 is the schema version. Never edit a shipped one.
const MIGRATIONS: &[&str] = &[
    include_str!("../migrations/0001_credentials.sql"),
    include_str!("../migrations/0002_sites.sql"),
    include_str!("../migrations/0003_fleet.sql"),
    include_str!("../migrations/0004_agent_access.sql"),
    include_str!("../migrations/0005_plans_activity.sql"),
    include_str!("../migrations/0006_safe_updates.sql"),
    include_str!("../migrations/0007_security.sql"),
    include_str!("../migrations/0008_monitoring.sql"),
    include_str!("../migrations/0009_business.sql"),
    include_str!("../migrations/0010_site_icon.sql"),
];

/// Schema version this build writes.
pub const SCHEMA_VERSION: u32 = MIGRATIONS.len() as u32;

#[derive(Debug, thiserror::Error)]
pub enum StoreError {
    #[error(
        "This database was made by a newer Monks Central (schema {found}, this app knows {known}). Update the app."
    )]
    TooNew { found: u32, known: u32 },
    #[error("database error: {0}")]
    Sqlite(#[from] rusqlite::Error),
}

pub struct Store {
    conn: Connection,
}

impl Store {
    /// Open (or create) the database and bring it to [`SCHEMA_VERSION`].
    pub fn open(path: &Path) -> Result<Self, StoreError> {
        let mut conn = Connection::open(path)?;
        conn.busy_timeout(std::time::Duration::from_secs(5))?;
        conn.pragma_update(None, "foreign_keys", true)?;
        migrate(&mut conn)?;
        // After migrate, so a refused (newer) database is not switched to WAL.
        conn.pragma_update(None, "journal_mode", "WAL")?;
        Ok(Self { conn })
    }

    pub fn conn(&self) -> &Connection {
        &self.conn
    }

    pub fn schema_version(&self) -> Result<u32, StoreError> {
        Ok(user_version(&self.conn)?)
    }
}

fn user_version(conn: &Connection) -> rusqlite::Result<u32> {
    conn.query_row("PRAGMA user_version", [], |r| r.get(0))
}

fn migrate(conn: &mut Connection) -> Result<(), StoreError> {
    // IMMEDIATE takes the write lock first, so two processes cannot both apply a step.
    let tx = conn.transaction_with_behavior(TransactionBehavior::Immediate)?;
    let found = user_version(&tx)?;
    if found > SCHEMA_VERSION {
        return Err(StoreError::TooNew {
            found,
            known: SCHEMA_VERSION,
        });
    }
    for (i, sql) in MIGRATIONS.iter().enumerate().skip(found as usize) {
        tx.execute_batch(sql)?;
        tx.pragma_update(None, "user_version", i as u32 + 1)?;
    }
    tx.commit()?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fresh_database_reaches_latest_version_and_reopen_is_a_no_op() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("monks.db");
        let store = Store::open(&path).unwrap();
        assert_eq!(store.schema_version().unwrap(), SCHEMA_VERSION);
        store
            .conn()
            .execute(
                "INSERT INTO credentials (name, blob) VALUES ('a', x'00')",
                [],
            )
            .unwrap();
        drop(store);

        let store = Store::open(&path).unwrap();
        assert_eq!(store.schema_version().unwrap(), SCHEMA_VERSION);
        let n: i64 = store
            .conn()
            .query_row("SELECT count(*) FROM credentials", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 1, "reopen must keep data");
        let mode: String = store
            .conn()
            .query_row("PRAGMA journal_mode", [], |r| r.get(0))
            .unwrap();
        assert_eq!(mode, "wal");
    }

    #[test]
    fn job_items_keep_their_rows_when_rolled_back_is_added() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("monks.db");
        let conn = Connection::open(&path).unwrap();
        for sql in &MIGRATIONS[..5] {
            conn.execute_batch(sql).unwrap();
        }
        conn.pragma_update(None, "user_version", 5).unwrap();
        conn.execute_batch(
            "INSERT INTO jobs (title) VALUES ('Update');
             INSERT INTO job_items (job_id, site_name, action, label, state, message)
             VALUES (1, 'MC A', '{}', 'Update X', 'done', 'Updated.');",
        )
        .unwrap();
        drop(conn);
        let store = Store::open(&path).unwrap();
        let c = store.conn();
        let row: (String, String) = c
            .query_row("SELECT label, message FROM job_items", [], |r| {
                Ok((r.get(0)?, r.get(1)?))
            })
            .unwrap();
        assert_eq!(row, ("Update X".into(), "Updated.".into()));
        c.execute("UPDATE job_items SET state = 'rolled_back'", [])
            .unwrap();
        assert!(c.execute("UPDATE job_items SET state = 'x'", []).is_err());
        c.execute("DELETE FROM jobs", []).unwrap();
        let n: i64 = c
            .query_row("SELECT count(*) FROM job_items", [], |r| r.get(0))
            .unwrap();
        assert_eq!(n, 0, "items still go with their job");
    }

    #[test]
    fn newer_database_is_refused_and_left_alone() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("monks.db");
        let conn = Connection::open(&path).unwrap();
        conn.pragma_update(None, "user_version", SCHEMA_VERSION + 1)
            .unwrap();
        drop(conn);

        let err = Store::open(&path).err().unwrap();
        assert!(matches!(err, StoreError::TooNew { .. }), "{err}");
        assert!(err.to_string().contains("Update the app"));
        let conn = Connection::open(&path).unwrap();
        assert_eq!(user_version(&conn).unwrap(), SCHEMA_VERSION + 1);
    }
}
