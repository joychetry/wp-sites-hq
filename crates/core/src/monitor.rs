// SPDX-License-Identifier: GPL-3.0-or-later
//! Monitoring (plan Phase 6): each site's home page every five minutes (up or
//! down, how fast, and when its certificate expires), when its domain expires
//! (RDAP, once a day), and Google PageSpeed when asked. It runs while the core
//! runs: the app in the tray, or a headless core.

use std::sync::Arc;
use std::time::{Duration, Instant};

use rusqlite::{OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::connect::{SiteError, plain};
use crate::sites::Site;
use crate::{Changed, Core};

/// How often each home page is loaded.
pub const UPTIME_EVERY: Duration = Duration::from_secs(5 * 60);
const DOMAIN_EVERY: i64 = 24 * 3600;
/// Uptime rows older than this are dropped: two months, so last month's report has all of it.
const KEEP: i64 = 62 * 24 * 3600;
const LOCAL: &str = "A local address: there's no domain to renew and PageSpeed can't reach it.";

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct PageSpeed {
    /// Google's performance score, 0 to 100, for a phone.
    pub score: u8,
    pub lcp: String,
    pub cls: String,
    pub tbt: String,
    pub at: i64,
}

/// One site's monitors, as last measured.
#[derive(Debug, Clone, Default, PartialEq, Serialize)]
pub struct Monitor {
    pub site_id: i64,
    /// On the public internet: has a domain, and PageSpeed can reach it.
    pub public: bool,
    pub checked_at: Option<i64>,
    pub up: Option<bool>,
    pub status: u16,
    pub ms: i64,
    /// Why it's down, in plain words.
    pub error: String,
    /// Since when it has been down, while it is.
    pub down_since: Option<i64>,
    /// Share of checks that found it up, as a percentage.
    pub uptime_day: Option<f64>,
    pub uptime_month: Option<f64>,
    /// The last 24 hours, an hour each, oldest first: None where no check ran.
    pub day: Vec<Option<Hour>>,
    pub cert_expires: Option<i64>,
    pub domain: Option<String>,
    pub domain_expires: Option<i64>,
    /// Why there's no expiry date, when there isn't.
    pub domain_note: String,
    pub pagespeed: Option<PageSpeed>,
}

/// One hour of home page checks.
#[derive(Debug, Clone, Copy, PartialEq, Serialize)]
pub struct Hour {
    /// Average response time of the checks that found it up.
    pub ms: Option<i64>,
    /// Every check that hour found it up.
    pub up: bool,
}

fn now() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |d| d.as_secs() as i64)
}

/// One DER element: (tag, content, what follows).
fn tlv(b: &[u8]) -> Option<(u8, &[u8], &[u8])> {
    let (&tag, b) = b.split_first()?;
    let (&first, mut b) = b.split_first()?;
    let len = if first < 0x80 {
        usize::from(first)
    } else {
        let n = usize::from(first & 0x7f);
        if n == 0 || n > 3 || b.len() < n {
            return None;
        }
        let len = b[..n].iter().fold(0, |l, &x| (l << 8) | usize::from(x));
        b = &b[n..];
        len
    };
    (b.len() >= len).then(|| (tag, &b[..len], &b[len..]))
}

/// When an X.509 certificate stops being valid (TBSCertificate's notAfter).
pub fn not_after(der: &[u8]) -> Option<i64> {
    let (_, cert, _) = tlv(der)?;
    let (_, tbs, _) = tlv(cert)?;
    let (tag, _, mut rest) = tlv(tbs)?;
    if tag != 0xa0 {
        rest = tbs; // No explicit version: the serial comes first.
    }
    // Serial, signature algorithm, issuer, then validity.
    for _ in 0..3 {
        rest = tlv(rest)?.2;
    }
    let (_, validity, _) = tlv(rest)?;
    let (_, _, after) = tlv(validity)?;
    let (tag, time, _) = tlv(after)?;
    let t = std::str::from_utf8(time).ok()?;
    match tag {
        // UTCTime: YYMMDDHHMMSSZ, years 1950 to 2049.
        0x17 => {
            let yy: i64 = t.get(..2)?.parse().ok()?;
            unix(if yy < 50 { 2000 + yy } else { 1900 + yy }, t.get(2..)?)
        }
        // GeneralizedTime: YYYYMMDDHHMMSSZ.
        0x18 => unix(t.get(..4)?.parse().ok()?, t.get(4..)?),
        _ => None,
    }
}

