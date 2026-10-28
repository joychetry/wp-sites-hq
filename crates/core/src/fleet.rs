//! Plugins, themes and updates across sites (plan Phase 2): what each site runs
//! (a cached inventory), the changes Monks Central can make, and jobs that make
//! them on many sites with progress per site.
//!
//! Every change runs as a job the human confirmed in the app window. An AI
//! agent may propose a job (a plan); it runs only after a person confirms it
//! there, and the socket has no way to confirm (plan 5.6).

use std::collections::BTreeMap;
use std::sync::Arc;

use rusqlite::{Connection, OptionalExtension, params};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::activity::{Actor, Outcome};
use crate::connect::{AppPassword, SiteError, plain, rest_url};
use crate::net::{self, Retry};
use crate::sites::{Mode, Site};
use crate::{Changed, Core};

/// One plugin or theme on one site.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Item {
    /// Plugin file (`folder/main.php`) or theme folder (stylesheet).
    pub id: String,
    pub name: String,
    pub version: String,
    pub active: bool,
    /// `None` when the site doesn't say (Basic mode, older Classic Monks).
    pub auto_update: Option<bool>,
    /// The newer version waiting, if any.
    pub update: Option<String>,
}

/// What a site runs, as last read.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Inventory {
    pub wordpress: Option<String>,
    pub wordpress_update: Option<String>,
    pub plugins: Vec<Item>,
    pub themes: Vec<Item>,
    /// Translation updates waiting.
    pub translations: usize,
    /// Basic mode can't see updates.
    pub updates_known: bool,
    /// Installs and updates need FTP details nobody stored (plan M4).
    pub needs_credentials: bool,
}

#[derive(Debug, Clone, Serialize)]
pub struct SiteInventory {
    pub site_id: i64,
    pub fetched_at: i64,
    pub inventory: Inventory,
}

/// A change to one site. Plugins by file, themes by folder.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "do", rename_all = "snake_case")]
pub enum Action {
    UpdatePlugin {
        plugin: String,
    },
    RollbackPlugin {
        plugin: String,
        version: String,
    },
    ActivatePlugin {
        plugin: String,
    },
    DeactivatePlugin {
        plugin: String,
    },
    DeletePlugin {
        plugin: String,
    },
    AutoUpdatePlugin {
        plugin: String,
        on: bool,
    },
    /// A WordPress.org slug, or a link to a zip (Classic Monks Pro).
    InstallPlugin {
        source: String,
        activate: bool,
    },
    UpdateTheme {
        theme: String,
    },
    ActivateTheme {
        theme: String,
    },
    DeleteTheme {
        theme: String,
    },
    UpdateCore,
    UpdateTranslations,
}

impl Action {
    /// The Classic Monks tool and its arguments.
    fn classic_monks(&self) -> (&'static str, Value) {
        use Action::*;
        match self {
            UpdatePlugin { plugin } => ("update-plugin", json!({ "plugin_file": plugin })),
            RollbackPlugin { plugin, version } => (
                "rollback-plugin",
                json!({ "plugin": plugin, "version": version, "note": "Rolled back from Monks Central." }),
            ),
            ActivatePlugin { plugin } => ("activate-plugin", json!({ "plugin_file": plugin })),
            DeactivatePlugin { plugin } => ("deactivate-plugin", json!({ "plugin_file": plugin })),
            DeletePlugin { plugin } => ("uninstall-plugin", json!({ "plugin_file": plugin })),
            AutoUpdatePlugin { plugin, on } => (
                "set-plugin-auto-update",
                json!({ "plugin_file": plugin, "enabled": on }),
            ),
            InstallPlugin { source, activate } if is_link(source) => (
                "install-plugin",
                json!({ "source_url": source, "activate": activate }),
            ),
            InstallPlugin { source, activate } => (
                "install-plugin",
                json!({ "slug": source, "activate": activate }),
            ),
            UpdateTheme { theme } => ("update-theme", json!({ "stylesheet": theme })),
            ActivateTheme { theme } => ("activate-theme", json!({ "stylesheet": theme })),
            DeleteTheme { theme } => ("delete-theme", json!({ "stylesheet": theme })),
            UpdateCore => ("update-core", json!({})),
            UpdateTranslations => ("update-translations", json!({})),
        }
    }

    /// Writes files on the site, so it can't run where WordPress needs FTP details.
    fn writes_files(&self) -> bool {
        use Action::*;
        !matches!(
            self,
            ActivatePlugin { .. }
                | DeactivatePlugin { .. }
                | AutoUpdatePlugin { .. }
                | ActivateTheme { .. }
        )
    }

    /// Name the plugin or theme by its file or folder, as the site does, when it
    /// was given by folder or name. Errs with what the site doesn't have.
    fn resolve(&mut self, inv: &Inventory) -> Result<(), String> {
        use Action::*;
        let find = |items: &[Item], wanted: &str| {
            items
                .iter()
                .find(|i| {
                    i.id == wanted
                        || i.id.split('/').next() == Some(wanted)
                        || i.name.eq_ignore_ascii_case(wanted)
                })
                .map(|i| i.id.clone())
        };
        match self {
            UpdatePlugin { plugin }
            | RollbackPlugin { plugin, .. }
            | ActivatePlugin { plugin }
            | DeactivatePlugin { plugin }
            | DeletePlugin { plugin }
            | AutoUpdatePlugin { plugin, .. } => {
                *plugin = find(&inv.plugins, plugin).ok_or(format!("plugin {plugin}"))?;
            }
            UpdateTheme { theme } | ActivateTheme { theme } | DeleteTheme { theme } => {
                *theme = find(&inv.themes, theme).ok_or(format!("theme {theme}"))?;
            }
            InstallPlugin { .. } | UpdateCore | UpdateTranslations => {}
        }
        Ok(())
    }

    /// What the job list says, and the versions it goes between.
    fn describe(&self, inv: &Inventory) -> (String, Option<String>, Option<String>) {
        use Action::*;
        let plugin = |id: &str| inv.plugins.iter().find(|p| p.id == id);
        let theme = |id: &str| inv.themes.iter().find(|t| t.id == id);
        let name =
            |item: Option<&Item>, id: &str| item.map_or_else(|| id.to_string(), |i| i.name.clone());
        let version = |item: Option<&Item>| item.map(|i| i.version.clone());
        match self {
            UpdatePlugin { plugin: id } => {
                let p = plugin(id);
                (
                    format!("Update {}", name(p, id)),
                    version(p),
                    p.and_then(|p| p.update.clone()),
                )
            }
            RollbackPlugin {
                plugin: id,
                version: to,
            } => {
                let p = plugin(id);
                (
                    format!("Roll back {}", name(p, id)),
                    version(p),
                    Some(to.clone()),
                )
            }
            ActivatePlugin { plugin: id } => {
                (format!("Activate {}", name(plugin(id), id)), None, None)
            }
            DeactivatePlugin { plugin: id } => {
                (format!("Deactivate {}", name(plugin(id), id)), None, None)
            }
            DeletePlugin { plugin: id } => (
                format!("Delete {}", name(plugin(id), id)),
                version(plugin(id)),
                None,
            ),
            AutoUpdatePlugin { plugin: id, on } => (
                format!(
                    "Turn {} automatic updates for {}",
                    if *on { "on" } else { "off" },
                    name(plugin(id), id)
                ),
                None,
                None,
            ),
            InstallPlugin { source, .. } => (format!("Install {source}"), None, None),
            UpdateTheme { theme: id } => {
                let t = theme(id);
                (
                    format!("Update the {} theme", name(t, id)),
                    version(t),
                    t.and_then(|t| t.update.clone()),
                )
            }
            ActivateTheme { theme: id } => {
                (format!("Use the {} theme", name(theme(id), id)), None, None)
            }
            DeleteTheme { theme: id } => (
                format!("Delete the {} theme", name(theme(id), id)),
                version(theme(id)),
                None,
            ),
            UpdateCore => (
                "Update WordPress".into(),
                inv.wordpress.clone(),
                inv.wordpress_update.clone(),
            ),
            UpdateTranslations => ("Update translations".into(), None, None),
        }
    }
}

