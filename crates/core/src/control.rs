// SPDX-License-Identifier: GPL-3.0-or-later
//! One-click login (Classic Monks M3) and Classic Monks itself (plan Phase 4):
//! its features (on/off), the settings it lets Monks Central change, its
//! activity log with undo, and the changes waiting for approval on the site.
//!
//! All of it needs Classic Monks; Basic mode has none of these tools.

use serde::Serialize;
use serde_json::{Value, json};

use crate::Core;
use crate::connect::{SiteError, plain};
use crate::content::text;
use crate::fleet::has_tool;
use crate::sites::{Mode, Site};

pub const ACTIVITY_PER_PAGE: u32 = 25;

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Toggle {
    pub name: String,
    pub label: String,
    pub description: String,
    pub section: String,
    pub on: bool,
    /// Can't be changed from Monks Central (security and login features).
    pub locked: bool,
}

/// One tab of Classic Monks' settings page, with its on/off features.
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct FeatureGroup {
    pub key: String,
    pub label: String,
    pub toggles: Vec<Toggle>,
}

/// A value Classic Monks lets Monks Central change (`hq_editable`).
#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Setting {
    pub name: String,
    pub label: String,
    pub description: String,
    pub tab: String,
    pub section: String,
    /// `select` or `number`.
    pub control: String,
    pub options: Vec<String>,
    pub min: Option<f64>,
    pub max: Option<f64>,
    pub step: Option<f64>,
    pub value: Value,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct ActivityRow {
    pub id: i64,
    /// The site's local time.
    pub time: String,
    /// The app or person who did it ("Monks Central", "Claude", "WP-CLI").
    pub who: String,
    pub tool: String,
    pub status: String,
    pub summary: String,
    pub can_undo: bool,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Activity {
    pub rows: Vec<ActivityRow>,
    pub total: u64,
    pub page: u32,
    pub pages: u32,
}

#[derive(Debug, Clone, PartialEq, Serialize)]
pub struct Approval {
    pub id: i64,
    pub tool: String,
    pub who: String,
    pub time: String,
    pub expires_in: u64,
}

/// "Monks Central [operator]" reads as "Monks Central".
fn who(row: &Value) -> String {
    let label = text(&row["client_label"]);
    let label = label
        .split(" [")
        .next()
        .unwrap_or_default()
        .trim()
        .to_string();
    if label.is_empty() {
        text(&row["user"])
    } else {
        label
    }
}

/// `enable_svg_support` reads as "Enable svg support".
fn humane(name: &str) -> String {
    let mut s = name.replace('_', " ");
    if let Some(f) = s.get_mut(0..1) {
        f.make_ascii_uppercase();
    }
    s
}

/// Every field of `get-settings-schema`, with the label of its tab.
fn fields(schema: &Value) -> impl Iterator<Item = (&Value, &Value)> {
    schema["tabs"]
        .as_array()
        .into_iter()
        .flatten()
        .flat_map(|tab| {
            tab["subtabs"]
                .as_array()
                .into_iter()
                .flatten()
                .flat_map(|sub| sub["fields"].as_array().into_iter().flatten())
                .map(move |f| (tab, f))
        })
}

/// Features from `get-features`, grouped by `get-settings-schema` tabs when
/// the site has it. Toggles no tab places go under "Other features".
pub fn feature_groups(features: &Value, schema: Option<&Value>) -> Vec<FeatureGroup> {
    let states = features["features"]
        .as_object()
        .cloned()
        .unwrap_or_default();
    let locked: Vec<&str> = features["locked"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .collect();
    let toggle = |name: &str, label: String, description: String, section: String| Toggle {
        name: name.into(),
        on: states.get(name) == Some(&Value::Bool(true)),
        locked: locked.contains(&name),
        label,
        description,
        section,
    };
    let mut groups: Vec<FeatureGroup> = Vec::new();
    let mut placed = std::collections::HashSet::new();
    if let Some(schema) = schema {
        for (tab, f) in fields(schema) {
            let name = text(&f["name"]);
            if f["write_with"] != "update-features"
                || !states.contains_key(&name)
                || !placed.insert(name.clone())
            {
                continue;
            }
            let key = text(&tab["key"]);
            let t = toggle(
                &name,
                text(&f["label"]),
                text(&f["description"]),
                text(&f["section"]),
            );
            match groups.iter_mut().find(|g| g.key == key) {
                Some(g) => g.toggles.push(t),
                None => groups.push(FeatureGroup {
                    label: text(&tab["label"]),
                    key,
                    toggles: vec![t],
                }),
            }
        }
    }
    let mut rest: Vec<Toggle> = states
        .keys()
        .filter(|n| !placed.contains(*n))
        .map(|n| toggle(n, humane(n), String::new(), String::new()))
        .collect();
    rest.sort_by(|a, b| a.label.cmp(&b.label));
    if !rest.is_empty() {
        let label = if groups.is_empty() {
            "All features"
        } else {
            "Other features"
        };
        groups.push(FeatureGroup {
            key: "other".into(),
            label: label.into(),
            toggles: rest,
        });
    }
    groups
}

/// The settings Classic Monks lets Monks Central change, without their values.
pub fn editable_settings(schema: &Value) -> Vec<Setting> {
    let num = |v: &Value| v.as_f64();
    fields(schema)
        .filter(|(_, f)| f["hq_editable"] == true && f["locked"] != true && f["secret"] != true)
        .map(|(tab, f)| Setting {
            name: text(&f["name"]),
            label: text(&f["label"]),
            description: text(&f["description"]),
            tab: text(&tab["label"]),
            section: text(&f["section"]),
            control: text(&f["control"]),
            options: f["enum"]
                .as_array()
                .into_iter()
                .flatten()
                .map(|o| match o {
                    Value::String(s) => s.clone(),
                    other => other.to_string(),
                })
                .collect(),
            min: num(&f["min"]),
            max: num(&f["max"]),
            step: num(&f["step"]),
            value: f["default"].clone(),
        })
        .collect()
}

pub fn activity_from(v: &Value, page: u32) -> Activity {
    let total = v["total"].as_u64().unwrap_or_default();
    Activity {
        rows: v["rows"]
            .as_array()
            .into_iter()
            .flatten()
            .map(|r| ActivityRow {
                id: r["id"].as_i64().unwrap_or_default(),
                time: text(&r["created_at"]),
                who: who(r),
                tool: text(&r["tool"]),
                status: text(&r["status"]),
                summary: text(&r["summary"]),
                can_undo: r["can_undo"] == true,
            })
            .collect(),
        total,
        page,
        pages: total.div_ceil(u64::from(ACTIVITY_PER_PAGE)).max(1) as u32,
    }
}

/// A link the site sent, if it really points at the site.
fn on_site(site: &Site, link: &str) -> Result<String, SiteError> {
    let ours = reqwest::Url::parse(&site.url).ok();
    let theirs = reqwest::Url::parse(link).ok();
    match (ours, theirs) {
        (Some(o), Some(t))
            if matches!(t.scheme(), "https" | "http")
                && t.host_str() == o.host_str()
                && t.port_or_known_default() == o.port_or_known_default() =>
        {
            Ok(t.to_string())
        }
        _ => Err(plain(
            "The site sent a link to somewhere else, so Monks Central didn't open it.",
        )),
    }
}

/// Classic Monks' own reports on one site, as the site gives them. A report the
/// site's Classic Monks doesn't have is `None`.
#[derive(Debug, Default, Serialize)]
pub struct CmReports {
    pub not_found: Option<Value>,
    pub searches: Option<Value>,
    pub unused_media: Option<Value>,
    pub logins: Option<Value>,
    pub two_factor: Option<Value>,
    /// Reports the site has but didn't give, with why.
    pub failed: Vec<(String, String)>,
}

pub const NO_REPORTS: &str = "This site's Classic Monks has no reports Monks Central can read. Update Classic Monks on the site, then check it again.";

fn keep(
    got: Option<Result<Value, SiteError>>,
    tool: &str,
    failed: &mut Vec<(String, String)>,
) -> Option<Value> {
    match got? {
        Ok(v) => Some(v),
        Err(e) => {
            failed.push((tool.to_string(), e.to_string()));
            None
        }
    }
}

impl Core {
    /// The 404, search, unused media, login and two-factor reports over `days` days.
    pub async fn cm_reports(&self, id: i64, days: u32) -> Result<CmReports, SiteError> {
        let _work = self.working().await;
        self.cm_reports_inner(id, days).await
    }

    pub(crate) async fn cm_reports_inner(
        &self,
        id: i64,
        days: u32,
    ) -> Result<CmReports, SiteError> {
        let site = self.site(id)?;
        if site.mode != Mode::ClassicMonks {
            return Err(plain("Reports need Classic Monks on the site."));
        }
        const TOOLS: [&str; 5] = [
            "get-404-report",
            "get-search-report",
            "get-unused-media-report",
            "get-login-security-report",
            "get-2fa-report",
        ];
        if !TOOLS.iter().any(|t| has_tool(&site, t)) {
            return Err(plain(NO_REPORTS));
        }
        let days = days.clamp(1, 365);
        let ask = |tool: &'static str, args: Value| {
            let has = has_tool(&site, tool);
            async move {
                if has {
                    Some(self.call_ability_inner(id, tool, args).await)
                } else {
                    None
                }
            }
        };
        let (a, b, c, d, e) = tokio::join!(
            ask(TOOLS[0], json!({ "days": days, "limit": 10 })),
            ask(TOOLS[1], json!({ "days": days, "limit": 10 })),
            ask(TOOLS[2], json!({ "limit": 10 })),
            ask(TOOLS[3], json!({ "days": days, "limit": 10 })),
            ask(TOOLS[4], json!({ "limit": 20 })),
        );
        let mut failed = vec![];
        Ok(CmReports {
            not_found: keep(a, TOOLS[0], &mut failed),
            searches: keep(b, TOOLS[1], &mut failed),
            unused_media: keep(c, TOOLS[2], &mut failed),
            logins: keep(d, TOOLS[3], &mut failed),
            two_factor: keep(e, TOOLS[4], &mut failed),
            failed,
        })
    }

    /// The site, if its Classic Monks has this tool.
    fn cm_site(&self, id: i64, tool: &str) -> Result<Site, SiteError> {
        let site = self.site(id)?;
        if site.mode != Mode::ClassicMonks {
            return Err(plain("This needs Classic Monks on the site."));
        }
        if !has_tool(&site, tool) {
            return Err(plain(
                "This site's Classic Monks can't do that yet. Update Classic Monks on the site, then check it again.",
            ));
        }
        Ok(site)
    }

    /// A single-use link that signs the connected user (and only them) into
    /// wp-admin. It works once, within 60 seconds.
    pub async fn login_link(&self, id: i64) -> Result<String, SiteError> {
        let _work = self.working().await;
        let site = self.site(id)?;
        if site.mode != Mode::ClassicMonks {
            return Err(plain(
                "One-click login needs Classic Monks on the site. Open the site and log in as usual.",
            ));
        }
        if !has_tool(&site, "create-login-link") {
            return Err(plain(
                "One-click login needs a newer Classic Monks, signed in as your Monks Central app. Update Classic Monks, then sign in to the site again.",
            ));
        }
        let v = self
            .call_ability_inner(id, "create-login-link", json!({}))
            .await?;
        on_site(&site, &text(&v["url"]))
    }

    /// Classic Monks' on/off features, by tab.
    pub async fn features(&self, id: i64) -> Result<Vec<FeatureGroup>, SiteError> {
        let _work = self.working().await;
        let site = self.cm_site(id, "get-features")?;
        let features = self
            .call_ability_inner(id, "get-features", json!({}))
            .await?;
        let schema = if has_tool(&site, "get-settings-schema") {
            Some(
                self.call_ability_inner(id, "get-settings-schema", json!({}))
                    .await?,
            )
        } else {
            None
        };
        Ok(feature_groups(&features, schema.as_ref()))
    }

    /// Turn a feature on or off. Returns the activity row that undoes it, if any.
    pub async fn set_feature(
        &self,
        id: i64,
        name: &str,
        on: bool,
    ) -> Result<Option<i64>, SiteError> {
        let _work = self.working().await;
        self.cm_site(id, "update-features")?;
        let v = self
            .call_ability_inner(id, "update-features", json!({ "features": { name: on } }))
            .await?;
        if v["updated"][name] != on {
            return Err(plain("The site didn't change that feature."));
        }
        self.undo_row(id, "update-features", name, None).await
    }

    /// The newest undoable activity row for this tool that touched `key` (on `post_id`, when
    /// the key is shared between entries, as ACF field keys are).
    pub(crate) async fn undo_row(
        &self,
        id: i64,
        tool: &str,
        key: &str,
        post_id: Option<i64>,
    ) -> Result<Option<i64>, SiteError> {
        if !has_tool(&self.site(id)?, "list-ai-activity") {
            return Ok(None);
        }
        let v = self
            .call_ability_inner(
                id,
                "list-ai-activity",
                json!({ "tool": tool, "per_page": 5 }),
            )
            .await?;
        Ok(v["rows"]
            .as_array()
            .into_iter()
            .flatten()
            .find(|r| {
                r["can_undo"] == true
                    && r["status"] == "ok"
                    && post_id.is_none_or(|p| r["input"]["post_id"].as_i64() == Some(p))
                    && r["input"]
                        .as_object()
                        .into_iter()
                        .flat_map(|i| i.values())
                        .any(|m| m.get(key).is_some())
            })
            .and_then(|r| r["id"].as_i64()))
    }

    /// The settings Monks Central may change here, with their values.
    pub async fn settings(&self, id: i64) -> Result<Vec<Setting>, SiteError> {
        let _work = self.working().await;
        self.cm_site(id, "get-settings-schema")?;
        self.cm_site(id, "get-settings")?;
        let schema = self
            .call_ability_inner(id, "get-settings-schema", json!({ "editable_only": true }))
            .await?;
        let mut list = editable_settings(&schema);
        if list.is_empty() {
            return Ok(list);
        }
        let names: Vec<&str> = list.iter().map(|s| s.name.as_str()).collect();
        let v = self
            .call_ability_inner(id, "get-settings", json!({ "names": names }))
            .await?;
        for s in &mut list {
            if let Some(value) = v["settings"].get(&s.name).filter(|v| !v.is_null()) {
                s.value = value.clone();
            }
        }
        Ok(list)
    }

    /// Change one setting. Returns the activity row that undoes it, if any.
    pub async fn set_setting(
        &self,
        id: i64,
        name: &str,
        value: Value,
    ) -> Result<Option<i64>, SiteError> {
        let _work = self.working().await;
        self.cm_site(id, "update-settings")?;
        self.call_ability_inner(
            id,
            "update-settings",
            json!({ "settings": { name: value } }),
        )
        .await?;
        self.undo_row(id, "update-settings", name, None).await
    }

    /// One page of the site's Classic Monks activity log, newest first.
    pub async fn activity(&self, id: i64, page: u32) -> Result<Activity, SiteError> {
        let _work = self.working().await;
        self.cm_site(id, "list-ai-activity")?;
        let page = page.max(1);
        let v = self
            .call_ability_inner(
                id,
                "list-ai-activity",
                json!({ "page": page, "per_page": ACTIVITY_PER_PAGE }),
            )
            .await?;
        Ok(activity_from(&v, page))
    }

    /// Reverse one change from the activity log.
    pub async fn undo(&self, id: i64, row: i64) -> Result<(), SiteError> {
        let _work = self.working().await;
        self.cm_site(id, "undo-operation")?;
        self.call_ability_inner(id, "undo-operation", json!({ "id": row }))
            .await?;
        Ok(())
    }

    /// Changes AI clients asked for that wait for a person to approve them.
    pub async fn approvals(&self, id: i64) -> Result<Vec<Approval>, SiteError> {
        let _work = self.working().await;
        self.cm_site(id, "list-pending-approvals")?;
        let v = self
            .call_ability_inner(id, "list-pending-approvals", json!({}))
            .await?;
        Ok(v["approvals"]
            .as_array()
            .into_iter()
            .flatten()
            .map(|a| Approval {
                id: a["op_id"].as_i64().unwrap_or_default(),
                tool: text(&a["tool"]),
                who: who(a),
                time: text(&a["created_at"]),
                expires_in: a["expires_in"].as_u64().unwrap_or_default(),
            })
            .collect())
    }

    /// The site's own page to approve or decline one waiting change. Deciding
    /// stays on the site, so an agent can never approve its own change here.
    pub async fn approval_link(&self, id: i64, op: i64) -> Result<String, SiteError> {
        let _work = self.working().await;
        let site = self.cm_site(id, "list-pending-approvals")?;
        let v = self
            .call_ability_inner(id, "list-pending-approvals", json!({}))
            .await?;
        let link = v["approvals"]
            .as_array()
            .into_iter()
            .flatten()
            .find(|a| a["op_id"].as_i64() == Some(op))
            .map(|a| text(&a["approve_url"]))
            .ok_or_else(|| {
                plain("That change isn't waiting any more: it was decided or it expired.")
            })?;
        on_site(&site, &link)
    }

    /// A link a site gave (a search result, say), opened only if it points at that site.
    pub fn link_on_site(&self, id: i64, link: &str) -> Result<String, SiteError> {
        on_site(&self.site(id)?, link)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Options;
    use crate::testsite::TestSite;
    use std::sync::Arc;

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

    #[tokio::test]
    async fn classic_monks_reports_come_together_and_a_failing_one_is_named() {
        let (_h, core) = core().await;
        let site = TestSite::start().await;
        let s = core.add_site_oauth(&site.url, browser).await.unwrap();
        site.state().fail_tool = Some("get-search-report".into());
        let r = core.cm_reports(s.id, 30).await.unwrap();
        assert_eq!(r.not_found.as_ref().unwrap()["count"], 2);
        assert_eq!(r.two_factor.as_ref().unwrap()["stats"]["users_with_2fa"], 1);
        assert!(r.searches.is_none());
        assert_eq!(r.failed[0].0, "get-search-report");
        let days: Vec<_> = site
            .state()
            .calls
            .iter()
            .filter(|(t, _)| t == "get-login-security-report")
            .map(|(_, a)| a["days"].clone())
            .collect();
        assert_eq!(days, [json!(30)]);

        let b = TestSite::start().await;
        let sb = core
            .add_site_basic(&b.url, "admin", "abcd efgh ijkl mnop qrst uvwx")
            .await
            .unwrap();
        assert!(core.cm_reports(sb.id, 30).await.is_err());
    }

    #[tokio::test]
    async fn login_links_only_open_on_the_site() {
        let (_h, core) = core().await;
        let site = TestSite::start().await;
        let s = core.add_site_oauth(&site.url, browser).await.unwrap();
        let link = core.login_link(s.id).await.unwrap();
        assert!(link.starts_with(&format!("{}/wp-login.php?action=cm_login_link", site.url)));
        // A site that hands out a link to somewhere else isn't followed.
        for bad in [
            "https://evil.example/wp-login.php",
            "file:///etc/passwd",
            "nonsense",
        ] {
            site.state().login_link = Some(bad.into());
            let e = core.login_link(s.id).await.unwrap_err();
            assert!(e.to_string().contains("somewhere else"), "{bad}");
        }
        let port = site.url.rsplit(':').next().unwrap().parse::<u16>().unwrap();
        site.state().login_link = Some(format!("http://127.0.0.1:{}/x", port + 1));
        assert!(
            core.login_link(s.id).await.is_err(),
            "another port is another site"
        );
    }

    #[tokio::test]
    async fn login_needs_classic_monks_with_the_tool() {
        let (_h, core) = core().await;
        let site = TestSite::start().await;
        let basic = core
            .add_site_basic(&site.url, "admin", "abcd efgh ijkl mnop qrst uvwx")
            .await
            .unwrap();
        let e = core.login_link(basic.id).await.unwrap_err();
        assert!(e.to_string().contains("needs Classic Monks"));
        assert!(core.features(basic.id).await.is_err());

        let old = TestSite::start().await;
        old.state().released = true;
        let s = core.add_site_oauth(&old.url, browser).await.unwrap();
        let e = core.login_link(s.id).await.unwrap_err();
        assert!(e.to_string().contains("newer Classic Monks"));
        let e = core.activity(s.id, 1).await.unwrap_err();
        assert!(e.to_string().contains("Update Classic Monks"));
        // Released Classic Monks still has its features, as one plain list.
        let groups = core.features(s.id).await.unwrap();
        assert_eq!(groups.len(), 1);
        assert_eq!(groups[0].label, "All features");
        assert_eq!(groups[0].toggles[0].label, "Enable maintenance mode");
        assert_eq!(
            core.set_feature(s.id, "enable_svg_support", true)
                .await
                .unwrap(),
            None
        );
    }

    #[tokio::test]
    async fn a_feature_is_turned_on_and_undone() {
        let (_h, core) = core().await;
        let site = TestSite::start().await;
        let s = core.add_site_oauth(&site.url, browser).await.unwrap();
        let groups = core.features(s.id).await.unwrap();
        let labels: Vec<&str> = groups.iter().map(|g| g.label.as_str()).collect();
        assert_eq!(labels, ["Security", "Performance", "Other features"]);
        assert!(groups[0].toggles[0].locked);
        let svg = &groups[1].toggles[0];
        assert_eq!((svg.label.as_str(), svg.on), ("SVG Support", false));

        let undo = core
            .set_feature(s.id, "enable_svg_support", true)
            .await
            .unwrap()
            .expect("an undo row");
        assert_eq!(site.state().features["enable_svg_support"], true);
        let e = core
            .set_feature(s.id, "enable_maintenance_mode", true)
            .await
            .unwrap_err();
        assert!(e.to_string().contains("can't be changed"));

        let log = core.activity(s.id, 1).await.unwrap();
        assert_eq!((log.total, log.pages), (1, 1));
        let row = &log.rows[0];
        assert_eq!(
            (row.id, row.who.as_str(), row.can_undo),
            (undo, "Monks Central", true)
        );
        core.undo(s.id, undo).await.unwrap();
        assert_eq!(site.state().features["enable_svg_support"], false);
        assert_eq!(
            core.activity(s.id, 1).await.unwrap().rows[0].status,
            "undone"
        );
        assert!(core.undo(s.id, undo).await.is_err(), "undone once only");
    }

    #[tokio::test]
    async fn settings_change_and_approvals_open_on_the_site() {
        let (_h, core) = core().await;
        let site = TestSite::start().await;
        let s = core.add_site_oauth(&site.url, browser).await.unwrap();
        let list = core.settings(s.id).await.unwrap();
        let names: Vec<&str> = list.iter().map(|x| x.name.as_str()).collect();
        assert_eq!(
            names,
            ["limit_post_revisions", "auto_resize_quality"],
            "secrets stay out"
        );
        assert_eq!(list[0].options, ["default", "disable", "1", "2"]);
        assert_eq!(
            (list[1].value.clone(), list[1].max),
            (json!(82), Some(100.0))
        );
        let undo = core
            .set_setting(s.id, "auto_resize_quality", json!(70))
            .await
            .unwrap();
        assert!(undo.is_some());
        assert_eq!(core.settings(s.id).await.unwrap()[1].value, json!(70));

        let waiting = core.approvals(s.id).await.unwrap();
        assert_eq!(
            (
                waiting[0].id,
                waiting[0].who.as_str(),
                waiting[0].tool.as_str()
            ),
            (31, "Claude", "delete-post")
        );
        let link = core.approval_link(s.id, 31).await.unwrap();
        assert!(link.starts_with(&site.url) && link.ends_with("op=31"));
        let e = core.approval_link(s.id, 99).await.unwrap_err();
        assert!(e.to_string().contains("isn't waiting"));
        site.state().approvals[0]["approve_url"] = "@evil.example/".into();
        assert!(core.approval_link(s.id, 31).await.is_err());
    }

    #[test]
    fn rows_and_names_read_plainly() {
        assert_eq!(humane("enable_svg_support"), "Enable svg support");
        assert_eq!(who(&json!({ "client_label": "", "user": "joy" })), "joy");
        let a = activity_from(&json!({ "total": 51, "rows": [] }), 2);
        assert_eq!((a.pages, a.page), (3, 2));
        assert!(feature_groups(&json!({}), None).is_empty());
    }
}
