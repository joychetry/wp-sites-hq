//! Sites in the store: how to reach them, what they run, groups, tags, notes.

use reqwest::Url;
use rusqlite::{Connection, OptionalExtension, Row, params};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Mode {
    /// Classic Monks over MCP with an OAuth grant.
    ClassicMonks,
    /// Core REST with an application password.
    Basic,
}

impl Mode {
    fn as_str(self) -> &'static str {
        match self {
            Mode::ClassicMonks => "classic_monks",
            Mode::Basic => "basic",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Health {
    Unknown,
    Ok,
    Warning,
    Down,
}

impl Health {
    fn as_str(self) -> &'static str {
        match self {
            Health::Unknown => "unknown",
            Health::Ok => "ok",
            Health::Warning => "warning",
            Health::Down => "down",
        }
    }

    fn parse(s: &str) -> Self {
        match s {
            "ok" => Health::Ok,
            "warning" => Health::Warning,
            "down" => Health::Down,
            _ => Health::Unknown,
        }
    }
}

/// Where the app talks OAuth to a Classic Monks site. Not secret.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct OAuthClient {
    pub issuer: String,
    pub token_endpoint: String,
    pub revocation_endpoint: Option<String>,
    pub client_id: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct Note {
    pub id: i64,
    pub body: String,
    pub added_at: i64,
}

#[derive(Debug, Clone, Serialize)]
pub struct Site {
    pub id: i64,
    pub url: String,
    pub name: String,
    pub mode: Mode,
    pub api_url: String,
    #[serde(skip)]
    pub oauth: Option<OAuthClient>,
    pub username: Option<String>,
    pub wp_version: Option<String>,
    pub php_version: Option<String>,
    pub cm_version: Option<String>,
    pub capabilities: Value,
    pub sign_in_again: bool,
    pub health: Health,
    pub health_detail: String,
    pub checked_at: Option<i64>,
    pub group: Option<String>,
    pub tags: Vec<String>,
    pub notes: Vec<Note>,
    pub added_at: i64,
    /// AI agents' own grant (plan 5.6). Its tokens are the `site:<id>:agent` secret.
    #[serde(skip)]
    pub agent_oauth: Option<OAuthClient>,
    /// Agents may change this site, each change approved on the site.
    pub agent_access: bool,
}

/// What a connect step learned about a site.
#[derive(Debug, Clone, Default)]
pub struct Details {
    pub name: String,
    pub wp_version: Option<String>,
    pub php_version: Option<String>,
    pub cm_version: Option<String>,
    pub capabilities: Value,
}

/// A site address as typed: `example.com`, `https://example.com/blog/`.
/// Returns the scheme, host, port and path, no query or trailing slash.
pub fn normalize_url(input: &str) -> Result<Url, &'static str> {
    const BAD: &str = "That isn't a site address. Type it like https://example.com.";
    let input = input.trim();
    let with_scheme = if input.contains("://") {
        input.to_string()
    } else {
        format!("https://{input}")
    };
    let mut url = Url::parse(&with_scheme).map_err(|_| BAD)?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return Err(BAD);
    }
    if !url.username().is_empty() || url.password().is_some() {
        return Err("Leave the user name and password out of the address.");
    }
    url.set_query(None);
    url.set_fragment(None);
    let path = url.path().trim_end_matches('/').to_string();
    url.set_path(&path);
    Ok(url)
}

/// `url` without the trailing slash `Url` keeps on a bare host.
pub fn url_string(url: &Url) -> String {
    url.as_str().trim_end_matches('/').to_string()
}

const COLUMNS: &str = "s.id, s.url, s.name, s.mode, s.api_url, s.oauth, s.username, s.wp_version,
    s.php_version, s.cm_version, s.capabilities, s.sign_in_again, s.health, s.health_detail,
    s.checked_at, g.name, s.added_at, s.agent_oauth";

