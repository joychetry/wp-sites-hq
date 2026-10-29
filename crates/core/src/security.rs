// SPDX-License-Identifier: GPL-3.0-or-later
//! Security (plan Phase 6): known vulnerabilities in what each site runs, from
//! WPVulnerability (free, no key), plugins WordPress.org closed or nobody has
//! updated in two years (the same answers carry both), and checksums of
//! WordPress and plugins against WordPress.org's, read by Classic Monks.

use std::cmp::Ordering;
use std::sync::Arc;

use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::connect::SiteError;
use crate::fleet::{Inventory, Item, has_tool};
use crate::sites::{Mode, Site};
use crate::{Changed, Core};

/// Answers are kept this long, so sites running the same plugin share one.
const LOOKUP_FOR: i64 = 24 * 3600;
/// A plugin nobody updated for this long counts as abandoned.
const ABANDONED_AFTER: i64 = 2 * 365 * 24 * 3600;
/// Each site is scanned again after this long while the core runs.
pub const SCAN_EVERY: i64 = 24 * 3600;

/// Outside services Monks Central reads. Tests point them at a local server.
#[derive(Debug, Clone)]
pub struct Feeds {
    pub vulnerabilities: String,
    pub rdap: String,
    pub pagespeed: String,
    /// Google sign-in, tokens and Search Console's API, for Search Console.
    pub google_auth: String,
    pub google_token: String,
    pub search_console: String,
    /// WordPress.org's API: plugin search, plugin icons, theme screenshots.
    pub wordpress_org: String,
    /// Tests: a local server standing in for WordPress.org's image hosts.
    pub wordpress_org_images: Option<String>,
    /// The Monks Central plugin's latest GitHub release (the API's `releases/latest`).
    pub plugin_release: String,
}

