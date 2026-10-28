//! Monthly client reports: what was done on each site, uptime, speed,
//! security, what was published, the store, and search numbers when they're on.
//! One document model, written out as HTML and as a PDF (a small writer of our
//! own: Helvetica, WinAnsi text, A4 pages).

use std::fmt::Write as _;
use std::path::Path;
use std::sync::Arc;

use rusqlite::params;
use serde::{Deserialize, Serialize};

use crate::Core;
use crate::business::AppSettings;
use crate::connect::{SiteError, plain};
use crate::content::Query;
use crate::fleet::has_tool;
use crate::paths;
use crate::sites::{Mode, Site};

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[serde(default)]
pub struct ReportAsk {
    /// The client's sites, unless `site_ids` names some.
    pub client_id: Option<i64>,
    pub site_ids: Vec<i64>,
    /// "2026-10".
    pub month: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct Saved {
    pub html: String,
    pub pdf: String,
    /// The report itself, for the window to show.
    pub preview: String,
    pub sites: usize,
    /// What couldn't be read, by site.
    pub notes: Vec<String>,
}

/// The parts of a report, written out the same way as HTML and PDF.
#[derive(Debug, Clone, PartialEq)]
pub enum Block {
    Title(String),
    Sub(String),
    Site(String, String),
    Heading(String),
    Facts(Vec<(String, String)>),
    Item(String),
    Para(String),
}

const MONTHS: [&str; 12] = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
];

/// Days since 1970-01-01 (Howard Hinnant's days_from_civil).
fn days_from_civil(y: i64, m: i64, d: i64) -> i64 {
    let y = if m <= 2 { y - 1 } else { y };
    let era = y.div_euclid(400);
    let yoe = y - era * 400;
    let mp = (m + 9) % 12;
    let doy = (153 * mp + 2) / 5 + d - 1;
    let doe = yoe * 365 + yoe / 4 - yoe / 100 + doy;
    era * 146_097 + doe - 719_468
}

/// "2026-10" as its first and last day, and the unix seconds it spans (UTC).
pub fn month_range(month: &str) -> Option<(String, String, i64, i64, String)> {
    let (y, m) = month.split_once('-')?;
    let (y, m): (i64, i64) = (y.parse().ok()?, m.parse().ok()?);
    if !(2000..=2100).contains(&y) || !(1..=12).contains(&m) || month.len() != 7 {
        return None;
    }
    let start = days_from_civil(y, m, 1) * 86_400;
    let end = if m == 12 {
        days_from_civil(y + 1, 1, 1)
    } else {
        days_from_civil(y, m + 1, 1)
    } * 86_400;
    let name = format!("{} {y}", MONTHS[(m - 1) as usize]);
    Some((paths::day(start), paths::day(end - 1), start, end, name))
}

fn n(v: f64) -> String {
    let s = format!("{v:.0}");
    let (neg, digits) = s
        .strip_prefix('-')
        .map_or((false, s.as_str()), |d| (true, d));
    let mut out = String::new();
    for (i, c) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i) % 3 == 0 {
            out.push(',');
        }
        out.push(c);
    }
    if neg { format!("-{out}") } else { out }
}