/// Seconds since 1970 for a year and "MMDDHHMMSS…".
fn unix(year: i64, rest: &str) -> Option<i64> {
    let n = |r: std::ops::Range<usize>| rest.get(r)?.parse::<i64>().ok();
    let (m, d, h, mi, s) = (n(0..2)?, n(2..4)?, n(4..6)?, n(6..8)?, n(8..10)?);
    // Days from civil (Howard Hinnant's algorithm).
    let y = if m <= 2 { year - 1 } else { year };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let doy = (153 * (m + if m > 2 { -3 } else { 9 }) + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    let days = era * 146_097 + doe - 719_468;
    Some(days * 86400 + h * 3600 + mi * 60 + s)
}

/// An RFC 3339 date as RDAP gives it ("2027-08-13T04:00:00Z").
fn rfc3339(d: &str) -> Option<i64> {
    let digits: String = d.chars().filter(char::is_ascii_digit).take(14).collect();
    unix(digits.get(..4)?.parse().ok()?, digits.get(4..)?)
}

/// The host, if it's a public name a registry could know.
fn public_host(url: &str) -> Option<String> {
    let host = reqwest::Url::parse(url).ok()?.host_str()?.to_lowercase();
    let local = [
        ".local",
        ".test",
        ".localhost",
        ".internal",
        ".lan",
        ".home.arpa",
        ".example",
        ".invalid",
    ];
    let ip = host.parse::<std::net::IpAddr>().is_ok() || host.starts_with('[');
    (!ip && host.contains('.') && !local.iter().any(|l| host.ends_with(l))).then_some(host)
}

/// The domain names to ask RDAP about, shortest first: a.b.example.co.uk
/// tries co.uk, example.co.uk, and so on, until a registry knows one.
fn candidates(host: &str) -> Vec<String> {
    let labels: Vec<&str> = host.split('.').collect();
    (2..=labels.len())
        .map(|n| labels[labels.len() - n..].join("."))
        .collect()
}

fn pagespeed_of(v: &Value) -> Option<PageSpeed> {
    let lh = &v["lighthouseResult"];
    let score = lh["categories"]["performance"]["score"].as_f64()?;
    let shown = |audit: &str| {
        lh["audits"][audit]["displayValue"]
            .as_str()
            .unwrap_or("not measured")
            .replace('\u{a0}', " ")
    };
    Some(PageSpeed {
        score: (score * 100.0).round() as u8,
        lcp: shown("largest-contentful-paint"),
        cls: shown("cumulative-layout-shift"),
        tbt: shown("total-blocking-time"),
        at: now(),
    })
}

impl Core {
    /// Load the home page as a visitor would, and record what happened.
    pub async fn check_uptime(&self, site: &Site) -> Result<(), SiteError> {
        let started = Instant::now();
        let answer = {
            let _permits = self.limits.acquire(&site.url).await;
            self.probe.get(&site.url).send().await
        };
        let ms = started.elapsed().as_millis() as i64;
        let (up, status, error, cert) = match answer {
            Ok(r) => {
                let status = r.status().as_u16();
                let cert = r
                    .extensions()
                    .get::<reqwest::tls::TlsInfo>()
                    .and_then(|t| t.peer_certificate())
                    .and_then(not_after);
                let error = if status >= 500 {
                    format!("The home page answered {status}.")
                } else {
                    String::new()
                };
                (status < 500, status, error, cert)
            }
            Err(e) => (
                false,
                0,
                crate::net::NetError::from(e).message.to_string(),
                None,
            ),
        };
        self.db(|c| {
            c.execute(
                "INSERT INTO uptime (site_id, up, status, ms, error) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![site.id, up, status, ms, error],
            )?;
            c.execute(
                "DELETE FROM uptime WHERE site_id = ?1 AND at < unixepoch() - ?2",
                params![site.id, KEEP],
            )?;
            if cert.is_some() {
                c.execute(
                    "INSERT INTO monitors (site_id, cert_expires) VALUES (?1, ?2)
                     ON CONFLICT (site_id) DO UPDATE SET cert_expires = excluded.cert_expires",
                    params![site.id, cert],
                )?;
            }
            Ok(())
        })
    }

    /// When the site's domain expires, from its registry over RDAP.
    pub async fn check_domain(&self, site: &Site) -> Result<(), SiteError> {
        let (domain, expires, note) = match public_host(&site.url) {
            None => (None, None, LOCAL.to_string()),
            Some(host) => self.rdap(&host).await,
        };
        self.db(|c| {
            c.execute(
                "INSERT INTO monitors (site_id, domain, domain_expires, domain_note, domain_at)
                 VALUES (?1, ?2, ?3, ?4, unixepoch())
                 ON CONFLICT (site_id) DO UPDATE SET domain = excluded.domain,
                 domain_expires = excluded.domain_expires, domain_note = excluded.domain_note,
                 domain_at = excluded.domain_at",
                params![site.id, domain, expires, note],
            )
        })?;
        Ok(())
    }

    async fn rdap(&self, host: &str) -> (Option<String>, Option<i64>, String) {
        for name in candidates(host) {
            let url = format!("{}/domain/{name}", self.feeds.rdap);
            // The probe client: rdap.org redirects to each registry's own server.
            let Ok(r) = self.probe.get(&url).send().await else {
                return (
                    None,
                    None,
                    "The domain registry didn't answer. It's asked again tomorrow.".into(),
                );
            };
            if !r.status().is_success() {
                continue;
            }
            let Ok(v) = r.json::<Value>().await else {
                continue;
            };
            let expires = v["events"].as_array().and_then(|events| {
                events
                    .iter()
                    .find(|e| e["eventAction"] == "expiration")
                    .and_then(|e| e["eventDate"].as_str())
                    .and_then(rfc3339)
            });
            if expires.is_some() {
                return (Some(name), expires, String::new());
            }
        }
        (
            None,
            None,
            "The domain's registry doesn't share when it expires.".into(),
        )
    }

    /// Google PageSpeed for a phone. Takes up to a minute; no key needed, but
    /// Google limits how often it answers without one.
    pub async fn run_pagespeed(&self, id: i64) -> Result<PageSpeed, SiteError> {
        let site = self.site(id)?;
        if public_host(&site.url).is_none() {
            return Err(plain(
                "PageSpeed can only test sites on the public internet.",
            ));
        }
        let r = self
            .http
            .get(&self.feeds.pagespeed)
            .query(&[
                ("url", site.url.as_str()),
                ("strategy", "mobile"),
                ("category", "performance"),
            ])
            .timeout(Duration::from_secs(120))
            .send()
            .await
            .map_err(crate::net::NetError::from)?;
        let status = r.status().as_u16();
        let v: Value = r.json().await.unwrap_or_default();
        let ps = match (status, pagespeed_of(&v)) {
            (200, Some(ps)) => ps,
            (429, _) => {
                return Err(plain(
                    "Google's shared daily limit for PageSpeed tests without a key is used up. Try again tomorrow.",
                ));
            }
            _ => {
                let said = v["error"]["message"].as_str().unwrap_or("no reason given");
                return Err(plain(format!("PageSpeed couldn't test the site: {said}")));
            }
        };
        let json = serde_json::to_string(&ps).expect("plain data");
        self.db(|c| {
            c.execute(
                "INSERT INTO monitors (site_id, pagespeed, pagespeed_at) VALUES (?1, ?2, ?3)
                 ON CONFLICT (site_id) DO UPDATE SET pagespeed = excluded.pagespeed,
                 pagespeed_at = excluded.pagespeed_at",
                params![id, json, ps.at],
            )
        })?;
        let _ = self.changed.send(Changed::Monitors);
        Ok(ps)
    }

    /// Every site's monitors.
    pub fn monitors(&self) -> Result<Vec<Monitor>, SiteError> {
        let sites = self.sites()?;
        self.db(|c| {
            let mut out = Vec::with_capacity(sites.len());
            for s in &sites {
                let mut m = Monitor {
                    site_id: s.id,
                    public: public_host(&s.url).is_some(),
                    ..Default::default()
                };
                if let Some((at, up, status, ms, error)) = c
                    .query_row(
                        "SELECT at, up, status, ms, error FROM uptime WHERE site_id = ?1 ORDER BY at DESC, rowid DESC LIMIT 1",
                        [s.id],
                        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?)),
                    )
                    .optional()?
                {
                    (m.checked_at, m.up, m.status, m.ms, m.error) = (Some(at), Some(up), status, ms, error);
                }
                let share = |secs: i64| -> rusqlite::Result<Option<f64>> {
                    c.query_row(
                        "SELECT avg(up) * 100 FROM uptime WHERE site_id = ?1 AND at > unixepoch() - ?2",
                        params![s.id, secs],
                        |r| r.get(0),
                    )
                };
                m.uptime_day = share(24 * 3600)?;
                m.uptime_month = share(30 * 24 * 3600)?;
                m.day = vec![None; 24];
                let mut hours = c.prepare_cached(
                    "SELECT (unixepoch() - at) / 3600, CAST(avg(CASE WHEN up = 1 THEN ms END) AS INTEGER), min(up)
                     FROM uptime WHERE site_id = ?1 AND at > unixepoch() - 24 * 3600 GROUP BY 1",
                )?;
                for h in hours.query_map([s.id], |r| Ok((r.get::<_, i64>(0)?, r.get(1)?, r.get::<_, i64>(2)?)))? {
                    let (ago, ms, up) = h?;
                    if let Some(slot) = usize::try_from(23 - ago).ok().and_then(|i| m.day.get_mut(i)) {
                        *slot = Some(Hour { ms, up: up == 1 });
                    }
                }
                if m.up == Some(false) {
                    m.down_since = c.query_row(
                        "SELECT min(at) FROM uptime WHERE site_id = ?1 AND up = 0
                         AND rowid > coalesce((SELECT max(rowid) FROM uptime WHERE site_id = ?1 AND up = 1), 0)",
                        [s.id],
                        |r| r.get(0),
                    )?;
                }
                if let Some((cert, domain, expires, note, ps)) = c
                    .query_row(
                        "SELECT cert_expires, domain, domain_expires, domain_note, pagespeed FROM monitors WHERE site_id = ?1",
                        [s.id],
                        |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get::<_, String>(3)?, r.get::<_, Option<String>>(4)?)),
                    )
                    .optional()?
                {
                    (m.cert_expires, m.domain, m.domain_expires, m.domain_note) = (cert, domain, expires, note);
                    m.pagespeed = ps.and_then(|p| serde_json::from_str(&p).ok());
                }
                out.push(m);
            }
            Ok(out)
        })
    }

    /// Load every home page, and look up domains not looked up for a day
    /// (or every domain, when `all`). Then tell the window. A site Monks
    /// Central is changing right now is skipped: a safe update puts it in
    /// maintenance mode, which isn't downtime.
    pub async fn check_monitors(self: &Arc<Self>, all: bool) {
        let Ok(sites) = self.sites() else { return };
        let due: Vec<i64> = self
            .db(|c| {
                let mut stmt = c.prepare_cached(
                    "SELECT site_id FROM monitors WHERE domain_at > unixepoch() - ?1",
                )?;
                stmt.query_map([DOMAIN_EVERY], |r| r.get(0))?.collect()
            })
            .unwrap_or_default();
        let busy: Vec<i64> = self
            .db(|c| {
                let mut stmt =
                    c.prepare_cached("SELECT site_id FROM job_items WHERE state = 'running'")?;
                stmt.query_map([], |r| r.get(0))?.collect()
            })
            .unwrap_or_default();
        let mut set = tokio::task::JoinSet::new();
        for site in sites {
            let core = self.clone();
            let domain = all || !due.contains(&site.id);
            let uptime = !busy.contains(&site.id);
            set.spawn(async move {
                if uptime {
                    let _ = core.check_uptime(&site).await;
                }
                if domain {
                    let _ = core.check_domain(&site).await;
                }
            });
        }
        while set.join_next().await.is_some() {}
        let _ = self.changed.send(Changed::Monitors);
    }
}