fn from_row(r: &Row) -> rusqlite::Result<Site> {
    let mode: String = r.get(3)?;
    let oauth: Option<String> = r.get(5)?;
    let caps: String = r.get(10)?;
    let health: String = r.get(12)?;
    let agent_oauth: Option<OAuthClient> = r
        .get::<_, Option<String>>(17)?
        .and_then(|o| serde_json::from_str(&o).ok());
    Ok(Site {
        id: r.get(0)?,
        url: r.get(1)?,
        name: r.get(2)?,
        mode: if mode == "basic" {
            Mode::Basic
        } else {
            Mode::ClassicMonks
        },
        api_url: r.get(4)?,
        oauth: oauth.and_then(|o| serde_json::from_str(&o).ok()),
        username: r.get(6)?,
        wp_version: r.get(7)?,
        php_version: r.get(8)?,
        cm_version: r.get(9)?,
        capabilities: serde_json::from_str(&caps).unwrap_or_default(),
        sign_in_again: r.get(11)?,
        health: Health::parse(&health),
        health_detail: r.get(13)?,
        checked_at: r.get(14)?,
        group: r.get(15)?,
        tags: Vec::new(),
        notes: Vec::new(),
        added_at: r.get(16)?,
        agent_access: agent_oauth.is_some(),
        agent_oauth,
    })
}

fn with_extras(conn: &Connection, mut site: Site) -> rusqlite::Result<Site> {
    let mut tags =
        conn.prepare_cached("SELECT tag FROM site_tags WHERE site_id = ?1 ORDER BY tag")?;
    site.tags = tags
        .query_map([site.id], |r| r.get(0))?
        .collect::<Result<_, _>>()?;
    let mut notes = conn.prepare_cached(
        "SELECT id, body, added_at FROM site_notes WHERE site_id = ?1 ORDER BY added_at DESC, id DESC",
    )?;
    site.notes = notes
        .query_map([site.id], |r| {
            Ok(Note {
                id: r.get(0)?,
                body: r.get(1)?,
                added_at: r.get(2)?,
            })
        })?
        .collect::<Result<_, _>>()?;
    Ok(site)
}

pub fn list(conn: &Connection) -> rusqlite::Result<Vec<Site>> {
    let mut stmt = conn.prepare_cached(&format!(
        "SELECT {COLUMNS} FROM sites s LEFT JOIN site_groups g ON g.id = s.group_id ORDER BY s.name COLLATE NOCASE, s.id"
    ))?;
    let sites = stmt
        .query_map([], from_row)?
        .collect::<Result<Vec<_>, _>>()?;
    sites.into_iter().map(|s| with_extras(conn, s)).collect()
}

pub fn get(conn: &Connection, id: i64) -> rusqlite::Result<Option<Site>> {
    conn.query_row(
        &format!("SELECT {COLUMNS} FROM sites s LEFT JOIN site_groups g ON g.id = s.group_id WHERE s.id = ?1"),
        [id],
        from_row,
    )
    .optional()?
    .map(|s| with_extras(conn, s))
    .transpose()
}

pub fn find_by_url(conn: &Connection, url: &str) -> rusqlite::Result<Option<i64>> {
    conn.query_row("SELECT id FROM sites WHERE url = ?1", [url], |r| r.get(0))
        .optional()
}

pub struct NewSite<'a> {
    pub url: &'a str,
    pub mode: Mode,
    pub api_url: &'a str,
    pub oauth: Option<&'a OAuthClient>,
    pub username: Option<&'a str>,
}

pub fn insert(conn: &Connection, new: &NewSite, details: &Details) -> rusqlite::Result<i64> {
    conn.execute(
        "INSERT INTO sites (url, name, mode, api_url, oauth, username) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
        params![
            new.url,
            details.name,
            new.mode.as_str(),
            new.api_url,
            new.oauth.map(|o| serde_json::to_string(o).expect("plain struct")),
            new.username,
        ],
    )?;
    let id = conn.last_insert_rowid();
    set_details(conn, id, details)?;
    Ok(id)
}

/// A new sign-in for an existing site: new endpoints and client, signed in again.
pub fn set_connection(conn: &Connection, id: i64, new: &NewSite) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE sites SET mode = ?2, api_url = ?3, oauth = ?4, username = ?5, sign_in_again = 0 WHERE id = ?1",
        params![
            id,
            new.mode.as_str(),
            new.api_url,
            new.oauth.map(|o| serde_json::to_string(o).expect("plain struct")),
            new.username,
        ],
    )?;
    Ok(())
}