impl Default for Feeds {
    fn default() -> Self {
        Self {
            vulnerabilities: "https://www.wpvulnerability.net".into(),
            rdap: "https://rdap.org".into(),
            pagespeed: "https://www.googleapis.com/pagespeedonline/v5/runPagespeed".into(),
            google_auth: "https://accounts.google.com/o/oauth2/v2/auth".into(),
            google_token: "https://oauth2.googleapis.com/token".into(),
            search_console: "https://searchconsole.googleapis.com/webmasters/v3".into(),
            // Unit tests never reach the real directory: nothing listens there.
            wordpress_org: if cfg!(test) {
                "http://127.0.0.1:9".into()
            } else {
                "https://api.wordpress.org".into()
            },
            wordpress_org_images: None,
            plugin_release: if cfg!(test) {
                "http://127.0.0.1:9".into()
            } else {
                "https://api.github.com/repos/joychetry/monks-central-wp/releases/latest".into()
            },
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Vulnerability {
    /// `plugin`, `theme` or `wordpress`.
    pub kind: String,
    /// Plugin file or theme folder; empty for WordPress.
    pub id: String,
    pub name: String,
    pub installed: String,
    pub title: String,
    /// critical, high, medium or low, when the feed knows.
    pub severity: Option<String>,
    /// The first version without it; `None` when no fix is out yet.
    pub fixed_in: Option<String>,
    pub link: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Abandoned {
    pub id: String,
    pub name: String,
    pub version: String,
    /// When WordPress.org last saw a release.
    pub last_updated: Option<i64>,
    /// WordPress.org closed it: no more updates, often for security.
    pub closed: bool,
    pub reason: Option<String>,
}

/// Files that differ from WordPress.org's copy of one thing.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Differs {
    pub name: String,
    pub modified: Vec<String>,
    pub missing: Vec<String>,
    pub added: Vec<String>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Checksums {
    /// How many things (WordPress, each plugin) were compared.
    pub checked: usize,
    /// Plugins WordPress.org has no checksums for (premium, custom).
    pub not_verifiable: Vec<String>,
    pub changed: Vec<Differs>,
}

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Report {
    pub site_id: i64,
    pub checked_at: i64,
    pub vulnerabilities: Vec<Vulnerability>,
    pub abandoned: Vec<Abandoned>,
    /// `None` when the site can't compare checksums; `notes` says why.
    pub checksums: Option<Checksums>,
    /// What couldn't be checked, in plain words.
    pub notes: Vec<String>,
}

/// Compare versions as PHP's version_compare does for plain dotted versions.
/// shortcut: letters sort as text (1.0-beta > 1.0), fine for release versions; upgrade if pre-releases matter.
pub fn version_cmp(a: &str, b: &str) -> Ordering {
    let parts = |v: &str| -> Vec<String> {
        v.split(['.', '-', '_', '+'])
            .filter(|p| !p.is_empty())
            .map(String::from)
            .collect()
    };
    let (a, b) = (parts(a), parts(b));
    for i in 0..a.len().max(b.len()) {
        let (x, y) = (
            a.get(i).map_or("0", String::as_str),
            b.get(i).map_or("0", String::as_str),
        );
        let o = match (x.parse::<u64>(), y.parse::<u64>()) {
            (Ok(x), Ok(y)) => x.cmp(&y),
            _ => x.cmp(y),
        };
        if o != Ordering::Equal {
            return o;
        }
    }
    Ordering::Equal
}

/// Whether `installed` falls in a WPVulnerability `operator` range.
fn affected(installed: &str, op: &Value) -> bool {
    let check = |version: &Value, operator: &Value| {
        let Some(v) = version.as_str().filter(|v| !v.is_empty()) else {
            return true;
        };
        let o = version_cmp(installed, v);
        match operator.as_str().unwrap_or("lt") {
            "lt" => o == Ordering::Less,
            "le" => o != Ordering::Greater,
            "gt" => o == Ordering::Greater,
            "ge" => o != Ordering::Less,
            "eq" => o == Ordering::Equal,
            _ => false,
        }
    };
    if op["max_version"].is_null() && op["min_version"].is_null() {
        // No range: every version, while no fix is out.
        return op["unfixed"] == "1";
    }
    check(&op["min_version"], &op["min_operator"]) && check(&op["max_version"], &op["max_operator"])
}

fn severity(impact: &Value) -> Option<String> {
    if let Some(s) = impact["cvss3"]["severity"].as_str() {
        return Some(s.to_lowercase());
    }
    let s = match impact["cvss"]["severity"].as_str()? {
        "c" => "critical",
        "h" => "high",
        "m" => "medium",
        "l" => "low",
        _ => return None,
    };
    Some(s.into())
}

/// A vulnerability in words: a source's own title, else the first sentence of
/// a CVE's description with its number, else the feed's version range.
fn title(v: &Value, named: Option<&Value>, sources: &[Value]) -> String {
    if let Some(n) = named.and_then(|s| s["name"].as_str()) {
        return n.to_string();
    }
    let described = sources.iter().find_map(|s| {
        let d = s["description"].as_str()?.trim_start_matches("[en]").trim();
        let first = d.split(". ").next().unwrap_or(d).trim_end_matches('.');
        let first = first.split(".This").next().unwrap_or(first);
        (!first.is_empty()).then(|| format!("{first} ({})", s["id"].as_str().unwrap_or("CVE")))
    });
    described
        .or_else(|| v["name"].as_str().map(String::from))
        .unwrap_or_else(|| "A known vulnerability".into())
}

/// The vulnerabilities in one feed answer that hit the installed version.
fn vulnerabilities(kind: &str, item: &Item, data: &Value) -> Vec<Vulnerability> {
    let Some(list) = data["vulnerability"].as_array() else {
        return Vec::new();
    };
    list.iter()
        .filter(|v| affected(&item.version, &v["operator"]))
        .map(|v| {
            let sources = v["source"].as_array().cloned().unwrap_or_default();
            // A source with words beats a bare CVE number.
            let named = sources.iter().find(|s| s["name"] != s["id"]);
            let op = &v["operator"];
            let fixed_in = (op["max_operator"] == "lt" && op["unfixed"] != "1")
                .then(|| op["max_version"].as_str().map(String::from))
                .flatten();
            Vulnerability {
                kind: kind.into(),
                id: item.id.clone(),
                name: item.name.clone(),
                installed: item.version.clone(),
                title: crate::fleet::decode_entities(&title(v, named, &sources)),
                severity: severity(&v["impact"]),
                fixed_in,
                link: named
                    .or(sources.first())
                    .and_then(|s| s["link"].as_str())
                    .map(String::from),
            }
        })
        .collect()
}

/// A WordPress.org plugin that was closed, or not updated for two years.
fn abandoned(item: &Item, data: &Value, now: i64) -> Option<Abandoned> {
    data["name"].as_str()?;
    let last_updated = data["latest"]
        .as_str()
        .and_then(|t| t.parse().ok())
        .or(data["latest"].as_i64());
    let closed = data["closed"] == 1 || data["closed"] == "1";
    let old = last_updated.is_some_and(|t| now - t > ABANDONED_AFTER);
    (closed || old).then(|| Abandoned {
        id: item.id.clone(),
        name: item.name.clone(),
        version: item.version.clone(),
        last_updated,
        closed,
        reason: data["closed_reason"].as_str().map(String::from),
    })
}

/// The WordPress.org slug of a plugin file or theme folder.
fn slug(id: &str) -> &str {
    let folder = id.split('/').next().unwrap_or(id);
    folder.strip_suffix(".php").unwrap_or(folder)
}

fn strings(v: &Value) -> Vec<String> {
    v.as_array()
        .map(|a| {
            a.iter()
                .filter_map(|s| s.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default()
}

fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_secs() as i64)
}

impl Core {
    /// One WPVulnerability answer's `data`, shared by every site for a day.
    async fn feed(&self, path: &str) -> Result<Value, String> {
        let cached: Option<String> = self
            .db(|c| {
                c.query_row(
                    "SELECT body FROM lookups WHERE key = ?1 AND fetched_at > unixepoch() - ?2",
                    params![path, LOOKUP_FOR],
                    |r| r.get(0),
                )
                .optional()
            })
            .map_err(|e| e.to_string())?;
        if let Some(body) = cached {
            return serde_json::from_str(&body).map_err(|e| e.to_string());
        }
        let url = format!("{}/{path}/", self.feeds.vulnerabilities);
        let reply = self
            .http
            .get(&url)
            .send()
            .await
            .map_err(|e| crate::net::NetError::from(e).message.to_string())?;
        if !reply.status().is_success() {
            return Err(format!("it answered {}", reply.status().as_u16()));
        }
        let v: Value = reply
            .json()
            .await
            .map_err(|_| "its answer wasn't readable".to_string())?;
        let data = v["data"].clone();
        let body = data.to_string();
        self.db(|c| {
            c.execute(
                "INSERT INTO lookups (key, fetched_at, body) VALUES (?1, unixepoch(), ?2)
                 ON CONFLICT (key) DO UPDATE SET fetched_at = excluded.fetched_at, body = excluded.body",
                params![path, body],
            )
        })
        .map_err(|e| e.to_string())?;
        Ok(data)
    }

    /// Look up everything the site runs, compare checksums, and keep the report.
    pub async fn scan_security(&self, id: i64) -> Result<Report, SiteError> {
        let _work = self.working().await;
        let site = self.site(id)?;
        let inv = match self.inventory_of(id)? {
            Some(inv) => inv,
            None => self.refresh_inventory_inner(id).await?,
        };
        let mut report = Report {
            site_id: id,
            checked_at: now(),
            ..Default::default()
        };
        self.look_up(&inv, &mut report).await;
        report.checksums = self.checksums(&site, &inv, &mut report.notes).await;
        let json = serde_json::to_string(&report).expect("plain data");
        self.db(|c| {
            c.execute(
                "INSERT INTO security (site_id, checked_at, report) VALUES (?1, ?2, ?3)
                 ON CONFLICT (site_id) DO UPDATE SET checked_at = excluded.checked_at, report = excluded.report",
                params![id, report.checked_at, json],
            )
        })?;
        let _ = self.changed.send(Changed::Security);
        Ok(report)
    }

    async fn look_up(&self, inv: &Inventory, report: &mut Report) {
        let mut missed = 0;
        let wordpress = inv.wordpress.as_ref().map(|v| Item {
            name: "WordPress".into(),
            version: v.clone(),
            ..Default::default()
        });
        let items = wordpress
            .iter()
            .map(|w| ("wordpress", w))
            .chain(inv.plugins.iter().map(|p| ("plugin", p)))
            .chain(inv.themes.iter().map(|t| ("theme", t)));
        for (kind, item) in items {
            let path = match kind {
                "wordpress" => format!("core/{}", item.version),
                _ => format!("{kind}/{}", slug(&item.id)),
            };
            match self.feed(&path).await {
                Ok(data) => {
                    report
                        .vulnerabilities
                        .extend(vulnerabilities(kind, item, &data));
                    if kind == "plugin" {
                        report
                            .abandoned
                            .extend(abandoned(item, &data, report.checked_at));
                    }
                }
                Err(_) => missed += 1,
            }
        }
        if missed > 0 {
            report.notes.push(format!(
                "WPVulnerability didn't answer for {missed} of the things this site runs. Scan again later."
            ));
        }
    }

    async fn checksums(
        &self,
        site: &Site,
        inv: &Inventory,
        notes: &mut Vec<String>,
    ) -> Option<Checksums> {
        if site.mode == Mode::Basic {
            notes.push("Checksums need Classic Monks on the site.".into());
            return None;
        }
        if !has_tool(site, "verify-core-checksums") {
            notes.push("Checksums need Classic Monks Pro on the site.".into());
            return None;
        }
        let mut sums = Checksums::default();
        let found = |name: &str, out: &Value, sums: &mut Checksums| {
            sums.checked += 1;
            if out["verifiable"] == false {
                sums.not_verifiable.push(name.to_string());
                return;
            }
            let c = Differs {
                name: name.into(),
                modified: strings(&out["modified"]),
                missing: strings(&out["missing"]),
                added: strings(&out["added"]),
            };
            if !(c.modified.is_empty() && c.missing.is_empty() && c.added.is_empty()) {
                sums.changed.push(c);
            }
        };
        match self
            .call_ability_inner(site.id, "verify-core-checksums", json!({}))
            .await
        {
            Ok(out) => found("WordPress", &out, &mut sums),
            Err(e) => notes.push(format!("WordPress' checksums couldn't be read: {e}")),
        }
        if has_tool(site, "verify-plugin-checksums") {
            for p in &inv.plugins {
                match self
                    .call_ability_inner(
                        site.id,
                        "verify-plugin-checksums",
                        json!({ "plugin_file": p.id }),
                    )
                    .await
                {
                    Ok(out) => found(&p.name, &out, &mut sums),
                    Err(e) => notes.push(format!("{}'s checksums couldn't be read: {e}", p.name)),
                }
            }
        }
        Some(sums)
    }

    /// Every site's last report.
    pub fn security_reports(&self) -> Result<Vec<Report>, SiteError> {
        let rows: Vec<String> = self.db(|c| {
            let mut stmt = c.prepare_cached("SELECT report FROM security ORDER BY site_id")?;
            stmt.query_map([], |r| r.get(0))?.collect()
        })?;
        Ok(rows
            .iter()
            .filter_map(|r| serde_json::from_str(r).ok())
            .collect())
    }

    /// Scan every site (or the ones not scanned for a day), side by side.
    pub async fn scan_all_security(self: &Arc<Self>, only_due: bool) {
        let Ok(all) = self.sites() else { return };
        let done: Vec<(i64, i64)> = self
            .db(|c| {
                let mut stmt = c.prepare_cached("SELECT site_id, checked_at FROM security")?;
                stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?)))?
                    .collect()
            })
            .unwrap_or_default();
        let mut set = tokio::task::JoinSet::new();
        for site in all {
            let last = done.iter().find(|d| d.0 == site.id).map(|d| d.1);
            if only_due && last.is_some_and(|t| now() - t < SCAN_EVERY) {
                continue;
            }
            let core = self.clone();
            set.spawn(async move { core.scan_security(site.id).await });
        }
        while set.join_next().await.is_some() {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Options;
    use crate::testsite::TestSite;
    use axum::extract::{Path, State};
    use std::sync::atomic::{AtomicUsize, Ordering as AtOrd};

    fn item(id: &str, version: &str) -> Item {
        Item {
            id: id.into(),
            name: "Contact Form 7".into(),
            version: version.into(),
            ..Default::default()
        }
    }

    fn cf7() -> Value {
        json!({ "name": "Contact Form 7", "latest": "1792572180", "closed": 0, "vulnerability": [
            { "name": "Contact Form 7 [contact-form-7] < 5.3.2",
              "operator": { "min_version": null, "min_operator": null, "max_version": "5.3.2", "max_operator": "lt", "unfixed": "0" },
              "source": [{ "id": "CVE-2020-35489", "name": "CVE-2020-35489", "link": "https://www.cve.org/x" },
                         { "id": "w1", "name": "Contact Form 7 &lt; 5.3.2 - Unrestricted File Upload", "link": "https://wpscan.com/v" }],
              "impact": { "cvss3": { "severity": "critical" } } },
            { "name": "Contact Form 7 [contact-form-7] <= 5.9",
              "operator": { "min_version": "5.0", "min_operator": "ge", "max_version": "5.9", "max_operator": "le", "unfixed": "0" },
              "source": [], "impact": { "cvss": { "severity": "m" } } },
            { "name": "Contact Form 7 unfixed", "operator": { "min_version": null, "max_version": null, "unfixed": "1" }, "source": [] },
        ]})
    }

    #[test]
    fn versions_compare_like_php() {
        assert_eq!(version_cmp("5.3.1", "5.3.2"), Ordering::Less);
        assert_eq!(version_cmp("5.10", "5.9"), Ordering::Greater);
        assert_eq!(version_cmp("6.0", "6.0.0"), Ordering::Equal);
        assert_eq!(version_cmp("10.3.0", "10.2.9"), Ordering::Greater);
    }

    #[test]
    fn only_the_installed_versions_vulnerabilities_count() {
        let old = vulnerabilities(
            "plugin",
            &item("contact-form-7/wp-contact-form-7.php", "5.3.1"),
            &cf7(),
        );
        assert_eq!(old.len(), 3, "{old:?}");
        assert_eq!(
            old[0].title,
            "Contact Form 7 < 5.3.2 - Unrestricted File Upload"
        );
        assert_eq!(old[0].severity.as_deref(), Some("critical"));
        assert_eq!(old[0].fixed_in.as_deref(), Some("5.3.2"));
        assert_eq!(old[0].link.as_deref(), Some("https://wpscan.com/v"));
        assert_eq!(old[2].fixed_in, None, "no fix out yet");
        let mid = vulnerabilities("plugin", &item("x", "5.9"), &cf7());
        assert_eq!(mid[0].severity.as_deref(), Some("medium"));
        let cve = json!({ "name": "Woo [woocommerce] >= 9.8.0 - < 11.2.0", "source": [{ "id": "CVE-2026-1", "name": "CVE-2026-1",
            "description": "[en] Incorrect Privilege Assignment vulnerability in WooCommerce allows Privilege Escalation.This issue affects WooCommerce: from 9.8.0." }] });
        let sources = cve["source"].as_array().unwrap().clone();
        assert_eq!(
            title(&cve, None, &sources),
            "Incorrect Privilege Assignment vulnerability in WooCommerce allows Privilege Escalation (CVE-2026-1)"
        );
        assert_eq!(title(&json!({ "name": "Range" }), None, &[]), "Range");
        assert_eq!(mid[0].fixed_in, None, "le: the fixed version isn't known");
        assert_eq!(
            vulnerabilities("plugin", &item("x", "6.1"), &cf7()).len(),
            1
        );
        assert!(
            vulnerabilities("plugin", &item("x", "1"), &json!({ "vulnerability": null }))
                .is_empty()
        );
    }

    #[test]
    fn closed_or_two_years_quiet_is_abandoned() {
        let now = 1_800_000_000;
        let p = item("old/old.php", "1.0");
        assert!(
            abandoned(
                &p,
                &json!({ "name": "Old", "latest": (now - 100).to_string(), "closed": 0 }),
                now
            )
            .is_none()
        );
        let quiet = abandoned(&p, &json!({ "name": "Old", "latest": (now - ABANDONED_AFTER - 1).to_string(), "closed": 0 }), now).unwrap();
        assert!(!quiet.closed);
        let closed = abandoned(&p, &json!({ "name": "Old", "latest": null, "closed": 1, "closed_reason": "security-issue" }), now).unwrap();
        assert_eq!(
            (closed.closed, closed.reason.as_deref()),
            (true, Some("security-issue"))
        );
        assert!(
            abandoned(&p, &json!({ "name": null, "closed": null }), now).is_none(),
            "not on WordPress.org"
        );
        assert_eq!(slug("hello.php"), "hello");
        assert_eq!(slug("woocommerce/woocommerce.php"), "woocommerce");
    }

    async fn feed_server() -> (String, Arc<AtomicUsize>) {
        let hits = Arc::new(AtomicUsize::new(0));
        let app = axum::Router::new()
            .route(
                "/{kind}/{slug}/",
                axum::routing::get(|State(h): State<Arc<AtomicUsize>>, Path((kind, slug)): Path<(String, String)>| async move {
                    h.fetch_add(1, AtOrd::SeqCst);
                    let data = match (kind.as_str(), slug.as_str()) {
                        ("plugin", "woocommerce") => json!({ "name": "WooCommerce", "latest": "1", "closed": 0, "vulnerability": [
                            { "name": "Woo < 10.3", "operator": { "max_version": "10.3.0", "max_operator": "lt", "unfixed": "0" }, "source": [] }] }),
                        ("theme", _) => return axum::http::StatusCode::INTERNAL_SERVER_ERROR.into_response(),
                        _ => json!({ "name": null, "vulnerability": null }),
                    };
                    axum::Json(json!({ "error": 0, "data": data })).into_response()
                }),
            )
            .with_state(hits.clone());
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        (url, hits)
    }
    use axum::response::IntoResponse;

    #[tokio::test]
    async fn a_scan_finds_vulnerabilities_abandoned_plugins_and_changed_files() {
        let (feed, hits) = feed_server().await;
        let home = tempfile::tempdir().unwrap();
        let opts = Options {
            keychain: Ok(keyring_core::mock::Store::new().unwrap()),
            feeds: Feeds {
                vulnerabilities: feed,
                ..Default::default()
            },
            ..Default::default()
        };
        let core = Core::start(home.path(), opts).await.unwrap();
        let site = TestSite::start().await;
        site.state().modified_core = vec!["wp-includes/version.php".into()];
        site.state().plugins.push(json!({ "plugin": "premium/premium.php", "name": "Premium", "version": "1.0", "active": true, "update": null }));
        let browser = |url: &str| {
            let url = url.to_string();
            tokio::spawn(async move { reqwest::get(url).await });
            Ok(())
        };
        let s = core.add_site_oauth(&site.url, browser).await.unwrap();
        let mut events = core.subscribe();
        let r = core.scan_security(s.id).await.unwrap();
        assert_eq!(r.vulnerabilities.len(), 1, "{r:?}");
        let v = &r.vulnerabilities[0];
        assert_eq!(
            (v.kind.as_str(), v.name.as_str(), v.installed.as_str()),
            ("plugin", "WooCommerce", "10.2.0")
        );
        assert_eq!(v.fixed_in.as_deref(), Some("10.3.0"));
        assert_eq!(r.abandoned.len(), 1, "last released in 1970");
        assert_eq!(r.abandoned[0].name, "WooCommerce");
        let sums = r.checksums.as_ref().unwrap();
        assert_eq!(sums.checked, 3);
        assert_eq!(sums.not_verifiable, ["Premium"]);
        assert_eq!(sums.changed[0].name, "WordPress");
        assert_eq!(sums.changed[0].modified, ["wp-includes/version.php"]);
        assert_eq!(
            r.notes,
            ["WPVulnerability didn't answer for 1 of the things this site runs. Scan again later."]
        );
        assert!(matches!(events.recv().await, Ok(Changed::Security)));
        assert_eq!(core.security_reports().unwrap(), std::slice::from_ref(&r));

        // The answers are kept: a second scan asks again only for what failed.
        let before = hits.load(AtOrd::SeqCst);
        core.scan_all_security(false).await;
        assert_eq!(hits.load(AtOrd::SeqCst), before + 1);
        core.scan_all_security(true).await;
        assert_eq!(
            hits.load(AtOrd::SeqCst),
            before + 1,
            "scanned today already"
        );

        // Older Classic Monks: no checksums, and it says why.
        site.state().no_safe_tools = true;
        let s = core.sign_in_again_oauth(s.id, browser).await.unwrap();
        let r = core.scan_security(s.id).await.unwrap();
        assert!(r.checksums.is_none());
        assert!(
            r.notes
                .contains(&"Checksums need Classic Monks Pro on the site.".to_string())
        );
    }
}