/// The tray's line: "All 4 sites up", or "1 site down: Corner Bakery".
/// `sites` are (id, name).
pub fn tray_line(monitors: &[Monitor], sites: &[(i64, &str)]) -> String {
    let down: Vec<&str> = sites
        .iter()
        .filter(|s| {
            monitors
                .iter()
                .any(|m| m.site_id == s.0 && m.up == Some(false))
        })
        .map(|s| s.1)
        .collect();
    match (down.len(), sites.len()) {
        (_, 0) => "No sites yet".into(),
        (0, 1) => "Your site is up".into(),
        (0, n) => format!("All {n} sites up"),
        (1, _) => format!("1 site down: {}", down[0]),
        (n, _) => format!("{n} sites down: {}", down.join(", ")),
    }
}

/// Notices after a round of checks: sites that went down, and sites that came
/// back. `was_down` is updated to the sites down now.
pub fn news(
    was_down: &mut std::collections::HashSet<i64>,
    monitors: &[Monitor],
    sites: &[(i64, &str)],
) -> Vec<(String, String)> {
    let mut out = Vec::new();
    for &(id, name) in sites {
        let Some(m) = monitors.iter().find(|m| m.site_id == id) else {
            continue;
        };
        match m.up {
            Some(false) if was_down.insert(id) => {
                out.push((format!("{name} is down"), m.error.clone()));
            }
            Some(true) if was_down.remove(&id) => {
                out.push((
                    format!("{name} is back up"),
                    format!("It answered in {:.1} s.", m.ms as f64 / 1000.0),
                ));
            }
            _ => {}
        }
    }
    let known: Vec<i64> = sites.iter().map(|s| s.0).collect();
    was_down.retain(|id| known.contains(id));
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Options;
    use crate::security::Feeds;
    use crate::testsite::TestSite;
    use axum::extract::Path;
    use axum::response::IntoResponse;
    use serde_json::json;

    #[test]
    fn certificate_expiry_is_read_from_der() {
        let mut params = rcgen::CertificateParams::new(vec!["mc-a.local".into()]).unwrap();
        params.not_after = rcgen::date_time_ymd(2027, 3, 14);
        let key = rcgen::KeyPair::generate().unwrap();
        let cert = params.self_signed(&key).unwrap();
        assert_eq!(not_after(cert.der()), Some(1_804_982_400));
        params.not_after = rcgen::date_time_ymd(2051, 1, 2);
        let cert = params.self_signed(&key).unwrap();
        assert_eq!(
            not_after(cert.der()),
            Some(2_556_230_400),
            "GeneralizedTime after 2049"
        );
        assert_eq!(not_after(&[0x30, 0x05, 0x01]), None);
        assert_eq!(not_after(b""), None);
    }

    #[test]
    fn the_tray_says_what_is_down_and_notices_say_what_changed() {
        let sites = [(1, "MC A"), (2, "Corner Bakery")];
        let m = |id, up: Option<bool>| Monitor {
            site_id: id,
            up,
            ms: 412,
            error: "The site didn't answer.".into(),
            ..Default::default()
        };
        assert_eq!(tray_line(&[], &[]), "No sites yet");
        assert_eq!(
            tray_line(&[m(1, Some(true))], &sites[..1]),
            "Your site is up"
        );
        assert_eq!(
            tray_line(&[m(1, Some(true)), m(2, None)], &sites),
            "All 2 sites up"
        );
        assert_eq!(
            tray_line(&[m(1, Some(true)), m(2, Some(false))], &sites),
            "1 site down: Corner Bakery"
        );
        assert_eq!(
            tray_line(&[m(1, Some(false)), m(2, Some(false))], &sites),
            "2 sites down: MC A, Corner Bakery"
        );

        let mut down = std::collections::HashSet::new();
        assert!(news(&mut down, &[m(1, Some(true)), m(2, None)], &sites).is_empty());
        let n = news(&mut down, &[m(1, Some(true)), m(2, Some(false))], &sites);
        assert_eq!(
            n,
            [(
                "Corner Bakery is down".to_string(),
                "The site didn't answer.".to_string()
            )]
        );
        assert!(
            news(&mut down, &[m(2, Some(false))], &sites).is_empty(),
            "said once"
        );
        let n = news(&mut down, &[m(2, Some(true))], &sites);
        assert_eq!(
            n,
            [(
                "Corner Bakery is back up".to_string(),
                "It answered in 0.4 s.".to_string()
            )]
        );
        down.insert(9);
        news(&mut down, &[], &sites);
        assert!(down.is_empty(), "removed sites are forgotten");
    }

    #[test]
    fn dates_hosts_and_domains() {
        assert_eq!(rfc3339("2027-08-13T04:00:00Z"), Some(1_818_129_600));
        assert_eq!(rfc3339("1970-01-01T00:00:00Z"), Some(0));
        assert_eq!(public_host("https://mc-a.local/"), None);
        assert_eq!(public_host("http://127.0.0.1:8881"), None);
        assert_eq!(public_host("https://localhost"), None);
        assert_eq!(
            public_host("https://Shop.Example.co.uk/x").as_deref(),
            Some("shop.example.co.uk")
        );
        assert_eq!(
            candidates("shop.example.co.uk"),
            ["co.uk", "example.co.uk", "shop.example.co.uk"]
        );
        let ps = pagespeed_of(&json!({ "lighthouseResult": {
            "categories": { "performance": { "score": 0.874 } },
            "audits": { "largest-contentful-paint": { "displayValue": "2.4\u{a0}s" }, "cumulative-layout-shift": { "displayValue": "0.01" } } } }))
        .unwrap();
        assert_eq!(
            (ps.score, ps.lcp.as_str(), ps.cls.as_str(), ps.tbt.as_str()),
            (87, "2.4 s", "0.01", "not measured")
        );
        assert!(pagespeed_of(&json!({ "error": {} })).is_none());
    }

    async fn feeds() -> String {
        let app = axum::Router::new()
            .route(
                "/domain/{name}",
                axum::routing::get(|Path(name): Path<String>| async move {
                    match name.as_str() {
                        "example.com" => axum::Json(json!({ "events": [
                            { "eventAction": "registration", "eventDate": "1995-08-14T04:00:00Z" },
                            { "eventAction": "expiration", "eventDate": "2027-08-13T04:00:00Z" }] }))
                        .into_response(),
                        _ => axum::http::StatusCode::NOT_FOUND.into_response(),
                    }
                }),
            )
            .route(
                "/pagespeed",
                axum::routing::get(|q: axum::extract::Query<std::collections::HashMap<String, String>>| async move {
                    if q["url"].contains("busy") {
                        return (axum::http::StatusCode::TOO_MANY_REQUESTS, "{}").into_response();
                    }
                    axum::Json(json!({ "lighthouseResult": { "categories": { "performance": { "score": 0.5 } }, "audits": {} } })).into_response()
                }),
            );
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        url
    }

    #[tokio::test]
    async fn uptime_domains_and_pagespeed_are_recorded() {
        let feed = feeds().await;
        let home = tempfile::tempdir().unwrap();
        let opts = Options {
            keychain: Ok(keyring_core::mock::Store::new().unwrap()),
            feeds: Feeds {
                rdap: feed.clone(),
                pagespeed: format!("{feed}/pagespeed"),
                ..Default::default()
            },
            ..Default::default()
        };
        let core = Core::start(home.path(), opts).await.unwrap();
        let site = TestSite::start().await;
        let browser = |url: &str| {
            let url = url.to_string();
            tokio::spawn(async move { reqwest::get(url).await });
            Ok(())
        };
        let s = core.add_site_oauth(&site.url, browser).await.unwrap();
        let mut events = core.subscribe();
        core.check_monitors(false).await;
        assert!(matches!(events.recv().await, Ok(Changed::Monitors)));
        let m = core.monitors().unwrap().remove(0);
        assert_eq!((m.up, m.status, m.down_since), (Some(true), 200, None));
        assert_eq!((m.uptime_day, m.uptime_month), (Some(100.0), Some(100.0)));
        assert_eq!(m.cert_expires, None, "plain http has no certificate");
        assert_eq!(m.domain_note, LOCAL, "127.0.0.1 has no domain");
        assert!(!m.public);

        site.state().home_status = 503;
        core.check_monitors(false).await;
        core.check_monitors(false).await;
        let m = core.monitors().unwrap().remove(0);
        assert_eq!((m.up, m.status), (Some(false), 503));
        assert_eq!(m.error, "The home page answered 503.");
        assert!(m.down_since.is_some());
        assert!((m.uptime_day.unwrap() - 100.0 / 3.0).abs() < 0.01);
        // All three checks fall in this hour: the last slot, down at least once, timed by the one up check.
        assert_eq!(m.day.len(), 24);
        assert!(m.day[..23].iter().all(Option::is_none));
        let hour = m.day[23].unwrap();
        assert!(!hour.up);
        assert!(hour.ms.is_some());
        site.state().home_status = 200;
        core.check_uptime(&core.site(s.id).unwrap()).await.unwrap();
        assert_eq!(core.monitors().unwrap()[0].down_since, None, "up again");

        // While WP Sites HQ changes the site (a safe update's maintenance mode), its home page isn't checked.
        site.state().home_status = 503;
        core.db(|c| {
            c.execute("INSERT INTO jobs (title) VALUES ('update')", [])?;
            c.execute(
                "INSERT INTO job_items (job_id, site_id, site_name, action, label, state) VALUES (?1, ?2, 'x', '{\"do\":\"update_core\"}', 'Update WordPress', 'running')",
                params![c.last_insert_rowid(), s.id],
            )
        })
        .unwrap();
        core.check_monitors(false).await;
        let m = core.monitors().unwrap().remove(0);
        assert_eq!(
            (m.up, m.down_since),
            (Some(true), None),
            "not down while it updates"
        );
        core.db(|c| c.execute("UPDATE job_items SET state = 'done'", []))
            .unwrap();
        core.check_monitors(false).await;
        assert_eq!(
            core.monitors().unwrap()[0].up,
            Some(false),
            "checked again after"
        );
        site.state().home_status = 200;

        // A public domain: the registry knows example.com, not www.example.com's co-names.
        let public = Site {
            url: "https://www.example.com".into(),
            ..core.site(s.id).unwrap()
        };
        core.check_domain(&public).await.unwrap();
        let m = core.monitors().unwrap().remove(0);
        assert_eq!(
            (m.domain.as_deref(), m.domain_expires),
            (Some("example.com"), Some(1_818_129_600))
        );
        let unknown = Site {
            url: "https://shop.unknown-registry.xyz".into(),
            ..public
        };
        core.check_domain(&unknown).await.unwrap();
        assert_eq!(
            core.monitors().unwrap()[0].domain_note,
            "The domain's registry doesn't share when it expires."
        );

        let err = core.run_pagespeed(s.id).await.unwrap_err();
        assert_eq!(
            err.to_string(),
            "PageSpeed can only test sites on the public internet."
        );
        core.db(|c| c.execute("UPDATE sites SET url = 'https://shop.example.com'", []))
            .unwrap();
        assert_eq!(core.run_pagespeed(s.id).await.unwrap().score, 50);
        assert_eq!(
            core.monitors().unwrap()[0]
                .pagespeed
                .as_ref()
                .unwrap()
                .score,
            50
        );
        core.db(|c| c.execute("UPDATE sites SET url = 'https://busy.example.com'", []))
            .unwrap();
        assert!(
            core.run_pagespeed(s.id)
                .await
                .unwrap_err()
                .to_string()
                .starts_with("Google's shared daily limit")
        );
    }
}