fn is_link(source: &str) -> bool {
    source.starts_with("https://") || source.starts_with("http://")
}

/// Core REST names a plugin by its file without `.php`.
fn rest_plugin(file: &str) -> &str {
    file.strip_suffix(".php").unwrap_or(file)
}

fn text(v: &Value) -> String {
    v.as_str().unwrap_or_default().to_string()
}

fn version_or_none(v: &Value) -> Option<String> {
    v.as_str().filter(|s| !s.is_empty()).map(String::from)
}

/// From Classic Monks' `get-site-snapshot` (M4).
pub fn from_snapshot(s: &Value) -> Inventory {
    let items = |list: &Value, id: &str| -> Vec<Item> {
        list.as_array()
            .into_iter()
            .flatten()
            .map(|p| Item {
                id: text(&p[id]),
                name: text(&p["name"]),
                version: text(&p["version"]),
                active: p["active"] == true,
                auto_update: p["auto_update"].as_bool(),
                update: version_or_none(&p["update"]),
            })
            .collect()
    };
    Inventory {
        wordpress: version_or_none(&s["core"]["version"]),
        wordpress_update: version_or_none(&s["core"]["update"]),
        plugins: items(&s["plugins"], "plugin"),
        themes: items(&s["themes"], "stylesheet"),
        translations: s["updates"]["translations"].as_array().map_or(0, Vec::len),
        updates_known: true,
        needs_credentials: s["filesystem"]["needs_credentials"] == true,
    }
}

/// From an older Classic Monks with no snapshot: `get-plugins` and `list-themes`.
pub fn from_older(plugins: &Value, themes: &Value) -> Inventory {
    Inventory {
        plugins: plugins["plugins"]
            .as_array()
            .into_iter()
            .flatten()
            .map(|p| Item {
                id: text(&p["file"]),
                name: text(&p["name"]),
                version: text(&p["version"]),
                active: p["active"] == true,
                auto_update: None,
                update: (p["update_available"] == true)
                    .then(|| version_or_none(&p["available_version"]))
                    .flatten(),
            })
            .collect(),
        themes: themes["themes"]
            .as_array()
            .into_iter()
            .flatten()
            .map(|t| Item {
                id: text(&t["stylesheet"]),
                name: text(&t["name"]),
                version: text(&t["version"]),
                active: t["active"] == true,
                auto_update: t["auto_update"].as_bool(),
                update: version_or_none(&t["update_version"]),
            })
            .collect(),
        updates_known: true,
        ..Default::default()
    }
}

/// From core REST (Basic mode): no updates, no automatic-update state.
pub fn from_rest(plugins: &Value, themes: &Value) -> Inventory {
    let rendered = |v: &Value| v["rendered"].as_str().map_or_else(|| text(v), String::from);
    Inventory {
        plugins: plugins
            .as_array()
            .into_iter()
            .flatten()
            .map(|p| Item {
                id: format!("{}.php", text(&p["plugin"])),
                name: text(&p["name"]),
                version: text(&p["version"]),
                active: p["status"] == "active",
                ..Default::default()
            })
            .collect(),
        themes: themes
            .as_array()
            .into_iter()
            .flatten()
            .map(|t| Item {
                id: text(&t["stylesheet"]),
                name: rendered(&t["name"]),
                version: text(&t["version"]),
                active: t["status"] == "active",
                ..Default::default()
            })
            .collect(),
        ..Default::default()
    }
}

/// A plugin found on WordPress.org.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Found {
    pub slug: String,
    pub name: String,
    pub version: String,
    pub active_installs: u64,
    pub summary: String,
}

/// The plugins in a WordPress.org `query_plugins` answer.
pub fn found(v: &Value) -> Vec<Found> {
    v["plugins"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|p| Found {
            slug: text(&p["slug"]),
            name: decode_entities(&text(&p["name"])),
            version: text(&p["version"]),
            active_installs: p["active_installs"].as_u64().unwrap_or(0),
            summary: decode_entities(&text(&p["short_description"])),
        })
        .collect()
}

/// WordPress.org sends names HTML-escaped ("Yoast SEO &#8211; Advanced").
pub(crate) fn decode_entities(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut rest = s;
    while let Some(i) = rest.find('&') {
        out.push_str(&rest[..i]);
        rest = &rest[i..];
        let Some(end) = rest.find(';').filter(|&e| e <= 10) else {
            out.push('&');
            rest = &rest[1..];
            continue;
        };
        let entity = &rest[1..end];
        let ch = match entity {
            "amp" => Some('&'),
            "lt" => Some('<'),
            "gt" => Some('>'),
            "quot" => Some('"'),
            "apos" => Some('\''),
            _ => entity
                .strip_prefix("#x")
                .and_then(|h| u32::from_str_radix(h, 16).ok())
                .or_else(|| entity.strip_prefix('#').and_then(|d| d.parse().ok()))
                .and_then(char::from_u32),
        };
        match ch {
            Some(c) => {
                out.push(c);
                rest = &rest[end + 1..];
            }
            None => {
                out.push('&');
                rest = &rest[1..];
            }
        }
    }
    out.push_str(rest);
    out
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum ItemState {
    Waiting,
    Running,
    Done,
    Failed,
    /// A safe update broke the site, so the version before it was put back.
    RolledBack,
}

impl ItemState {
    fn as_str(self) -> &'static str {
        match self {
            ItemState::Waiting => "waiting",
            ItemState::Running => "running",
            ItemState::Done => "done",
            ItemState::Failed => "failed",
            ItemState::RolledBack => "rolled_back",
        }
    }

    fn parse(s: &str) -> Self {
        match s {
            "running" => ItemState::Running,
            "done" => ItemState::Done,
            "failed" => ItemState::Failed,
            "rolled_back" => ItemState::RolledBack,
            _ => ItemState::Waiting,
        }
    }
}

/// One change in a job, as the app asks for it.
#[derive(Debug, Clone, Deserialize)]
pub struct Change {
    pub site_id: i64,
    pub action: Action,
}

#[derive(Debug, Clone, Serialize)]
pub struct JobItem {
    pub id: i64,
    pub site_id: Option<i64>,
    pub site_name: String,
    pub action: Action,
    pub label: String,
    pub from_version: Option<String>,
    pub to_version: Option<String>,
    pub state: ItemState,
    pub message: String,
}

#[derive(Debug, Clone, Serialize)]
pub struct Job {
    pub id: i64,
    pub title: String,
    pub created_at: i64,
    pub finished_at: Option<i64>,
    /// `Human`, or `Agent` for a plan an AI agent proposed.
    pub proposed_by: Actor,
    /// When a person confirmed it. An agent's plan waits until then.
    pub confirmed_at: Option<i64>,
    pub declined_at: Option<i64>,
    pub items: Vec<JobItem>,
}

/// A site whose Classic Monks doesn't treat this app as its operator asks a person first.
pub const NEEDS_APPROVAL: &str =
    "The site asks you to approve this change first. Approve it on the site at";

/// Most changes one plan may hold.
pub const PLAN_MAX: usize = 200;

fn job_items(conn: &Connection, job: i64) -> rusqlite::Result<Vec<JobItem>> {
    let mut stmt = conn.prepare_cached(
        "SELECT id, site_id, site_name, action, label, from_version, to_version, state, message
         FROM job_items WHERE job_id = ?1 ORDER BY id",
    )?;
    stmt.query_map([job], |r| {
        let action: String = r.get(3)?;
        let state: String = r.get(7)?;
        Ok(JobItem {
            id: r.get(0)?,
            site_id: r.get(1)?,
            site_name: r.get(2)?,
            action: serde_json::from_str(&action).unwrap_or(Action::UpdateTranslations),
            label: r.get(4)?,
            from_version: r.get(5)?,
            to_version: r.get(6)?,
            state: ItemState::parse(&state),
            message: r.get(8)?,
        })
    })?
    .collect()
}