impl Core {
    /// Write the report as HTML and PDF into `dir`.
    pub async fn client_report(
        self: &Arc<Self>,
        ask: &ReportAsk,
        dir: &Path,
    ) -> Result<Saved, SiteError> {
        let (from, to, start, end, month_name) =
            month_range(&ask.month).ok_or_else(|| plain("Pick a month."))?;
        let all = self.sites()?;
        let client = match ask.client_id {
            Some(c) => Some(
                self.clients()?
                    .into_iter()
                    .find(|x| x.id == c)
                    .ok_or_else(|| plain("That client is gone."))?,
            ),
            None => None,
        };
        let sites: Vec<Site> = if ask.site_ids.is_empty() {
            let c = client
                .as_ref()
                .ok_or_else(|| plain("Pick a client or some sites."))?;
            all.into_iter()
                .filter(|s| s.client_id == Some(c.id))
                .collect()
        } else {
            all.into_iter()
                .filter(|s| ask.site_ids.contains(&s.id))
                .collect()
        };
        if sites.is_empty() {
            return Err(plain(
                "No sites to report on. Give the client a site on Clients, or pick sites.",
            ));
        }
        let settings = self.app_settings()?;
        let mut set = tokio::task::JoinSet::new();
        for (i, site) in sites.iter().cloned().enumerate() {
            let core = self.clone();
            let (from, to) = (from.clone(), to.clone());
            set.spawn(async move {
                let _work = core.working().await;
                (i, core.site_blocks(&site, &from, &to, start, end).await)
            });
        }
        let mut parts: Vec<(usize, Vec<Block>, Vec<String>)> = vec![];
        while let Some(r) = set.join_next().await {
            let (i, (blocks, notes)) = r.map_err(|e| plain(e.to_string()))?;
            parts.push((i, blocks, notes));
        }
        parts.sort_by_key(|p| p.0);

        let who = client.as_ref().map(|c| c.name.clone());
        let title = match &who {
            Some(c) => format!("{c}: {month_name}"),
            None => format!("Website report: {month_name}"),
        };
        let mut doc = vec![
            Block::Title(title.clone()),
            Block::Sub(format!(
                "{from} to {to}. {} site{}.",
                sites.len(),
                if sites.len() == 1 { "" } else { "s" }
            )),
        ];
        let mut notes = vec![];
        for (_, blocks, site_notes) in parts {
            doc.extend(blocks);
            notes.extend(site_notes);
        }
        let html = html(&doc, &settings, &title);
        let pdf = pdf(&doc, &settings, &title);
        let stem: String = who
            .as_deref()
            .unwrap_or("websites")
            .chars()
            .map(|c| {
                if c.is_ascii_alphanumeric() {
                    c.to_ascii_lowercase()
                } else {
                    '-'
                }
            })
            .collect::<String>()
            .split('-')
            .filter(|w| !w.is_empty())
            .collect::<Vec<_>>()
            .join("-");
        let save = |ext: &str, bytes: &[u8]| {
            paths::save_new(dir, &format!("{stem}-report-{}.{ext}", ask.month), bytes)
                .map(|p| p.display().to_string())
                .map_err(|e| plain(format!("Couldn't save the report: {e}")))
        };
        Ok(Saved {
            html: save("html", html.as_bytes())?,
            pdf: save("pdf", &pdf)?,
            preview: html,
            sites: sites.len(),
            notes,
        })
    }