/// AI agents' grant on the site, or none.
pub fn set_agent(conn: &Connection, id: i64, client: Option<&OAuthClient>) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE sites SET agent_oauth = ?2 WHERE id = ?1",
        params![
            id,
            client.map(|o| serde_json::to_string(o).expect("plain struct"))
        ],
    )?;
    Ok(())
}

pub fn set_details(conn: &Connection, id: i64, d: &Details) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE sites SET name = CASE WHEN ?2 = '' THEN name ELSE ?2 END, wp_version = ?3,
         php_version = ?4, cm_version = ?5, capabilities = ?6 WHERE id = ?1",
        params![
            id,
            d.name,
            d.wp_version,
            d.php_version,
            d.cm_version,
            d.capabilities.to_string()
        ],
    )?;
    Ok(())
}

pub fn set_sign_in_again(conn: &Connection, id: i64, on: bool) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE sites SET sign_in_again = ?2 WHERE id = ?1",
        params![id, on],
    )?;
    Ok(())
}

pub fn set_health(
    conn: &Connection,
    id: i64,
    health: Health,
    detail: &str,
) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE sites SET health = ?2, health_detail = ?3, checked_at = unixepoch() WHERE id = ?1",
        params![id, health.as_str(), detail],
    )?;
    Ok(())
}

pub fn delete(conn: &Connection, id: i64) -> rusqlite::Result<bool> {
    let n = conn.execute("DELETE FROM sites WHERE id = ?1", [id])?;
    drop_empty_groups(conn)?;
    Ok(n > 0)
}

/// Put a site in a group (made on first use), or in none.
pub fn set_group(conn: &Connection, id: i64, group: Option<&str>) -> rusqlite::Result<()> {
    let group = group.map(str::trim).filter(|g| !g.is_empty());
    let group_id: Option<i64> = match group {
        Some(name) => {
            conn.execute(
                "INSERT INTO site_groups (name) VALUES (?1) ON CONFLICT (name) DO NOTHING",
                [name],
            )?;
            Some(
                conn.query_row("SELECT id FROM site_groups WHERE name = ?1", [name], |r| {
                    r.get(0)
                })?,
            )
        }
        None => None,
    };
    conn.execute(
        "UPDATE sites SET group_id = ?2 WHERE id = ?1",
        params![id, group_id],
    )?;
    drop_empty_groups(conn)
}

fn drop_empty_groups(conn: &Connection) -> rusqlite::Result<()> {
    conn.execute(
        "DELETE FROM site_groups WHERE id NOT IN (SELECT group_id FROM sites WHERE group_id IS NOT NULL)",
        [],
    )?;
    Ok(())
}

pub fn groups(conn: &Connection) -> rusqlite::Result<Vec<String>> {
    let mut stmt =
        conn.prepare_cached("SELECT name FROM site_groups ORDER BY name COLLATE NOCASE")?;
    stmt.query_map([], |r| r.get(0))?.collect()
}

/// Replace a site's tags. Blank and repeated tags are dropped.
pub fn set_tags(conn: &Connection, id: i64, tags: &[String]) -> rusqlite::Result<()> {
    conn.execute("DELETE FROM site_tags WHERE site_id = ?1", [id])?;
    for tag in tags.iter().map(|t| t.trim()).filter(|t| !t.is_empty()) {
        conn.execute(
            "INSERT INTO site_tags (site_id, tag) VALUES (?1, ?2) ON CONFLICT DO NOTHING",
            params![id, tag],
        )?;
    }
    Ok(())
}

pub fn add_note(conn: &Connection, id: i64, body: &str) -> rusqlite::Result<i64> {
    conn.execute(
        "INSERT INTO site_notes (site_id, body) VALUES (?1, ?2)",
        params![id, body.trim()],
    )?;
    Ok(conn.last_insert_rowid())
}