fn get_job(conn: &Connection, id: i64) -> rusqlite::Result<Option<Job>> {
    conn.query_row(
        "SELECT id, title, created_at, finished_at, proposed_by, confirmed_at, declined_at
         FROM jobs WHERE id = ?1",
        [id],
        |r| {
            Ok(Job {
                id: r.get(0)?,
                title: r.get(1)?,
                created_at: r.get(2)?,
                finished_at: r.get(3)?,
                proposed_by: Actor::parse(&r.get::<_, String>(4)?),
                confirmed_at: r.get(5)?,
                declined_at: r.get(6)?,
                items: Vec::new(),
            })
        },
    )
    .optional()?
    .map(|mut j| {
        j.items = job_items(conn, j.id)?;
        Ok(j)
    })
    .transpose()
}

fn set_item(conn: &Connection, id: i64, state: ItemState, message: &str) -> rusqlite::Result<()> {
    conn.execute(
        "UPDATE job_items SET state = ?2, message = ?3 WHERE id = ?1",
        params![id, state.as_str(), message],
    )?;
    Ok(())
}

/// The site's own words about a finished change, or a plain "Done."
fn done_message(out: &Value) -> String {
    out["message"]
        .as_str()
        .filter(|m| !m.is_empty())
        .unwrap_or("Done.")
        .to_string()
}

/// Agents get this for any change on a site they have no grant on (plan 5.6).
pub const NO_AGENT_ACCESS: &str = "AI agents can only read this site: it has no AI agent access. Propose the change as a plan, which a person confirms in the Monks Central app, or ask them to turn on AI agent access for this site there (AI), so the site asks them to approve each change.";

impl Core {
    fn inventory_of(&self, id: i64) -> Result<Option<Inventory>, SiteError> {
        let json: Option<String> = self.db(|c| {
            c.query_row(
                "SELECT snapshot FROM inventory WHERE site_id = ?1",
                [id],
                |r| r.get(0),
            )
            .optional()
        })?;
        Ok(json.and_then(|j| serde_json::from_str(&j).ok()))
    }

    /// Every site's last-read inventory.
    pub fn inventories(&self) -> Result<Vec<SiteInventory>, SiteError> {
        self.db(|c| {
            let mut stmt = c.prepare_cached(
                "SELECT site_id, fetched_at, snapshot FROM inventory ORDER BY site_id",
            )?;
            let rows =
                stmt.query_map([], |r| Ok((r.get(0)?, r.get(1)?, r.get::<_, String>(2)?)))?;
            Ok(rows
                .filter_map(Result::ok)
                .filter_map(|(site_id, fetched_at, json)| {
                    Some(SiteInventory {
                        site_id,
                        fetched_at,
                        inventory: serde_json::from_str(&json).ok()?,
                    })
                })
                .collect())
        })
    }

    /// Read what the site runs and keep it. Old Classic Monks without the
    /// snapshot tool is read with two older tools.
    pub async fn refresh_inventory(&self, id: i64) -> Result<Inventory, SiteError> {
        let _work = self.working().await;
        self.refresh_inventory_inner(id).await
    }