    /// One site's part of the report. Anything that can't be read becomes a note.
    async fn site_blocks(
        &self,
        site: &Site,
        from: &str,
        to: &str,
        start: i64,
        end: i64,
    ) -> (Vec<Block>, Vec<String>) {
        let mut b = vec![Block::Site(site.name.clone(), site.url.clone())];
        let mut notes = vec![];
        let mut note = |what: &str, e: &dyn std::fmt::Display| {
            notes.push(format!("{}: {what}: {e}", site.name))
        };

        let work: Vec<(i64, String)> = self
            .db(|c| {
                let mut st = c.prepare_cached(
                    "SELECT at, what FROM activity WHERE site_id = ?1 AND outcome = 'done' AND at >= ?2 AND at < ?3 ORDER BY at",
                )?;
                st.query_map(params![site.id, start, end], |r| Ok((r.get(0)?, r.get(1)?)))?.collect()
            })
            .unwrap_or_default();
        let (uptime, checks): (Option<f64>, i64) = self
            .db(|c| {
                c.query_row(
                    "SELECT avg(up) * 100, count(*) FROM uptime WHERE site_id = ?1 AND at >= ?2 AND at < ?3",
                    params![site.id, start, end],
                    |r| Ok((r.get(0)?, r.get(1)?)),
                )
            })
            .unwrap_or((None, 0));
        let monitor = self
            .monitors()
            .ok()
            .and_then(|m| m.into_iter().find(|m| m.site_id == site.id));
        let security = self
            .security_reports()
            .ok()
            .and_then(|r| r.into_iter().find(|r| r.site_id == site.id));

        let mut facts = vec![(
            "Uptime".to_string(),
            match uptime {
                Some(u) => format!("{u:.2}% ({checks} checks)"),
                None => "Not measured this month".into(),
            },
        )];
        if let Some(ps) = monitor.as_ref().and_then(|m| m.pagespeed.as_ref()) {
            facts.push((
                "Speed on a phone".into(),
                format!("{}/100, page shown in {}", ps.score, ps.lcp),
            ));
        }
        facts.push(("Changes made".into(), work.len().to_string()));
        facts.push((
            "WordPress".into(),
            [
                site.wp_version.as_deref().map(|v| format!("WordPress {v}")),
                site.php_version.as_deref().map(|v| format!("PHP {v}")),
            ]
            .into_iter()
            .flatten()
            .collect::<Vec<_>>()
            .join(", "),
        ));
        if let Some(r) = &security {
            let changed = r.checksums.as_ref().map_or(0, |c| c.changed.len());
            facts.push((
                "Security".into(),
                if r.vulnerabilities.is_empty() && r.abandoned.is_empty() && changed == 0 {
                    format!("No known problems, checked {}", paths::day(r.checked_at))
                } else {
                    format!(
                        "{} known vulnerabilit{}, {} abandoned plugin{}, {} changed file{}",
                        r.vulnerabilities.len(),
                        if r.vulnerabilities.len() == 1 {
                            "y"
                        } else {
                            "ies"
                        },
                        r.abandoned.len(),
                        if r.abandoned.len() == 1 { "" } else { "s" },
                        changed,
                        if changed == 1 { "" } else { "s" },
                    )
                },
            ));
        }
        if site.mode == Mode::ClassicMonks && has_tool(site, "get-login-security-report") {
            let days = ((end - start) / 86_400) as u32;
            match self.cm_reports_inner(site.id, days).await {
                Ok(r) => {
                    if let Some(l) = r.logins {
                        let attempts = l["period"]["attempts"].as_i64().unwrap_or_default();
                        let lockouts = l["period"]["lockouts"].as_i64().unwrap_or_default();
                        facts.push((
                            "Logins blocked".into(),
                            format!("{attempts} failed tries, {lockouts} lockouts"),
                        ));
                    }
                }
                Err(e) => note("logins", &e),
            }
        }
        b.push(Block::Facts(facts));

        if !work.is_empty() {
            b.push(Block::Heading("Work done".into()));
            for (at, what) in work.iter().take(40) {
                b.push(Block::Item(format!(
                    "{}: {}",
                    paths::day(*at),
                    plain_what(what)
                )));
            }
            if work.len() > 40 {
                b.push(Block::Para(format!("And {} more.", work.len() - 40)));
            }
        }

        // What went live this month: the newest posts, by the site's own dates.
        let q = Query {
            post_type: "post".into(),
            status: Some("publish".into()),
            search: None,
            page: Some(1),
        };
        match self.posts_inner(site.id, &q).await {
            Ok(list) => {
                let posted: Vec<_> = list
                    .posts
                    .iter()
                    .filter(|p| p.date.get(..10).is_some_and(|d| d >= from && d <= to))
                    .collect();
                if !posted.is_empty() {
                    b.push(Block::Heading(format!("Published ({})", posted.len())));
                    for p in posted {
                        b.push(Block::Item(format!(
                            "{}: {}",
                            &p.date[..10],
                            if p.title.is_empty() {
                                "(no title)"
                            } else {
                                &p.title
                            }
                        )));
                    }
                }
            }
            Err(e) => note("posts", &e),
        }

        if site.mode == Mode::ClassicMonks && has_tool(site, "get-store-overview") {
            match self
                .store_overview_inner(site.id, 30, Some((from, to)))
                .await
            {
                Ok(o) => {
                    let money = |v: &str| format!("{} {v}", o.currency);
                    b.push(Block::Heading("Store".into()));
                    b.push(Block::Facts(vec![
                        ("Revenue".into(), money(&o.revenue)),
                        ("Paid orders".into(), o.orders.to_string()),
                        ("Average order".into(), money(&o.average_order)),
                        ("Out of stock now".into(), o.out_of_stock.to_string()),
                    ]));
                }
                Err(e) => note("store", &e),
            }
        }

        let settings = self.app_settings().unwrap_or_default();
        if settings.search_console {
            match self.search_stats(site.id, from, to).await {
                Ok(s) => {
                    b.push(Block::Heading("Google search".into()));
                    b.push(Block::Facts(vec![
                        ("Clicks".into(), n(s.clicks)),
                        ("Times shown".into(), n(s.impressions)),
                        ("Click rate".into(), format!("{:.1}%", s.ctr * 100.0)),
                        ("Average position".into(), format!("{:.1}", s.position)),
                    ]));
                    for q in s.top_queries.iter().take(5) {
                        b.push(Block::Item(format!(
                            "\u{201c}{}\u{201d}: {} clicks, position {:.1}",
                            q.query,
                            n(q.clicks),
                            q.position
                        )));
                    }
                }
                Err(e) => note("Search Console", &e),
            }
        }
        if settings.agentedseo {
            match self
                .agentedseo_inner(site.id, ((end - start) / 86_400) as u32)
                .await
            {
                Ok(Some(s)) => {
                    b.push(Block::Heading("SEO".into()));
                    let mut f = vec![];
                    if let Some(c) = s.clicks {
                        f.push(("Clicks".into(), n(c)));
                    }
                    if let Some(i) = s.impressions {
                        f.push(("Times shown".into(), n(i)));
                    }
                    let open: i64 = s.issues.values().sum();
                    f.push(("Open SEO issues".into(), open.to_string()));
                    b.push(Block::Facts(f));
                    for (url, clicks) in &s.top_pages {
                        b.push(Block::Item(format!("{url}: {} clicks", n(*clicks))));
                    }
                }
                Ok(None) => {}
                Err(e) => note("AgentedSEO", &e),
            }
        }
        (b, notes)
    }
}