pub fn delete_note(conn: &Connection, note_id: i64) -> rusqlite::Result<bool> {
    Ok(conn.execute("DELETE FROM site_notes WHERE id = ?1", [note_id])? > 0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::store::Store;

    fn store() -> (tempfile::TempDir, Store) {
        let dir = tempfile::tempdir().unwrap();
        let store = Store::open(&dir.path().join("monks.db")).unwrap();
        (dir, store)
    }

    fn add(conn: &Connection, url: &str, name: &str) -> i64 {
        insert(
            conn,
            &NewSite {
                url,
                mode: Mode::Basic,
                api_url: "https://x/wp-json/",
                oauth: None,
                username: Some("admin"),
            },
            &Details {
                name: name.into(),
                ..Default::default()
            },
        )
        .unwrap()
    }

    #[test]
    fn addresses_are_normalized() {
        let n = |s| normalize_url(s).map(|u| url_string(&u));
        assert_eq!(n("example.com").unwrap(), "https://example.com");
        assert_eq!(n(" https://Example.com/ ").unwrap(), "https://example.com");
        assert_eq!(
            n("http://x.local/blog/?a=1#f").unwrap(),
            "http://x.local/blog"
        );
        assert_eq!(n("https://x.local:8443").unwrap(), "https://x.local:8443");
        assert!(n("ftp://x.local").is_err());
        assert!(n("https://").is_err());
        assert!(n("https://joy:pw@x.local").is_err());
    }

    #[test]
    fn groups_tags_and_notes() {
        let (_d, store) = store();
        let c = store.conn();
        let a = add(c, "https://a.local", "Beta");
        let b = add(c, "https://b.local", "alpha");

        set_group(c, a, Some(" Clients ")).unwrap();
        set_group(c, b, Some("clients")).unwrap();
        assert_eq!(groups(c).unwrap(), ["Clients"]);
        set_tags(
            c,
            a,
            &["woo".into(), " ".into(), "Woo".into(), "care".into()],
        )
        .unwrap();
        let n1 = add_note(c, a, " First ").unwrap();
        add_note(c, a, "Second").unwrap();

        let all = list(c).unwrap();
        assert_eq!(
            all.iter().map(|s| s.name.as_str()).collect::<Vec<_>>(),
            ["alpha", "Beta"]
        );
        let site = get(c, a).unwrap().unwrap();
        assert_eq!(site.group.as_deref(), Some("Clients"));
        assert_eq!(site.tags, ["care", "woo"]);
        assert_eq!(site.notes.len(), 2);
        assert!(site.notes.iter().any(|n| n.body == "First"));

        assert!(delete_note(c, n1).unwrap());
        set_group(c, a, None).unwrap();
        set_group(c, b, Some("")).unwrap();
        assert!(groups(c).unwrap().is_empty(), "empty groups are dropped");

        assert!(delete(c, a).unwrap());
        let tags: i64 = c
            .query_row("SELECT count(*) FROM site_tags", [], |r| r.get(0))
            .unwrap();
        assert_eq!(tags, 0, "tags go with the site");
        assert!(get(c, a).unwrap().is_none());
    }

    #[test]
    fn details_health_and_sign_in_state() {
        let (_d, store) = store();
        let c = store.conn();
        let id = add(c, "https://a.local", "A");
        assert_eq!(find_by_url(c, "https://a.local").unwrap(), Some(id));
        set_details(
            c,
            id,
            &Details {
                name: String::new(),
                wp_version: Some("7.1.3".into()),
                capabilities: serde_json::json!({ "operator": true }),
                ..Default::default()
            },
        )
        .unwrap();
        set_health(c, id, Health::Warning, "slow").unwrap();
        set_sign_in_again(c, id, true).unwrap();
        let s = get(c, id).unwrap().unwrap();
        assert_eq!(s.name, "A", "a blank name keeps the old one");
        assert_eq!(s.wp_version.as_deref(), Some("7.1.3"));
        assert_eq!(s.capabilities["operator"], true);
        assert_eq!(
            (s.health, s.health_detail.as_str()),
            (Health::Warning, "slow")
        );
        assert!(s.checked_at.is_some());
        assert!(s.sign_in_again);
        let json = serde_json::to_value(&s).unwrap();
        assert_eq!(json["mode"], "basic");
        assert!(json.get("oauth").is_none());
    }
}