    pub(crate) async fn refresh_inventory_inner(&self, id: i64) -> Result<Inventory, SiteError> {
        let site = self.site(id)?;
        let inv = match site.mode {
            Mode::ClassicMonks if has_tool(&site, "get-site-snapshot") => from_snapshot(
                &self
                    .call_ability_inner(id, "get-site-snapshot", json!({}))
                    .await?,
            ),
            Mode::ClassicMonks if has_tool(&site, "get-plugins") => {
                let plugins = self
                    .call_ability_inner(id, "get-plugins", json!({ "status": "all", "limit": 100 }))
                    .await?;
                let themes = if has_tool(&site, "list-themes") {
                    self.call_ability_inner(id, "list-themes", json!({}))
                        .await?
                } else {
                    Value::Null
                };
                from_older(&plugins, &themes)
            }
            Mode::ClassicMonks => {
                return Err(plain(
                    "This connection has no plugin tools. Sign in again and tick the plugin and theme tool groups.",
                ));
            }
            Mode::Basic => {
                let secret: AppPassword = self.load_secret(id)?;
                let get = |route: &'static str| {
                    self.rest_get(
                        &site.url,
                        &site.api_url,
                        route,
                        &[("context", "edit")],
                        &secret,
                    )
                };
                let (plugins, themes) = (get("/wp/v2/plugins").await?, get("/wp/v2/themes").await?);
                let read = |r: &net::Reply| -> Result<Value, SiteError> {
                    match r.status {
                        200 => r.json().ok_or_else(|| {
                            plain("The site sent a plugin list Monks Central couldn't read.")
                        }),
                        401 | 403 => Err(plain(
                            "This application password's user can't manage plugins. Use an administrator's application password.",
                        )),
                        s => Err(plain(net::explain_status(r).map_or_else(
                            || format!("The REST API answered {s}."),
                            String::from,
                        ))),
                    }
                };
                let mut inv = from_rest(&read(&plugins)?, &read(&themes)?);
                inv.wordpress = site.wp_version.clone();
                inv
            }
        };
        let json = serde_json::to_string(&inv).expect("plain struct");
        self.db(|c| {
            c.execute(
                "INSERT INTO inventory (site_id, snapshot, fetched_at) VALUES (?1, ?2, unixepoch())
                 ON CONFLICT (site_id) DO UPDATE SET snapshot = ?2, fetched_at = unixepoch()",
                params![id, json],
            )
        })?;
        let _ = self.changed.send(Changed::Inventory);
        Ok(inv)
    }

    /// Versions a plugin can go back to, newest first (Classic Monks only).
    pub async fn plugin_versions(&self, id: i64, plugin: &str) -> Result<Value, SiteError> {
        self.call_ability(id, "list-plugin-versions", json!({ "plugin": plugin }))
            .await
    }

    /// Search WordPress.org's plugin directory.
    pub async fn search_plugins(&self, query: &str) -> Result<Vec<Found>, SiteError> {
        let query = query.trim();
        if query.chars().count() < 2 {
            return Err(plain("Type at least two letters to search."));
        }
        let reply = net::send(&self.limits, "api.wordpress.org", Retry::ReadOnly, || {
            self.http
                .get("https://api.wordpress.org/plugins/info/1.2/")
                .query(&[
                    ("action", "query_plugins"),
                    ("request[search]", query),
                    ("request[per_page]", "12"),
                ])
        })
        .await?;
        reply
            .json::<Value>()
            .filter(|_| reply.status == 200)
            .map(|v| found(&v))
            .ok_or_else(|| plain("WordPress.org didn't answer the search. Try again in a minute."))
    }

    /// Record a job the human confirmed, then run it in the background.
    /// Sites run side by side; one site's changes run one after another.
    /// Async only so every caller is inside the runtime the job is spawned on.
    pub async fn start_job(
        self: &Arc<Self>,
        title: &str,
        changes: Vec<Change>,
    ) -> Result<Job, SiteError> {
        let id = self.insert_job(title, &changes, Actor::Human)?;
        let job = self.job(id)?;
        self.spawn_job(&job);
        Ok(job)
    }

    /// An AI agent's plan: recorded, shown in the app, and left waiting for a
    /// person to confirm it there. Plugins and themes may be named by folder or name.
    pub fn propose_plan(&self, title: &str, mut changes: Vec<Change>) -> Result<Job, SiteError> {
        if changes.len() > PLAN_MAX {
            return Err(plain(format!(
                "A plan can hold at most {PLAN_MAX} changes. Split it into smaller plans."
            )));
        }
        for c in &mut changes {
            let site = self.site(c.site_id)?;
            if let Some(inv) = self.inventory_of(c.site_id)? {
                c.action.resolve(&inv).map_err(|what| {
                    plain(format!(
                        "{} has no {what}. List its plugins and themes first.",
                        site.name
                    ))
                })?;
            }
        }
        let title = if title.trim().is_empty() {
            "Plan from an AI agent"
        } else {
            title
        };
        let id = self.insert_job(title, &changes, Actor::Agent)?;
        let job = self.job(id)?;
        let sites = job
            .items
            .iter()
            .filter_map(|i| i.site_id)
            .collect::<std::collections::BTreeSet<_>>()
            .len();
        self.record(
            Actor::Agent,
            None,
            &format!("Proposed a plan: {}", job.title),
            Outcome::Waiting,
            &format!(
                "{} on {}. Waiting for you to confirm it under AI.",
                count(job.items.len(), "change"),
                count(sites, "site")
            ),
        );
        let _ = self.changed.send(Changed::Jobs);
        Ok(job)
    }

    /// The person in the app confirms an agent's plan: it runs with the app's
    /// grant. Only the window calls this; the socket can't reach it.
    pub async fn confirm_plan(self: &Arc<Self>, id: i64) -> Result<Job, SiteError> {
        let job = self.decide_plan(id, "confirmed_at")?;
        self.record(
            Actor::Human,
            None,
            &format!("Confirmed the plan: {}", job.title),
            Outcome::Done,
            "Proposed by an AI agent.",
        );
        self.spawn_job(&job);
        Ok(job)
    }

    /// The person in the app turns an agent's plan down. Nothing runs.
    pub fn decline_plan(&self, id: i64) -> Result<Job, SiteError> {
        let job = self.decide_plan(id, "declined_at")?;
        self.record(
            Actor::Human,
            None,
            &format!("Declined the plan: {}", job.title),
            Outcome::Done,
            "Proposed by an AI agent. Nothing changed.",
        );
        let _ = self.changed.send(Changed::Jobs);
        Ok(job)
    }

    /// Mark a waiting plan confirmed or declined, once.
    fn decide_plan(&self, id: i64, column: &'static str) -> Result<Job, SiteError> {
        let finished = if column == "declined_at" {
            ", finished_at = unixepoch()"
        } else {
            ""
        };
        let n = self.db(|c| {
            c.execute(
                &format!(
                    "UPDATE jobs SET {column} = unixepoch(){finished} WHERE id = ?1
                     AND proposed_by = 'agent' AND confirmed_at IS NULL AND declined_at IS NULL"
                ),
                [id],
            )
        })?;
        if n == 0 {
            return Err(plain(
                "This plan isn't waiting any more: it was confirmed or declined already.",
            ));
        }
        self.job(id)
    }

    /// Agents' plans waiting for a person, oldest first.
    pub fn waiting_plans(&self) -> Result<Vec<Job>, SiteError> {
        let ids: Vec<i64> = self.db(|c| {
            let mut stmt = c.prepare_cached(
                "SELECT id FROM jobs WHERE proposed_by = 'agent' AND confirmed_at IS NULL
                 AND declined_at IS NULL ORDER BY id",
            )?;
            stmt.query_map([], |r| r.get(0))?.collect()
        })?;
        ids.into_iter().map(|id| self.job(id)).collect()
    }

    fn spawn_job(self: &Arc<Self>, job: &Job) {
        let core = self.clone();
        let (id, items) = (job.id, job.items.clone());
        let actor = match job.proposed_by {
            Actor::Human => Actor::Human,
            _ => Actor::AgentConfirmed,
        };
        tokio::spawn(async move { core.run_job(id, items, actor).await });
        let _ = self.changed.send(Changed::Jobs);
    }

    fn insert_job(&self, title: &str, changes: &[Change], by: Actor) -> Result<i64, SiteError> {
        if changes.is_empty() {
            return Err(plain("Pick at least one change."));
        }
        let mut rows = Vec::with_capacity(changes.len());
        for c in changes {
            let site = self.site(c.site_id)?;
            let inv = self.inventory_of(c.site_id)?.unwrap_or_default();
            rows.push((site, c.action.describe(&inv), c));
        }
        let title: String = title.trim().chars().take(200).collect();
        self.db(|conn| {
            let tx = conn.unchecked_transaction()?;
            tx.execute(
                "INSERT INTO jobs (title, proposed_by, confirmed_at)
                 VALUES (?1, ?2, CASE WHEN ?2 = 'human' THEN unixepoch() END)",
                params![title, by.as_str()],
            )?;
            let job = tx.last_insert_rowid();
            for (site, (label, from, to), c) in &rows {
                tx.execute(
                    "INSERT INTO job_items (job_id, site_id, site_name, action, label, from_version, to_version)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
                    params![
                        job,
                        site.id,
                        site.name,
                        serde_json::to_string(&c.action).expect("plain enum"),
                        label,
                        from,
                        to
                    ],
                )?;
            }
            tx.commit()?;
            Ok(job)
        })
    }

    pub fn job(&self, id: i64) -> Result<Job, SiteError> {
        self.db(|c| get_job(c, id))?
            .ok_or_else(|| plain("That job isn't in Monks Central any more."))
    }

    /// The latest jobs, newest first.
    pub fn jobs(&self, limit: u32) -> Result<Vec<Job>, SiteError> {
        let ids: Vec<i64> = self.db(|c| {
            let mut stmt = c.prepare_cached("SELECT id FROM jobs ORDER BY id DESC LIMIT ?1")?;
            stmt.query_map([limit], |r| r.get(0))?.collect()
        })?;
        ids.into_iter().map(|id| self.job(id)).collect()
    }

    async fn run_job(self: Arc<Self>, job: i64, items: Vec<JobItem>, actor: Actor) {
        let _work = self.working().await;
        let mut by_site: BTreeMap<i64, Vec<JobItem>> = BTreeMap::new();
        for item in items {
            by_site
                .entry(item.site_id.unwrap_or_default())
                .or_default()
                .push(item);
        }
        let mut set = tokio::task::JoinSet::new();
        for (site, items) in by_site {
            let core = self.clone();
            set.spawn(async move {
                for item in items {
                    core.mark(item.id, ItemState::Running, "");
                    let (state, msg) = match core.run_action(site, &item.action).await {
                        Ok(m) => (ItemState::Done, m),
                        // The site's words are for an agent; a person reads these.
                        Err(SiteError::NeedsApproval { approve_url, .. }) => (
                            ItemState::Failed,
                            format!("{NEEDS_APPROVAL} {approve_url}, then try this change again."),
                        ),
                        Err(SiteError::RolledBack(m)) => (ItemState::RolledBack, m),
                        Err(e) => (ItemState::Failed, e.to_string()),
                    };
                    core.mark(item.id, state, &msg);
                    let outcome = if state == ItemState::Done {
                        Outcome::Done
                    } else {
                        Outcome::Failed
                    };
                    core.record(actor, item.site_id, &item.label, outcome, &msg);
                }
                // The versions changed: read them again so the screens are right.
                let _ = core.refresh_inventory_inner(site).await;
            });
        }
        while set.join_next().await.is_some() {}
        let _ = self.db(|c| {
            c.execute(
                "UPDATE jobs SET finished_at = unixepoch() WHERE id = ?1",
                [job],
            )
        });
        let _ = self.changed.send(Changed::Jobs);
    }

    fn mark(&self, item: i64, state: ItemState, message: &str) {
        let _ = self.db(|c| set_item(c, item, state, message));
        let _ = self.changed.send(Changed::Jobs);
    }

    /// Jobs a closed app left unfinished: say so instead of "running" forever.
    pub fn close_unfinished_jobs(&self) -> Result<(), SiteError> {
        self.db(|c| {
            // Plans still waiting for a person stay waiting.
            c.execute(
                "UPDATE job_items SET state = 'failed',
                 message = 'Monks Central closed before this finished. Check the site, then try again.'
                 WHERE state IN ('waiting', 'running')
                 AND job_id IN (SELECT id FROM jobs WHERE proposed_by = 'human' OR confirmed_at IS NOT NULL)",
                [],
            )?;
            c.execute(
                "UPDATE jobs SET finished_at = unixepoch()
                 WHERE finished_at IS NULL AND (proposed_by = 'human' OR confirmed_at IS NOT NULL)",
                [],
            )
        })?;
        Ok(())
    }

    /// Make one change on one site, as the operator. Returns the site's message.
    async fn run_action(&self, id: i64, action: &Action) -> Result<String, SiteError> {
        let site = self.site(id)?;
        if action.writes_files() && self.inventory_of(id)?.is_some_and(|i| i.needs_credentials) {
            return Err(plain(
                "WordPress on this site needs FTP details to change files, so Monks Central can't install or update here. Set FS_METHOD to direct in wp-config.php, or do it in wp-admin.",
            ));
        }
        match site.mode {
            Mode::ClassicMonks => {
                let (tool, args) = action.classic_monks();
                if let Action::UpdatePlugin { plugin } = action
                    && has_tool(&site, "get-http-status")
                {
                    return self.update_plugin_safely(&site, plugin).await;
                }
                if !has_tool(&site, tool) {
                    return Err(plain(format!(
                        "This connection can't do that: it has no {tool} tool. Update Classic Monks on the site, or sign in again and tick the plugin and theme tool groups."
                    )));
                }
                let out = self.call_ability_inner(id, tool, args).await?;
                if out["updated"] == false {
                    return Err(plain(done_message(&out)));
                }
                Ok(done_message(&out))
            }
            Mode::Basic => self.run_basic(&site, action).await,
        }
    }

    /// Update a plugin with Classic Monks' checks (M10). The site checks itself
    /// in the same request and puts the old version back if the new one fails
    /// to load, since a fatal error there would stop every later request too.
    /// Then Monks Central looks at the home page from outside and at the error
    /// log, and rolls back over MCP if either shows the update broke the site.
    async fn update_plugin_safely(&self, site: &Site, plugin: &str) -> Result<String, SiteError> {
        let id = site.id;
        let before = self
            .call_ability_inner(id, "get-http-status", json!({}))
            .await?;
        if before["ok"] != true {
            return Err(plain(format!(
                "Not updated: the site wasn't working before the update ({}), so Monks Central couldn't tell whether the update broke it. Fix the site, then try again.",
                http_problem(&before)
            )));
        }
        let mark = self
            .call_ability_inner(id, "get-error-log-since", json!({}))
            .await?;
        let out = self
            .call_ability_inner(
                id,
                "update-plugin",
                json!({ "plugin_file": plugin, "safe": true }),
            )
            .await?;
        let previous = out["previous_version"].as_str().unwrap_or_default();
        if out["rolled_back"] == true {
            return Err(SiteError::RolledBack(format!(
                "Rolled back to {previous}. {}",
                text(&out["reason"])
            )));
        }
        if out["updated"] == false {
            return Err(plain(done_message(&out)));
        }
        let Some(reason) = self.broken_after_update(site, plugin, &mark).await else {
            return Ok("Updated. The site works after the update.".into());
        };
        let back = self
            .call_ability_inner(
                id,
                "rollback-plugin",
                json!({ "plugin": plugin, "version": previous, "note": format!("Safe update from Monks Central: {reason}") }),
            )
            .await;
        match back {
            Ok(_) => Err(SiteError::RolledBack(format!(
                "Rolled back to {previous}. {reason}"
            ))),
            Err(e) => Err(plain(format!(
                "{reason} Putting {previous} back failed too ({e}). Roll it back by hand in wp-admin."
            ))),
        }
    }

    /// What shows the update broke the site, from outside: the home page as a
    /// visitor gets it, and new fatal errors from the plugin in the error log.
    async fn broken_after_update(&self, site: &Site, plugin: &str, mark: &Value) -> Option<String> {
        if let Ok(home) = self.http.get(&site.url).send().await {
            let status = home.status().as_u16();
            let body = home.text().await.unwrap_or_default();
            if status >= 500 || body.contains(CRITICAL_ERROR) {
                return Some(format!(
                    "After the update the home page answered {status} with WordPress' critical error page."
                ));
            }
        }
        let folder = plugin.split('/').next().unwrap_or(plugin);
        let log = self
            .call_ability_inner(
                site.id,
                "get-error-log-since",
                json!({ "offset": mark["offset"] }),
            )
            .await
            .ok()?;
        log["lines"]
            .as_array()?
            .iter()
            .filter_map(Value::as_str)
            .find(|l| {
                (l.contains("PHP Fatal error") || l.contains("PHP Parse error"))
                    && l.contains(&format!("plugins/{folder}/"))
            })
            .map(|l| format!("After the update the error log shows: {}", l.trim()))
    }

    /// Core REST can activate, deactivate, delete and install from WordPress.org.
    async fn run_basic(&self, site: &Site, action: &Action) -> Result<String, SiteError> {
        use reqwest::Method;
        let (method, route, body) = match action {
            Action::ActivatePlugin { plugin } => (
                Method::POST,
                format!("/wp/v2/plugins/{}", rest_plugin(plugin)),
                json!({ "status": "active" }),
            ),
            Action::DeactivatePlugin { plugin } => (
                Method::POST,
                format!("/wp/v2/plugins/{}", rest_plugin(plugin)),
                json!({ "status": "inactive" }),
            ),
            Action::DeletePlugin { plugin } => (
                Method::DELETE,
                format!("/wp/v2/plugins/{}", rest_plugin(plugin)),
                Value::Null,
            ),
            Action::InstallPlugin { source, activate } if !is_link(source) => (
                Method::POST,
                "/wp/v2/plugins".to_string(),
                json!({ "slug": source, "status": if *activate { "active" } else { "inactive" } }),
            ),
            Action::InstallPlugin { .. } => {
                return Err(plain(
                    "Basic mode installs from WordPress.org only. Install Classic Monks on the site to install from a link.",
                ));
            }
            _ => {
                return Err(plain(
                    "Basic mode can't do this. It needs Classic Monks on the site.",
                ));
            }
        };
        let secret: AppPassword = self.load_secret(site.id)?;
        let url = rest_url(&site.api_url, &route);
        let reply = net::send(&self.limits, &site.url, Retry::Write, || {
            let req = self
                .http
                .request(method.clone(), &url)
                .basic_auth(&secret.username, Some(&secret.password));
            if body.is_null() { req } else { req.json(&body) }
        })
        .await?;
        match reply.status {
            200 | 201 => Ok("Done.".into()),
            401 => {
                self.db(|c| crate::sites::set_sign_in_again(c, site.id, true))?;
                self.notify();
                Err(SiteError::SignInAgain)
            }
            s => {
                let said = reply
                    .json::<Value>()
                    .and_then(|v| v["message"].as_str().map(String::from));
                Err(plain(said.unwrap_or_else(|| {
                    net::explain_status(&reply)
                        .map_or_else(|| format!("The site answered {s}."), String::from)
                })))
            }
        }
    }
}