/// An agent's call is logged by its tool name: "update-post" reads "Update post".
fn plain_what(what: &str) -> String {
    if what.contains(' ') || !what.contains('-') {
        return what.to_string();
    }
    let s = what.rsplit('/').next().unwrap_or(what).replace('-', " ");
    let mut c = s.chars();
    c.next()
        .map_or_else(String::new, |f| f.to_uppercase().chain(c).collect())
}

fn esc(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn accent(s: &AppSettings) -> &str {
    if s.report_accent.is_empty() {
        "#111111"
    } else {
        &s.report_accent
    }
}

fn credit(s: &AppSettings) -> Vec<String> {
    let mut f = vec![];
    if !s.report_footer.trim().is_empty() {
        f.push(s.report_footer.trim().to_string());
    }
    if !s.white_label {
        f.push("Made with Monks Central".into());
    }
    f
}

pub fn html(doc: &[Block], s: &AppSettings, title: &str) -> String {
    let mut h = String::new();
    let a = esc(accent(s));
    let _ = write!(
        h,
        "<!doctype html>\n<html lang=\"en\"><head><meta charset=\"utf-8\"><meta name=\"viewport\" content=\"width=device-width\"><title>{}</title><style>\
body{{font:15px/1.5 system-ui,-apple-system,Segoe UI,Helvetica,Arial,sans-serif;color:#1b1b1b;max-width:760px;margin:40px auto;padding:0 24px}}\
.brand{{color:{a};font-weight:600;letter-spacing:.02em;margin:0}}h1{{font-size:28px;margin:4px 0}}.sub{{color:#555;margin:0 0 24px}}\
h2{{color:{a};font-size:20px;margin:36px 0 0;padding-top:20px;border-top:2px solid {a}}}.url{{color:#555;margin:0 0 12px}}\
h3{{font-size:15px;margin:20px 0 6px}}dl{{display:grid;grid-template-columns:200px 1fr;gap:4px 16px;margin:0}}dt{{color:#555}}dd{{margin:0}}\
ul{{margin:0;padding-left:20px}}footer{{margin-top:48px;color:#555;font-size:13px;border-top:1px solid #ddd;padding-top:12px}}\
@media print{{body{{margin:0}}h2{{break-before:auto}}}}</style></head><body>\n",
        esc(title)
    );
    if !s.report_name.trim().is_empty() {
        let _ = writeln!(h, "<p class=\"brand\">{}</p>", esc(s.report_name.trim()));
    }
    let mut in_list = false;
    for block in doc {
        let item = matches!(block, Block::Item(_));
        if in_list && !item {
            h.push_str("</ul>\n");
        }
        if item && !in_list {
            h.push_str("<ul>\n");
        }
        in_list = item;
        match block {
            Block::Title(t) => _ = writeln!(h, "<h1>{}</h1>", esc(t)),
            Block::Sub(t) => _ = writeln!(h, "<p class=\"sub\">{}</p>", esc(t)),
            Block::Site(name, url) => {
                _ = writeln!(h, "<h2>{}</h2><p class=\"url\">{}</p>", esc(name), esc(url))
            }
            Block::Heading(t) => _ = writeln!(h, "<h3>{}</h3>", esc(t)),
            Block::Facts(f) => {
                h.push_str("<dl>");
                for (k, v) in f {
                    let _ = write!(h, "<dt>{}</dt><dd>{}</dd>", esc(k), esc(v));
                }
                h.push_str("</dl>\n");
            }
            Block::Item(t) => _ = writeln!(h, "<li>{}</li>", esc(t)),
            Block::Para(t) => _ = writeln!(h, "<p>{}</p>", esc(t)),
        }
    }
    if in_list {
        h.push_str("</ul>\n");
    }
    let foot = credit(s);
    if !foot.is_empty() {
        let _ = writeln!(
            h,
            "<footer>{}</footer>",
            foot.iter().map(|f| esc(f)).collect::<Vec<_>>().join(". ")
        );
    }
    h.push_str("</body></html>\n");
    h
}

// ---- PDF ----

const W: f32 = 595.0;
const H: f32 = 842.0;
const MARGIN: f32 = 56.0;
const BOTTOM: f32 = 72.0;

/// Helvetica's advance widths, per 1000 units, near enough to wrap lines.
fn glyph(c: char) -> f32 {
    match c {
        ' ' | 'i' | 'j' | 'l' | '.' | ',' | ':' | ';' | '\'' | '!' | '|' | 'I' => 278.0,
        'f' | 't' | 'r' | '(' | ')' | '-' | '/' => 333.0,
        'm' | 'M' => 833.0,
        'w' | 'W' => 778.0,
        '@' | '%' => 889.0,
        'A'..='Z' => 690.0,
        _ => 556.0,
    }
}

fn width(s: &str, size: f32, bold: bool) -> f32 {
    s.chars().map(glyph).sum::<f32>() * size / 1000.0 * if bold { 1.06 } else { 1.0 }
}

fn wrap(text: &str, size: f32, bold: bool, max: f32) -> Vec<String> {
    let mut lines = vec![];
    let mut line = String::new();
    for word in text.split(' ') {
        let next = if line.is_empty() {
            word.to_string()
        } else {
            format!("{line} {word}")
        };
        if width(&next, size, bold) > max && !line.is_empty() {
            lines.push(std::mem::take(&mut line));
            line = word.to_string();
        } else {
            line = next;
        }
        // A word wider than the line is cut.
        while width(&line, size, bold) > max && line.chars().count() > 1 {
            let mut cut = line.chars().count() - 1;
            while cut > 1 && width(&line.chars().take(cut).collect::<String>(), size, bold) > max {
                cut -= 1;
            }
            let head: String = line.chars().take(cut).collect();
            let tail: String = line.chars().skip(cut).collect();
            lines.push(head);
            line = tail;
        }
    }
    lines.push(line);
    lines
}

/// A PDF string in WinAnsi: ASCII as is, the rest as octal escapes, "?" when WinAnsi hasn't it.
fn pdf_text(s: &str) -> String {
    let mut out = String::new();
    for c in s.chars() {
        let b: u8 = match c {
            '(' | ')' | '\\' => {
                out.push('\\');
                c as u8
            }
            ' '..='~' => c as u8,
            '\u{20ac}' => 0x80,
            '\u{2026}' => 0x85,
            '\u{2018}' => 0x91,
            '\u{2019}' => 0x92,
            '\u{201c}' => 0x93,
            '\u{201d}' => 0x94,
            '\u{2022}' => 0x95,
            '\u{2013}' => 0x96,
            '\u{2014}' => 0x97,
            '\u{a0}'..='\u{ff}' => c as u32 as u8,
            _ => b'?',
        };
        if b < 0x80 {
            out.push(b as char);
        } else {
            let _ = write!(out, "\\{b:03o}");
        }
    }
    out
}

fn rgb(hex: &str) -> (f32, f32, f32) {
    let p = |i: usize| {
        u8::from_str_radix(hex.get(i..i + 2).unwrap_or("11"), 16).unwrap_or(17) as f32 / 255.0
    };
    (p(1), p(3), p(5))
}

struct Line {
    x: f32,
    size: f32,
    bold: bool,
    color: (f32, f32, f32),
    text: String,
    /// Space above it.
    gap: f32,
    /// A rule above it, across the page.
    rule: bool,
    /// The block it's part of; a block (with what it heads) isn't split across pages.
    block: usize,
    heads: bool,
}

pub fn pdf(doc: &[Block], s: &AppSettings, title: &str) -> Vec<u8> {
    let acc = rgb(accent(s));
    let ink = (0.11, 0.11, 0.11);
    let grey = (0.33, 0.33, 0.33);
    let max = W - 2.0 * MARGIN;
    let mut lines: Vec<Line> = vec![];
    let mut block = 0;
    let mut add =
        |block: usize, text: &str, x: f32, size: f32, bold: bool, color, gap: f32, rule: bool| {
            for (i, t) in wrap(text, size, bold, max - (x - MARGIN))
                .into_iter()
                .enumerate()
            {
                lines.push(Line {
                    x,
                    size,
                    bold,
                    color,
                    text: t,
                    gap: if i == 0 { gap } else { 0.0 },
                    rule: rule && i == 0,
                    block,
                    heads: bold && size > 10.0,
                });
            }
        };
    if !s.report_name.trim().is_empty() {
        add(0, s.report_name.trim(), MARGIN, 10.0, true, acc, 0.0, false);
    }
    for b in doc {
        block += 1;
        match b {
            Block::Title(t) => add(block, t, MARGIN, 20.0, true, ink, 4.0, false),
            Block::Sub(t) => add(block, t, MARGIN, 10.0, false, grey, 2.0, false),
            Block::Site(name, url) => {
                add(block, name, MARGIN, 15.0, true, acc, 26.0, true);
                add(block, url, MARGIN, 9.0, false, grey, 2.0, false);
            }
            Block::Heading(t) => add(block, t, MARGIN, 11.0, true, ink, 12.0, false),
            Block::Facts(f) => {
                for (i, (k, v)) in f.iter().enumerate() {
                    add(
                        block,
                        &format!("{k}:  {v}"),
                        MARGIN,
                        10.0,
                        false,
                        ink,
                        if i == 0 { 8.0 } else { 1.0 },
                        false,
                    );
                }
            }
            Block::Item(t) => add(
                block,
                &format!("\u{2022} {t}"),
                MARGIN + 8.0,
                10.0,
                false,
                ink,
                1.0,
                false,
            ),
            Block::Para(t) => add(block, t, MARGIN, 10.0, false, ink, 4.0, false),
        }
    }

    // Lay the lines out on pages.
    let mut pages: Vec<String> = vec![];
    let mut page = String::new();
    let mut y = H - MARGIN;
    let need = |l: &Line| l.gap + l.size * 1.3;
    for (i, l) in lines.iter().enumerate() {
        // At a block's first line: keep the block, and the block a heading heads, together.
        let first = i == 0 || lines[i - 1].block != l.block;
        let together: f32 = if first {
            let mut end = i;
            while end < lines.len() && lines[end].block == l.block {
                end += 1;
            }
            if l.heads && end < lines.len() {
                let next = lines[end].block;
                while end < lines.len() && lines[end].block == next && end - i < 12 {
                    end += 1;
                }
            }
            lines[i..end].iter().map(need).sum()
        } else {
            need(l)
        };
        let keep = if together < (H - MARGIN - BOTTOM) / 2.0 {
            together
        } else {
            need(l)
        };
        if y - keep < BOTTOM && !page.is_empty() {
            pages.push(std::mem::take(&mut page));
            y = H - MARGIN;
        }
        y -= if page.is_empty() {
            l.size * 1.3
        } else {
            need(l)
        };
        if l.rule {
            let _ = writeln!(
                page,
                "{} {} {} RG 1.5 w {MARGIN} {:.1} m {:.1} {:.1} l S",
                l.color.0,
                l.color.1,
                l.color.2,
                y + l.size * 1.3,
                W - MARGIN,
                y + l.size * 1.3
            );
        }
        let _ = writeln!(
            page,
            "BT /{} {} Tf {:.3} {:.3} {:.3} rg {:.1} {:.1} Td ({}) Tj ET",
            if l.bold { "F2" } else { "F1" },
            l.size,
            l.color.0,
            l.color.1,
            l.color.2,
            l.x,
            y,
            pdf_text(&l.text)
        );
    }
    pages.push(page);

    let foot = credit(s).join(". ");
    let total = pages.len();
    let mut objects: Vec<String> = vec![
        "<< /Type /Catalog /Pages 2 0 R >>".into(),
        String::new(), // Pages, filled in below.
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>".into(),
        "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>"
            .into(),
        format!("<< /Title ({}) >>", pdf_text(title)),
    ];
    let mut kids = vec![];
    for (i, body) in pages.iter().enumerate() {
        let mut body = body.clone();
        let num = format!("Page {} of {total}", i + 1);
        let _ = writeln!(
            body,
            "BT /F1 8 Tf 0.4 0.4 0.4 rg {MARGIN} 36 Td ({}) Tj ET",
            pdf_text(&foot)
        );
        let _ = writeln!(
            body,
            "BT /F1 8 Tf 0.4 0.4 0.4 rg {:.1} 36 Td ({num}) Tj ET",
            W - MARGIN - width(&num, 8.0, false)
        );
        objects.push(format!(
            "<< /Length {} >>\nstream\n{body}endstream",
            body.len()
        ));
        let content = objects.len();
        objects.push(format!(
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {W} {H}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents {content} 0 R >>"
        ));
        kids.push(format!("{} 0 R", objects.len()));
    }
    objects[1] = format!(
        "<< /Type /Pages /Kids [{}] /Count {total} >>",
        kids.join(" ")
    );

    let mut out = b"%PDF-1.4\n%\xe2\xe3\xcf\xd3\n".to_vec();
    let mut offsets = vec![];
    for (i, o) in objects.iter().enumerate() {
        offsets.push(out.len());
        out.extend_from_slice(format!("{} 0 obj\n{o}\nendobj\n", i + 1).as_bytes());
    }
    let xref = out.len();
    let mut tail = format!("xref\n0 {}\n0000000000 65535 f \n", objects.len() + 1);
    for o in offsets {
        let _ = writeln!(tail, "{o:010} 00000 n ");
    }
    let _ = write!(
        tail,
        "trailer\n<< /Size {} /Root 1 0 R /Info 5 0 R >>\nstartxref\n{xref}\n%%EOF\n",
        objects.len() + 1
    );
    out.extend_from_slice(tail.as_bytes());
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Options;
    use crate::business::Client;
    use crate::testsite::TestSite;
    use serde_json::json;

    #[test]
    fn months_are_whole_utc_months() {
        let (from, to, start, end, name) = month_range("2026-10").unwrap();
        assert_eq!(
            (from.as_str(), to.as_str(), name.as_str()),
            ("2026-10-01", "2026-10-31", "October 2026")
        );
        assert_eq!(end - start, 31 * 86_400);
        assert_eq!(month_range("2028-02").unwrap().1, "2028-02-29");
        assert_eq!(month_range("2026-12").unwrap().1, "2026-12-31");
        for bad in ["2026-13", "2026-1", "26-10", "", "1999-01"] {
            assert!(month_range(bad).is_none(), "{bad}");
        }
        assert_eq!(
            (n(1234567.0), n(12.0), n(-1500.0)),
            ("1,234,567".into(), "12".into(), "-1,500".into())
        );
    }

    #[test]
    fn the_pdf_is_well_formed_and_paginates() {
        let s = AppSettings {
            report_name: "Studio North".into(),
            report_footer: "hello@north.test".into(),
            report_accent: "#1f6feb".into(),
            ..Default::default()
        };
        let mut doc = vec![
            Block::Title("Corner Bakery: October 2026".into()),
            Block::Site("Shop (main)".into(), "https://shop.test".into()),
        ];
        for i in 0..120 {
            doc.push(Block::Item(format!(
                "Update \u{201c}WooCommerce\u{201d} to 10.{i}, \u{20ac}5 \\ caf\u{e9} \u{4e2d}"
            )));
        }
        let full = pdf(&doc, &s, "Corner Bakery");
        // Past the binary comment on line 2, the file is plain ASCII.
        assert!(full[15..].is_ascii());
        let text = String::from_utf8_lossy(&full);
        assert!(text.contains("(Shop \\(main\\)) Tj"));
        assert!(
            text.contains("\\223WooCommerce\\224"),
            "curly quotes as WinAnsi"
        );
        assert!(text.contains("\\200") && text.contains("caf\\351") && text.contains("\\\\"));
        assert!(text.contains("Made with Monks Central"));
        assert!(text.contains("0.122 0.435 0.922 rg"), "the accent colour");
        let pages = check_pdf_offsets(&full);
        assert!(pages >= 3, "{pages} pages");
        assert!(String::from_utf8_lossy(&full).contains(&format!("Page {pages} of {pages}")));
        let quiet = pdf(
            &doc,
            &AppSettings {
                white_label: true,
                ..s
            },
            "x",
        );
        assert!(!String::from_utf8_lossy(&quiet).contains("Monks Central"));
    }

    #[test]
    fn a_short_block_and_its_heading_stay_on_one_page() {
        for filler in 30..70 {
            let mut doc: Vec<Block> = (0..filler)
                .map(|i| Block::Item(format!("Line {i}")))
                .collect();
            doc.push(Block::Site("Second site".into(), "https://b.test".into()));
            doc.push(Block::Facts(
                (1..=6).map(|i| (format!("Fact {i}"), "x".into())).collect(),
            ));
            let out = String::from_utf8_lossy(&pdf(&doc, &AppSettings::default(), "t")).to_string();
            let streams: Vec<&str> = out.split("stream\n").collect();
            let with = |t: &str| streams.iter().position(|s| s.contains(t)).unwrap();
            assert_eq!(
                with("(Second site)"),
                with("(Fact 6:"),
                "{filler} lines before"
            );
        }
    }

    fn check_pdf_offsets(pdf: &[u8]) -> usize {
        let start = pdf.windows(10).rposition(|w| w == b"startxref\n").unwrap() + 10;
        let xref: usize = std::str::from_utf8(&pdf[start..])
            .unwrap()
            .lines()
            .next()
            .unwrap()
            .parse()
            .unwrap();
        assert!(pdf[xref..].starts_with(b"xref\n"));
        let table = std::str::from_utf8(&pdf[xref..]).unwrap();
        for (i, line) in table
            .lines()
            .skip(3)
            .take_while(|l| l.ends_with(" n "))
            .enumerate()
        {
            let at: usize = line[..10].parse().unwrap();
            assert!(
                pdf[at..].starts_with(format!("{} 0 obj", i + 1).as_bytes()),
                "object {}",
                i + 1
            );
        }
        assert!(pdf.ends_with(b"%%EOF\n"));
        let text = String::from_utf8_lossy(pdf);
        text.split("/Count ")
            .nth(1)
            .unwrap()
            .split(' ')
            .next()
            .unwrap()
            .parse()
            .unwrap()
    }

    #[test]
    fn html_is_escaped_and_white_label_hides_the_credit() {
        let doc = [
            Block::Title("<b>Bakery</b>".into()),
            Block::Item("one".into()),
            Block::Item("two & three".into()),
            Block::Para("done".into()),
        ];
        let s = AppSettings {
            report_accent: "#aa0000".into(),
            ..Default::default()
        };
        let h = html(&doc, &s, "T");
        assert!(h.contains("<h1>&lt;b&gt;Bakery&lt;/b&gt;</h1>"));
        assert!(h.contains("<ul>\n<li>one</li>\n<li>two &amp; three</li>\n</ul>\n<p>done</p>"));
        assert!(h.contains("color:#aa0000") && h.contains("Made with Monks Central"));
        assert!(
            !html(
                &doc,
                &AppSettings {
                    white_label: true,
                    ..s
                },
                "T"
            )
            .contains("Monks Central")
        );
    }

    fn browser(url: &str) -> std::io::Result<()> {
        let url = url.to_string();
        tokio::spawn(async move { reqwest::get(url).await });
        Ok(())
    }

    #[tokio::test]
    async fn a_monthly_report_covers_a_clients_two_sites() {
        let home = tempfile::tempdir().unwrap();
        let opts = Options {
            keychain: Ok(keyring_core::mock::Store::new().unwrap()),
            ..Default::default()
        };
        let core = Core::start(home.path(), opts).await.unwrap();
        let (a, b) = (TestSite::start().await, TestSite::start().await);
        let sa = core.add_site_oauth(&a.url, browser).await.unwrap();
        let sb = core
            .add_site_basic(&b.url, "admin", "abcd efgh ijkl mnop qrst uvwx")
            .await
            .unwrap();
        a.state().posts.push(json!({ "id": 5, "type": "post", "title": "Autumn menu", "status": "publish", "date": "2026-10-03 09:00:00", "content": "" }));
        a.state().posts.push(json!({ "id": 6, "type": "post", "title": "Old news", "status": "publish", "date": "2026-08-03 09:00:00", "content": "" }));
        let c = core
            .save_client(&Client {
                id: 0,
                name: "Corner Bakery".into(),
                email: String::new(),
                notes: String::new(),
            })
            .unwrap();
        core.set_site_client(sa.id, Some(c.id)).unwrap();
        core.set_site_client(sb.id, Some(c.id)).unwrap();
        let (_, _, start, _, _) = month_range("2026-10").unwrap();
        core.db(|db| {
            db.execute("INSERT INTO activity (at, actor, site_id, site_name, what, outcome) VALUES (?1, 'human', ?2, 'A', 'Update WooCommerce', 'done')", params![start + 3600, sa.id])?;
            db.execute("INSERT INTO activity (at, actor, site_id, site_name, what, outcome) VALUES (?1, 'human', ?2, 'A', 'Too early', 'done')", params![start - 3600, sa.id])?;
            db.execute("INSERT INTO uptime (site_id, at, up, status, ms, error) VALUES (?1, ?2, 1, 200, 300, ''), (?1, ?2 + 60, 0, 500, 300, 'down')", params![sa.id, start + 100])
        })
        .unwrap();

        let out = tempfile::tempdir().unwrap();
        let ask = ReportAsk {
            client_id: Some(c.id),
            site_ids: vec![],
            month: "2026-10".into(),
        };
        let r = core.client_report(&ask, out.path()).await.unwrap();
        assert_eq!(r.sites, 2);
        assert!(
            r.html.ends_with("corner-bakery-report-2026-10.html"),
            "{}",
            r.html
        );
        assert!(r.pdf.ends_with("corner-bakery-report-2026-10.pdf"));
        let h = &r.preview;
        assert!(h.contains("Corner Bakery: October 2026"));
        assert!(h.contains("2026-10-01: Update WooCommerce") && !h.contains("Too early"));
        assert!(h.contains("50.00% (2 checks)"));
        assert!(h.contains("Autumn menu") && !h.contains("Old news"));
        assert!(h.contains("<h3>Store</h3>") && h.contains("EUR 120.00"));
        assert!(h.contains("25 failed tries, 2 lockouts"));
        // Basic mode: no store, no login report, and nothing about Search Console when it's off.
        assert_eq!(h.matches("<h3>Store</h3>").count(), 1);
        assert!(!h.contains("Google search"));
        assert!(r.notes.is_empty(), "{:?}", r.notes);
        check_pdf_offsets(&std::fs::read(&r.pdf).unwrap());
        // A second run never overwrites the first.
        let again = core.client_report(&ask, out.path()).await.unwrap();
        assert!(
            again
                .html
                .ends_with("corner-bakery-report-2026-10 (2).html")
        );

        assert!(
            core.client_report(
                &ReportAsk {
                    month: "2026-10".into(),
                    ..Default::default()
                },
                out.path()
            )
            .await
            .is_err()
        );
        assert!(
            core.client_report(
                &ReportAsk {
                    month: "Oct".into(),
                    site_ids: vec![sa.id],
                    ..Default::default()
                },
                out.path()
            )
            .await
            .is_err()
        );
    }
}