/// WordPress' page for a PHP fatal error (WP_Fatal_Error_Handler).
const CRITICAL_ERROR: &str = "There has been a critical error on this website";

/// Why `get-http-status` says the site isn't working, in a few words.
fn http_problem(v: &Value) -> String {
    if let Some(f) = v["fatal"].as_str() {
        return f.to_string();
    }
    if let Some(e) = v["error"].as_str() {
        return e.to_string();
    }
    match v["status"].as_u64() {
        Some(503) if v["maintenance"] == true => "it is in maintenance mode".into(),
        Some(0) | None => "it didn't answer".into(),
        Some(s) => format!("the home page answered {s}"),
    }
}

/// "1 change", "3 changes".
fn count(n: usize, one: &str) -> String {
    format!("{n} {one}{}", if n == 1 { "" } else { "s" })
}

pub(crate) fn has_tool(site: &Site, tool: &str) -> bool {
    site.capabilities["abilities"]
        .as_array()
        .is_some_and(|a| a.iter().any(|t| t == tool))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testsite::TestSite;
    use crate::{Options, connect::SiteError};
    use std::time::Duration;

    async fn core() -> (tempfile::TempDir, Arc<Core>) {
        let home = tempfile::tempdir().unwrap();
        let opts = Options {
            keychain: Ok(keyring_core::mock::Store::new().unwrap()),
            ..Default::default()
        };
        let core = Core::start(home.path(), opts).await.unwrap();
        (home, core)
    }

    fn browser(url: &str) -> std::io::Result<()> {
        let url = url.to_string();
        tokio::spawn(async move { reqwest::get(url).await });
        Ok(())
    }

    async fn wait(core: &Core, job: i64) -> Job {
        for _ in 0..200 {
            let j = core.job(job).unwrap();
            if j.finished_at.is_some() {
                return j;
            }
            tokio::time::sleep(Duration::from_millis(20)).await;
        }
        panic!("job {job} didn't finish");
    }

    fn woo() -> String {
        "woocommerce/woocommerce.php".into()
    }

    #[test]
    fn snapshot_older_and_rest_read_the_same_way() {
        let snap = json!({
            "core": { "version": "7.1.3", "update": "7.1.4" },
            "plugins": [{ "plugin": "woocommerce/woocommerce.php", "name": "WooCommerce", "version": "10.2.0", "active": true, "auto_update": false, "update": "10.3.0" }],
            "themes": [{ "stylesheet": "bricks", "name": "Bricks", "version": "2.4.3", "active": true, "auto_update": false, "update": null }],
            "updates": { "translations": [{}, {}] },
            "filesystem": { "needs_credentials": true },
        });
        let inv = from_snapshot(&snap);
        assert_eq!(inv.wordpress_update.as_deref(), Some("7.1.4"));
        assert_eq!(inv.plugins[0].update.as_deref(), Some("10.3.0"));
        assert_eq!(inv.plugins[0].auto_update, Some(false));
        assert_eq!(inv.themes[0].update, None);
        assert_eq!(inv.translations, 2);
        assert!(inv.updates_known && inv.needs_credentials);

        let older = from_older(
            &json!({ "plugins": [{ "file": "woocommerce/woocommerce.php", "name": "WooCommerce", "version": "10.2.0", "active": false, "update_available": true, "available_version": "10.3.0" }] }),
            &json!({ "themes": [{ "stylesheet": "twentytwentyfive", "name": "Twenty Twenty-Five", "version": "1.2", "active": true, "update_version": "" }] }),
        );
        assert_eq!(older.plugins[0].id, woo());
        assert_eq!(older.plugins[0].update.as_deref(), Some("10.3.0"));
        assert_eq!(older.plugins[0].auto_update, None);
        assert!(!older.plugins[0].active);
        assert_eq!(older.themes[0].update, None);

        let rest = from_rest(
            &json!([{ "plugin": "woocommerce/woocommerce", "name": "WooCommerce", "version": "10.2.0", "status": "active" }]),
            &json!([{ "stylesheet": "twentytwentyfive", "name": { "rendered": "Twenty Twenty-Five" }, "version": "1.2", "status": "active" }]),
        );
        assert_eq!(rest.plugins[0].id, woo(), "same id as Classic Monks");
        assert_eq!(rest.themes[0].name, "Twenty Twenty-Five");
        assert!(!rest.updates_known);
        assert_eq!(rest_plugin(&woo()), "woocommerce/woocommerce");
    }

    #[test]
    fn wordpress_org_search_is_read_and_unescaped() {
        let v = json!({ "plugins": [{ "slug": "wordpress-seo", "name": "Yoast SEO &#8211; Advanced SEO &amp; more", "version": "26.2", "active_installs": 10000000, "short_description": "It&#039;s &lt;b&gt; &bogus; &#x41;" }] });
        let f = found(&v);
        assert_eq!(f[0].name, "Yoast SEO \u{2013} Advanced SEO & more");
        assert_eq!(f[0].summary, "It's <b> &bogus; A");
        assert_eq!(f[0].active_installs, 10_000_000);
        assert_eq!(decode_entities("a & b &"), "a & b &");
    }

    #[test]
    fn actions_map_to_tools_and_say_what_they_do() {
        let inv = Inventory {
            wordpress: Some("7.1.3".into()),
            wordpress_update: Some("7.1.4".into()),
            plugins: vec![Item {
                id: woo(),
                name: "WooCommerce".into(),
                version: "10.2.0".into(),
                update: Some("10.3.0".into()),
                ..Default::default()
            }],
            ..Default::default()
        };
        let a = Action::UpdatePlugin { plugin: woo() };
        assert_eq!(a.classic_monks().0, "update-plugin");
        assert_eq!(
            a.describe(&inv),
            (
                "Update WooCommerce".into(),
                Some("10.2.0".into()),
                Some("10.3.0".into())
            )
        );
        let r = Action::RollbackPlugin {
            plugin: woo(),
            version: "9.9.0".into(),
        };
        assert_eq!(r.describe(&inv).0, "Roll back WooCommerce");
        assert_eq!(r.classic_monks().1["version"], "9.9.0");
        assert_eq!(
            Action::UpdateCore.describe(&inv).2.as_deref(),
            Some("7.1.4")
        );
        let link = Action::InstallPlugin {
            source: "https://x.test/a.zip".into(),
            activate: true,
        };
        assert_eq!(link.classic_monks().1["source_url"], "https://x.test/a.zip");
        let slug = Action::InstallPlugin {
            source: "akismet".into(),
            activate: false,
        };
        assert_eq!(
            slug.classic_monks().1,
            json!({ "slug": "akismet", "activate": false })
        );
        assert!(!Action::ActivatePlugin { plugin: woo() }.writes_files());
        assert!(Action::DeleteTheme { theme: "x".into() }.writes_files());
        assert_eq!(
            Action::DeletePlugin {
                plugin: "gone/gone.php".into()
            }
            .describe(&inv)
            .0,
            "Delete gone/gone.php",
            "an unknown plugin is named by its file"
        );
        let json = serde_json::to_value(&a).unwrap();
        assert_eq!(json, json!({ "do": "update_plugin", "plugin": woo() }));
    }

    #[tokio::test]
    async fn inventory_is_read_and_kept() {
        let (_h, core) = core().await;
        let site = TestSite::start().await;
        let s = core.add_site_oauth(&site.url, browser).await.unwrap();
        let inv = core.refresh_inventory(s.id).await.unwrap();
        assert_eq!(inv.plugins[0].id, woo());
        let all = core.inventories().unwrap();
        assert_eq!(all.len(), 1);
        assert_eq!(all[0].inventory, inv);
        assert!(all[0].fetched_at > 0);
    }

    async fn update_woo(core: &Arc<Core>, site: i64) -> JobItem {
        let job = core
            .start_job(
                "Update WooCommerce",
                vec![Change {
                    site_id: site,
                    action: Action::UpdatePlugin { plugin: woo() },
                }],
            )
            .await
            .unwrap();
        wait(core, job.id).await.items.remove(0)
    }

    #[tokio::test]
    async fn a_safe_update_that_breaks_the_site_is_rolled_back_with_the_reason() {
        let (_h, core) = core().await;
        let site = TestSite::start().await;
        let s = core.add_site_oauth(&site.url, browser).await.unwrap();
        core.refresh_inventory(s.id).await.unwrap();

        // The new version fatals: the site puts the old one back in the same request.
        site.state().update_fatals = true;
        let item = update_woo(&core, s.id).await;
        assert_eq!(item.state, ItemState::RolledBack, "{}", item.message);
        assert!(
            item.message
                .starts_with("Rolled back to 10.2.0. The home page answered 500"),
            "{}",
            item.message
        );
        assert!(item.message.contains("Call to undefined function boom()"));
        let calls: Vec<_> = site.state().calls.iter().map(|c| c.0.clone()).collect();
        assert_eq!(
            calls[calls.len() - 4..],
            [
                "get-http-status",
                "get-error-log-since",
                "update-plugin",
                "get-site-snapshot"
            ]
        );
        assert_eq!(site.state().calls[calls.len() - 2].1["safe"], true);
        assert_eq!(site.state().plugins[0]["version"], "10.2.0");
        let log = core.activity_log(None).unwrap();
        assert_eq!(
            (log[0].outcome, log[0].detail.as_str()),
            (Outcome::Failed, item.message.as_str())
        );

        // Only a visitor sees it: Monks Central rolls back over MCP.
        site.state().update_breaks_home = true;
        let item = update_woo(&core, s.id).await;
        assert_eq!(item.state, ItemState::RolledBack, "{}", item.message);
        assert_eq!(
            item.message,
            "Rolled back to 10.2.0. After the update the home page answered 500 with WordPress' critical error page."
        );
        assert_eq!(
            site.state().calls.iter().rev().nth(1).unwrap().0,
            "rollback-plugin"
        );
        assert_eq!(site.state().plugins[0]["version"], "10.2.0");

        // A fatal error in the log after the update, from this plugin only.
        site.state().error_log =
            vec!["PHP Fatal error: from before in plugins/woocommerce/a.php".into()];
        site.state().log_on_update =
            Some("PHP Fatal error: elsewhere in ABSPATH/wp-content/plugins/other/x.php:3".into());
        let item = update_woo(&core, s.id).await;
        assert_eq!(item.state, ItemState::Done, "{}", item.message);
        site.state().plugins[0]["update"] = json!("10.4.0");
        let line = "[28-Oct-2026 10:00:00 UTC] PHP Fatal error:  Uncaught TypeError in ABSPATH/wp-content/plugins/woocommerce/src/x.php:9";
        site.state().log_on_update = Some(line.into());
        core.refresh_inventory(s.id).await.unwrap();
        let item = update_woo(&core, s.id).await;
        assert_eq!(item.state, ItemState::RolledBack, "{}", item.message);
        assert_eq!(
            item.message,
            format!("Rolled back to 10.3.0. After the update the error log shows: {line}")
        );
    }

    #[tokio::test]
    async fn a_safe_update_needs_a_working_site_first_and_older_sites_update_unchecked() {
        let (_h, core) = core().await;
        let site = TestSite::start().await;
        let s = core.add_site_oauth(&site.url, browser).await.unwrap();
        core.refresh_inventory(s.id).await.unwrap();
        site.state().home_status = 500;
        let item = update_woo(&core, s.id).await;
        assert_eq!(item.state, ItemState::Failed);
        assert!(
            item.message.starts_with(
                "Not updated: the site wasn't working before the update (PHP Fatal error"
            ),
            "{}",
            item.message
        );
        assert_eq!(
            site.state().plugins[0]["version"],
            "10.2.0",
            "nothing changed"
        );

        site.state().home_status = 200;
        site.state().no_safe_tools = true;
        let s = core.sign_in_again_oauth(s.id, browser).await.unwrap();
        let item = update_woo(&core, s.id).await;
        assert_eq!(
            (item.state, item.message.as_str()),
            (ItemState::Done, "Updated.")
        );
        assert_eq!(site.state().calls.last().unwrap().0, "get-site-snapshot");
        assert!(
            site.state()
                .calls
                .iter()
                .rev()
                .nth(1)
                .unwrap()
                .1
                .get("safe")
                .is_none(),
            "a plain update"
        );
    }

    #[tokio::test]
    async fn a_job_updates_two_sites_then_one_rolls_back() {
        let (_h, core) = core().await;
        let (a, b) = (TestSite::start().await, TestSite::start().await);
        let sa = core.add_site_oauth(&a.url, browser).await.unwrap();
        let sb = core.add_site_oauth(&b.url, browser).await.unwrap();
        for s in [sa.id, sb.id] {
            core.refresh_inventory(s).await.unwrap();
        }
        let mut events = core.subscribe();
        let job = core
            .start_job(
                "Update WooCommerce on 2 sites",
                [sa.id, sb.id]
                    .map(|site_id| Change {
                        site_id,
                        action: Action::UpdatePlugin { plugin: woo() },
                    })
                    .to_vec(),
            )
            .await
            .unwrap();
        assert_eq!(job.items.len(), 2);
        assert_eq!(job.items[0].label, "Update WooCommerce");
        assert_eq!(
            (
                job.items[0].from_version.as_deref(),
                job.items[0].to_version.as_deref()
            ),
            (Some("10.2.0"), Some("10.3.0"))
        );
        let job = wait(&core, job.id).await;
        assert!(
            job.items.iter().all(|i| i.state == ItemState::Done),
            "{:?}",
            job.items
        );
        assert_eq!(
            job.items[0].message,
            "Updated. The site works after the update."
        );
        assert!(matches!(events.recv().await, Ok(Changed::Jobs)));
        for s in [sa.id, sb.id] {
            let inv = core.inventory_of(s).unwrap().unwrap();
            assert_eq!(inv.plugins[0].version, "10.3.0", "read again after the job");
            assert_eq!(inv.plugins[0].update, None);
        }

        let versions = core.plugin_versions(sa.id, &woo()).await.unwrap();
        assert_eq!(versions["versions"][1]["version"], "10.2.0");
        let back = core
            .start_job(
                "Roll back WooCommerce",
                vec![Change {
                    site_id: sa.id,
                    action: Action::RollbackPlugin {
                        plugin: woo(),
                        version: "10.2.0".into(),
                    },
                }],
            )
            .await
            .unwrap();
        let back = wait(&core, back.id).await;
        assert_eq!(
            back.items[0].state,
            ItemState::Done,
            "{}",
            back.items[0].message
        );
        assert_eq!(back.items[0].from_version.as_deref(), Some("10.3.0"));
        assert_eq!(
            core.inventory_of(sa.id).unwrap().unwrap().plugins[0].version,
            "10.2.0"
        );
        assert_eq!(
            core.inventory_of(sb.id).unwrap().unwrap().plugins[0].version,
            "10.3.0"
        );
        assert_eq!(core.jobs(10).unwrap()[0].id, back.id, "newest first");
    }

    #[tokio::test]
    async fn a_failed_change_says_why_and_the_rest_still_run() {
        let (_h, core) = core().await;
        let site = TestSite::start().await;
        let s = core.add_site_oauth(&site.url, browser).await.unwrap();
        core.refresh_inventory(s.id).await.unwrap();
        site.state().fail_tool = Some("update-plugin".into());
        let job = core
            .start_job(
                "Two changes",
                vec![
                    Change {
                        site_id: s.id,
                        action: Action::UpdatePlugin { plugin: woo() },
                    },
                    Change {
                        site_id: s.id,
                        action: Action::DeactivatePlugin { plugin: woo() },
                    },
                    Change {
                        site_id: s.id,
                        action: Action::UpdateTheme {
                            theme: "missing".into(),
                        },
                    },
                ],
            )
            .await
            .unwrap();
        let job = wait(&core, job.id).await;
        assert_eq!(job.items[0].state, ItemState::Failed);
        assert_eq!(job.items[0].message, "The update could not be installed.");
        assert_eq!(job.items[1].state, ItemState::Done);
        assert!(
            job.items[2].message.contains("no update-theme tool"),
            "{}",
            job.items[2].message
        );
        assert!(!core.inventory_of(s.id).unwrap().unwrap().plugins[0].active);
        assert!(core.start_job("none", vec![]).await.is_err());
    }

    #[tokio::test]
    async fn sites_that_need_ftp_details_are_not_touched() {
        let (_h, core) = core().await;
        let site = TestSite::start().await;
        let s = core.add_site_oauth(&site.url, browser).await.unwrap();
        site.state().needs_credentials = true;
        core.refresh_inventory(s.id).await.unwrap();
        let job = core
            .start_job(
                "x",
                vec![Change {
                    site_id: s.id,
                    action: Action::UpdatePlugin { plugin: woo() },
                }],
            )
            .await
            .unwrap();
        let job = wait(&core, job.id).await;
        assert!(
            job.items[0].message.contains("FTP"),
            "{}",
            job.items[0].message
        );
        assert!(site.state().calls.iter().all(|(t, _)| t != "update-plugin"));
    }

    #[tokio::test]
    async fn basic_mode_reads_and_changes_plugins_over_rest() {
        let (_h, core) = core().await;
        let site = TestSite::start().await;
        let s = core
            .add_site_basic(&site.url, "admin", "abcd efgh ijkl mnop qrst uvwx")
            .await
            .unwrap();
        let inv = core.refresh_inventory(s.id).await.unwrap();
        assert_eq!(inv.plugins[0].id, woo());
        assert!(!inv.updates_known);
        let job = core
            .start_job(
                "Basic",
                vec![
                    Change {
                        site_id: s.id,
                        action: Action::DeactivatePlugin { plugin: woo() },
                    },
                    Change {
                        site_id: s.id,
                        action: Action::InstallPlugin {
                            source: "akismet".into(),
                            activate: false,
                        },
                    },
                    Change {
                        site_id: s.id,
                        action: Action::InstallPlugin {
                            source: "https://x.test/a.zip".into(),
                            activate: false,
                        },
                    },
                    Change {
                        site_id: s.id,
                        action: Action::UpdatePlugin { plugin: woo() },
                    },
                    Change {
                        site_id: s.id,
                        action: Action::DeletePlugin {
                            plugin: "akismet/akismet.php".into(),
                        },
                    },
                ],
            )
            .await
            .unwrap();
        let job = wait(&core, job.id).await;
        let states: Vec<_> = job.items.iter().map(|i| i.state).collect();
        use ItemState::*;
        assert_eq!(
            states,
            [Done, Done, Failed, Failed, Done],
            "{:?}",
            job.items
        );
        assert!(job.items[3].message.contains("needs Classic Monks"));
        let inv = core.inventory_of(s.id).unwrap().unwrap();
        assert!(!inv.plugins[0].active);
        assert_eq!(inv.plugins.len(), 1, "installed, then deleted");

        site.state().app_password = "revoked".into();
        let job = core
            .start_job(
                "x",
                vec![Change {
                    site_id: s.id,
                    action: Action::ActivatePlugin { plugin: woo() },
                }],
            )
            .await
            .unwrap();
        let job = wait(&core, job.id).await;
        assert!(matches!(job.items[0].message.as_str(), m if m.contains("Sign in again")));
        assert!(core.site(s.id).unwrap().sign_in_again);
    }

    #[tokio::test]
    async fn agents_read_but_their_changes_are_refused_before_anything_is_sent() {
        let (_h, core) = core().await;
        let site = TestSite::start().await;
        let s = core.add_site_oauth(&site.url, browser).await.unwrap();
        let read = core
            .agent_call(&s.url, "get-site-snapshot", json!({}))
            .await
            .unwrap();
        assert_eq!(read["plugins"][0]["plugin"], woo());
        let calls = site.state().calls.len();
        let err = core
            .agent_call(
                &s.id.to_string(),
                "update-plugin",
                json!({ "plugin_file": woo() }),
            )
            .await
            .unwrap_err();
        assert!(
            matches!(&err, SiteError::Plain(m) if m == NO_AGENT_ACCESS),
            "{err}"
        );
        assert_eq!(site.state().calls.len(), calls, "nothing reached the site");
        assert!(
            core.agent_call("nope", "get-posts", json!({}))
                .await
                .is_err()
        );
        assert!(
            core.agent_call(&s.url, "no-such-tool", json!({}))
                .await
                .is_err()
        );
    }

    #[tokio::test]
    async fn a_site_that_asks_for_approval_says_so_to_a_person() {
        let (_h, core) = core().await;
        let site = TestSite::start().await;
        let s = core.add_site_oauth(&site.url, browser).await.unwrap();
        core.refresh_inventory(s.id).await.unwrap();
        // An older Classic Monks with no operator grants gates the app too.
        site.state().operator = false;
        let change = Change {
            site_id: s.id,
            action: Action::UpdatePlugin { plugin: woo() },
        };
        let job = core.start_job("Update", vec![change]).await.unwrap();
        let job = wait(&core, job.id).await;
        assert_eq!(job.items[0].state, ItemState::Failed);
        assert_eq!(
            job.items[0].message,
            format!(
                "{NEEDS_APPROVAL} {}/wp-admin/admin.php?page=cm-ai-approve&op=40, then try this change again.",
                site.url
            )
        );
    }

    #[tokio::test]
    async fn unfinished_jobs_are_closed_with_a_reason() {
        let (_h, core) = core().await;
        let site = TestSite::start().await;
        let s = core.add_site_oauth(&site.url, browser).await.unwrap();
        let id = core
            .db(|c| {
                c.execute("INSERT INTO jobs (title) VALUES ('left')", [])?;
                let job = c.last_insert_rowid();
                c.execute(
                    "INSERT INTO job_items (job_id, site_id, site_name, action, label, state) VALUES (?1, ?2, 'x', '{\"do\":\"update_core\"}', 'Update WordPress', 'running')",
                    params![job, s.id],
                )?;
                Ok(job)
            })
            .unwrap();
        core.close_unfinished_jobs().unwrap();
        let job = core.job(id).unwrap();
        assert!(job.finished_at.is_some());
        assert_eq!(job.items[0].state, ItemState::Failed);
        assert_eq!(job.items[0].action, Action::UpdateCore);
        assert!(job.items[0].message.contains("closed"));
    }

    #[tokio::test]
    async fn a_declined_plan_never_runs_and_plans_name_what_the_site_has() {
        let (_h, core) = core().await;
        let site = TestSite::start().await;
        let s = core.add_site_oauth(&site.url, browser).await.unwrap();
        let change = |plugin: &str| Change {
            site_id: s.id,
            action: Action::UpdatePlugin {
                plugin: plugin.into(),
            },
        };
        let err = core.propose_plan("x", vec![change("nope")]).unwrap_err();
        assert_eq!(
            err.to_string(),
            "Test Site has no plugin nope. List its plugins and themes first."
        );
        assert!(core.propose_plan("x", vec![]).is_err());
        assert!(
            core.propose_plan("x", vec![change("WooCommerce"); PLAN_MAX + 1])
                .is_err()
        );
        let plan = core.propose_plan(" ", vec![change("WooCommerce")]).unwrap();
        assert_eq!(plan.title, "Plan from an AI agent");
        let declined = core.decline_plan(plan.id).unwrap();
        assert!(declined.declined_at.is_some() && declined.finished_at.is_some());
        assert!(core.confirm_plan(plan.id).await.is_err());
        assert!(core.decline_plan(plan.id).is_err());
        tokio::time::sleep(Duration::from_millis(100)).await;
        assert!(!site.state().calls.iter().any(|(t, _)| t == "update-plugin"));
        // A person's own job is theirs in the log.
        let job = core
            .start_job("Update WooCommerce", vec![change(&woo())])
            .await
            .unwrap();
        assert_eq!(job.proposed_by, Actor::Human);
        assert!(job.confirmed_at.is_some());
        wait(&core, job.id).await;
        let log = core.activity_log(None).unwrap();
        assert_eq!(log[0].actor, Actor::Human);
        assert_eq!(log[0].what, "Update WooCommerce");
        assert_eq!(log[0].site_name, "Test Site");
        assert!(
            log.iter()
                .any(|e| e.what == "Declined the plan: Plan from an AI agent")
        );
        let older = core.activity_log(Some(log[0].id)).unwrap();
        assert_eq!(older.len(), log.len() - 1);
    }
}
