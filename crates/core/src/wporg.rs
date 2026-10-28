// SPDX-License-Identifier: GPL-3.0-or-later
//! Plugin icons and theme screenshots from the WordPress.org directory, for the
//! plugin and theme tiles. Only slugs some site runs are looked up (and the
//! plugin search's results), a batch at a time, once a week. A miss (premium,
//! custom, zip installs) is kept a week too. Cached as `data:` URLs in
//! `<data>/wporg/<plugins|themes>/<slug>`, an empty file for a miss; the file's
//! time is when it was looked up. Offline, the cache stays as it is.

use std::collections::{BTreeMap, BTreeSet};
use std::path::{Path, PathBuf};
use std::time::{Duration, SystemTime};

use base64::Engine;
use base64::engine::general_purpose::STANDARD;
use reqwest::Url;
use serde::Deserialize;
use serde_json::{Map, Value};

use crate::fleet::Inventory;
use crate::icons::{image_mime, save};
use crate::net::{self, Retry};
use crate::{Changed, Core};

/// Hits and misses are looked up again after a week.
const WEEK: Duration = Duration::from_secs(7 * 86400);
/// Slugs per lookup.
const BATCH: usize = 20;
/// Theme screenshots are a few hundred KB; a bigger body is not a tile.
const CAP: usize = 2 * 1024 * 1024;
/// The only hosts images are fetched from: WordPress.org's own, never a site's.
const IMAGE_HOSTS: [&str; 3] = ["ps.w.org", "s.w.org", "ts.w.org"];
/// The lookup's answer without what the tiles don't need.
const PLUGIN_FIELDS: [(&str, &str); 10] = [
    ("request[fields][icons]", "1"),
    ("request[fields][sections]", "0"),
    ("request[fields][description]", "0"),
    ("request[fields][reviews]", "0"),
    ("request[fields][versions]", "0"),
    ("request[fields][screenshots]", "0"),
    ("request[fields][banners]", "0"),
    ("request[fields][contributors]", "0"),
    ("request[fields][tags]", "0"),
    ("request[fields][ratings]", "0"),
];
const THEME_FIELDS: [(&str, &str); 3] = [
    ("request[fields][sections]", "0"),
    ("request[fields][tags]", "0"),
    ("request[fields][versions]", "0"),
];

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Kind {
    Plugin,
    Theme,
}

impl Kind {
    fn dir(self) -> &'static str {
        match self {
            Kind::Plugin => "plugins",
            Kind::Theme => "themes",
        }
    }
}

/// A plugin's directory slug from its file: `akismet/akismet.php` is `akismet`.
pub fn plugin_slug(file: &str) -> &str {
    // WordPress ships Hello Dolly as a lone file.
    if file == "hello.php" {
        return "hello-dolly";
    }
    let folder = file.split('/').next().unwrap_or_default();
    folder.strip_suffix(".php").unwrap_or(folder)
}

/// What WordPress.org slugs look like; anything else is never asked for, and
/// never a path.
fn valid(slug: &str) -> bool {
    (1..=100).contains(&slug.len())
        && slug
            .bytes()
            .all(|b| b.is_ascii_lowercase() || b.is_ascii_digit() || b == b'-' || b == b'_')
}

fn path(home: &Path, kind: Kind, slug: &str) -> PathBuf {
    home.join("wporg").join(kind.dir()).join(slug)
}

/// Not looked up yet, or a week ago.
fn due(file: &Path) -> bool {
    std::fs::metadata(file)
        .and_then(|m| m.modified())
        .ok()
        .and_then(|t| SystemTime::now().duration_since(t).ok())
        .is_none_or(|age| age >= WEEK)
}

/// The image for a tile in a lookup's answer: a plugin's icon (svg, then 2x,
/// then 1x), a theme's screenshot. Only on WordPress.org's image hosts.
pub(crate) fn image_url(kind: Kind, info: &Value) -> Option<Url> {
    let url = match kind {
        Kind::Plugin => ["svg", "2x", "1x"]
            .iter()
            .find_map(|k| info["icons"][k].as_str())?,
        Kind::Theme => info["screenshot_url"].as_str()?,
    };
    // Theme screenshots come as `//ts.w.org/...`.
    let url = Url::parse(url)
        .or_else(|_| Url::parse(&format!("https:{url}")))
        .ok()?;
    (url.scheme() == "https" && IMAGE_HOSTS.contains(&url.host_str()?)).then_some(url)
}

impl Core {
    /// The cached image as a `data:` URL; None for a miss or not looked up yet.
    pub fn package_icon(&self, kind: Kind, slug: &str) -> Option<String> {
        if !valid(slug) {
            return None;
        }
        std::fs::read_to_string(path(&self.home, kind, slug))
            .ok()
            .filter(|s| !s.is_empty())
    }

    /// The picture of the plugin or theme a sentence names ("Update WooCommerce"),
    /// longest name first, from what the site runs.
    pub(crate) fn icon_named(&self, inv: &Inventory, text: &str) -> Option<String> {
        let plugins = inv
            .plugins
            .iter()
            .map(|p| (Kind::Plugin, plugin_slug(&p.id), &p.name));
        let themes = inv.themes.iter().map(|t| (Kind::Theme, &*t.id, &t.name));
        let (kind, slug, _) = plugins
            .chain(themes)
            .filter(|(_, _, name)| name.len() > 2 && text.contains(name.as_str()))
            .max_by_key(|(_, _, name)| name.len())?;
        self.package_icon(kind, slug)
    }

    /// Every cached image, `plugin/akismet` to when it was saved, so the
    /// window reads each one again only when it changed.
    pub fn package_icons(&self) -> BTreeMap<String, i64> {
        let mut out = BTreeMap::new();
        for (kind, name) in [(Kind::Plugin, "plugin"), (Kind::Theme, "theme")] {
            let Ok(dir) = std::fs::read_dir(self.home.join("wporg").join(kind.dir())) else {
                continue;
            };
            for entry in dir.flatten() {
                let slug = entry.file_name().to_string_lossy().into_owned();
                let Ok(meta) = entry.metadata() else { continue };
                let Some(at) = meta
                    .modified()
                    .ok()
                    .and_then(|t| t.duration_since(SystemTime::UNIX_EPOCH).ok())
                else {
                    continue;
                };
                if valid(&slug) && meta.len() > 0 {
                    out.insert(format!("{name}/{slug}"), at.as_secs() as i64);
                }
            }
        }
        out
    }

    /// Look up the plugins and themes the sites run that are new or a week
    /// old, and cache their images. Never fails; offline it stops and the
    /// cache stays. One run at a time.
    pub(crate) async fn refresh_package_icons(&self) {
        let Ok(_one) = self.wporg.try_lock() else {
            return;
        };
        let Ok(all) = self.inventories() else { return };
        let mut want = BTreeSet::new();
        for i in &all {
            want.extend(
                i.inventory
                    .plugins
                    .iter()
                    .map(|p| (Kind::Plugin, plugin_slug(&p.id))),
            );
            want.extend(i.inventory.themes.iter().map(|t| (Kind::Theme, &*t.id)));
        }
        let mut saved = false;
        for kind in [Kind::Plugin, Kind::Theme] {
            let due: Vec<&str> = want
                .iter()
                .filter(|(k, s)| *k == kind && valid(s) && due(&path(&self.home, kind, s)))
                .map(|(_, s)| *s)
                .collect();
            for slugs in due.chunks(BATCH) {
                let Some(found) = self.lookup(kind, slugs).await else {
                    break;
                };
                for slug in slugs {
                    let url = found.get(*slug).and_then(|v| image_url(kind, v));
                    saved |= self.cache_image(kind, slug, url).await;
                }
            }
        }
        if saved {
            let _ = self.changed.send(Changed::Inventory);
        }
    }

    /// Cache the plugin search's icons it doesn't have yet (the answer carries
    /// them, so no lookup).
    pub(crate) async fn cache_found_icons(&self, answer: &Value) {
        let mut saved = false;
        for p in answer["plugins"].as_array().into_iter().flatten() {
            let slug = p["slug"].as_str().unwrap_or_default();
            if valid(slug) && due(&path(&self.home, Kind::Plugin, slug)) {
                saved |= self
                    .cache_image(Kind::Plugin, slug, image_url(Kind::Plugin, p))
                    .await;
            }
        }
        if saved {
            let _ = self.changed.send(Changed::Inventory);
        }
    }

    /// One batch of slugs from WordPress.org: slug to its info, or to an
    /// `error` when it isn't in the directory. None when it didn't answer.
    async fn lookup(&self, kind: Kind, slugs: &[&str]) -> Option<Map<String, Value>> {
        let (action, fields) = match kind {
            Kind::Plugin => ("plugin_information", &PLUGIN_FIELDS[..]),
            Kind::Theme => ("theme_information", &THEME_FIELDS[..]),
        };
        let url = format!("{}/{}/info/1.2/", self.feeds.wordpress_org, kind.dir());
        let slugs = slugs.join(",");
        let reply = net::send(&self.limits, "api.wordpress.org", Retry::ReadOnly, || {
            self.http
                .get(&url)
                .query(&[("action", action), ("request[slugs]", &slugs)])
                .query(fields)
        })
        .await
        .ok()?;
        match reply.json::<Value>()? {
            Value::Object(found) if reply.status == 200 => Some(found),
            _ => None,
        }
    }

    /// Save the image at `url`, or a miss when there is none. When the image
    /// host fails, the old file stays (or a miss is saved) and waits a week.
    /// True when a new image was saved.
    async fn cache_image(&self, kind: Kind, slug: &str, url: Option<Url>) -> bool {
        let file = path(&self.home, kind, slug);
        let image = match &url {
            Some(url) => self.wporg_image(url).await,
            None => None,
        };
        match image {
            Some(data) => save(&file, &data).is_ok(),
            None if url.is_some() && file.exists() => {
                // shortcut: a failed image host waits a week like a miss, retried sooner only when the slug changes.
                let _ = std::fs::File::options()
                    .append(true)
                    .open(&file)
                    .and_then(|f| f.set_modified(SystemTime::now()));
                false
            }
            None => {
                let _ = save(&file, "");
                false
            }
        }
    }

    /// The image as a `data:` URL, if it is one under the cap.
    async fn wporg_image(&self, url: &Url) -> Option<String> {
        let host = url.host_str()?;
        if !IMAGE_HOSTS.contains(&host) || url.scheme() != "https" {
            return None;
        }
        // Tests serve the image hosts' paths from a local server.
        let to = match &self.feeds.wordpress_org_images {
            Some(base) => {
                let mut to = Url::parse(base).ok()?.join(url.path()).ok()?;
                to.set_query(url.query());
                to
            }
            None => url.clone(),
        };
        let (_, body) = self.get_capped(host, to, CAP).await?;
        if body.len() > CAP {
            return None;
        }
        let mime = image_mime(&body[..body.len().min(1024)])?;
        Some(format!("data:{mime};base64,{}", STANDARD.encode(&body)))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::{Arc, Mutex};

    use rusqlite::params;
    use serde_json::json;

    use crate::Options;
    use crate::fleet::Item;
    use crate::security::Feeds;
    use crate::sites::{self, Details, Mode, NewSite};

    // Recorded from api.wordpress.org on 2026-10-28 with the queries `lookup` sends.
    const PLUGINS: &str = include_str!("../tests/fixtures/wporg/plugins.json");
    const THEMES: &str = include_str!("../tests/fixtures/wporg/themes.json");
    const PNG: &[u8] = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR";
    const GIF: &[u8] = b"GIF89a\x01\0\x01\0";
    const SVG: &[u8] = b"<svg xmlns='http://www.w3.org/2000/svg'/>";

    #[test]
    fn slugs() {
        assert_eq!(plugin_slug("akismet/akismet.php"), "akismet");
        assert_eq!(plugin_slug("hello.php"), "hello-dolly");
        assert_eq!(plugin_slug("single.php"), "single");
        assert!(valid("classic-editor") && valid("wp_mail") && valid("twentytwentyfive"));
        for bad in ["", "../x", "a/b", "Bricks", "a.b", "a b", &"a".repeat(101)] {
            assert!(!valid(bad), "{bad}");
        }
    }

    #[test]
    fn images_from_the_answer_on_wordpress_org_hosts_only() {
        let plugins: Value = serde_json::from_str(PLUGINS).unwrap();
        let themes: Value = serde_json::from_str(THEMES).unwrap();
        let url = |k, v: &Value| image_url(k, v).map(|u| u.to_string());
        // svg, then 2x, then 1x.
        assert_eq!(
            url(Kind::Plugin, &plugins["woocommerce"]).as_deref(),
            Some("https://ps.w.org/woocommerce/assets/icon.svg?rev=3640790")
        );
        assert_eq!(
            url(Kind::Plugin, &plugins["akismet"]).as_deref(),
            Some("https://ps.w.org/akismet/assets/icon-256x256.png?rev=2818463")
        );
        assert_eq!(
            url(
                Kind::Plugin,
                &json!({"icons": {"1x": "https://ps.w.org/a/icon-128x128.png"}})
            ),
            Some("https://ps.w.org/a/icon-128x128.png".into())
        );
        assert_eq!(url(Kind::Plugin, &plugins["bricks"]), None);
        // The generated pattern is not the plugin's icon.
        assert_eq!(
            url(
                Kind::Plugin,
                &json!({"icons": {"default": "https://s.w.org/plugins/geopattern-icon/a.svg"}})
            ),
            None
        );
        // Protocol-relative screenshots go over https.
        assert_eq!(
            url(Kind::Theme, &themes["twentytwentyfive"]).as_deref(),
            Some("https://ts.w.org/wp-content/themes/twentytwentyfive/screenshot.png?ver=1.5")
        );
        assert_eq!(url(Kind::Theme, &themes["bricks"]), None);
        for other in [
            "http://ps.w.org/a.png",
            "https://ps.w.org.evil.test/a.png",
            "https://evil.test/ps.w.org/a.png",
            "https://mc-a.test/wp-content/uploads/icon.png",
            "data:image/png;base64,AA==",
            "//evil.test/a.png",
        ] {
            assert_eq!(
                url(Kind::Plugin, &json!({"icons": {"svg": other}})),
                None,
                "{other}"
            );
            assert_eq!(
                url(Kind::Theme, &json!({"screenshot_url": other})),
                None,
                "{other}"
            );
        }
    }

    /// WordPress.org: the recorded answers for the lookups (only the asked
    /// slugs kept), images by path, and a count of lookups. `down` answers 503.
    struct Org {
        url: String,
        lookups: Arc<AtomicUsize>,
        down: Arc<Mutex<bool>>,
        asked: Arc<Mutex<Vec<String>>>,
    }

    async fn org() -> Org {
        use axum::extract::Query;
        use axum::http::{StatusCode, Uri, header};
        use axum::response::IntoResponse;
        let lookups = Arc::new(AtomicUsize::new(0));
        let down = Arc::new(Mutex::new(false));
        let asked = Arc::new(Mutex::new(Vec::new()));
        let images: HashMap<&str, &[u8]> = HashMap::from([
            ("/akismet/assets/icon-256x256.png", PNG),
            ("/classic-editor/assets/icon-256x256.png", PNG),
            ("/elementor/assets/icon-256x256.gif", GIF),
            ("/woocommerce/assets/icon.svg", SVG),
            ("/wp-content/themes/twentytwentyfive/screenshot.png", PNG),
            ("/wp-content/themes/twentytwentyfour/screenshot.png", PNG),
        ]);
        let answer = move |all: &'static str, q: HashMap<String, String>| {
            let all: Map<String, Value> = serde_json::from_str(all).unwrap();
            let want = q.get("request[slugs]").cloned().unwrap_or_default();
            let kept: Map<String, Value> = want
                .split(',')
                .map(|s| {
                    (
                        s.to_string(),
                        all.get(s)
                            .cloned()
                            .unwrap_or(json!({"error": "Not found."})),
                    )
                })
                .collect();
            axum::Json(Value::Object(kept))
        };
        let (l, d, a) = (lookups.clone(), down.clone(), asked.clone());
        let app = axum::Router::new()
            .route(
                "/{kind}/info/1.2/",
                axum::routing::get(
                    move |axum::extract::Path(kind): axum::extract::Path<String>,
                          Query(q): Query<HashMap<String, String>>| {
                        let (l, d, a) = (l.clone(), d.clone(), a.clone());
                        async move {
                            if *d.lock().unwrap() {
                                return StatusCode::SERVICE_UNAVAILABLE.into_response();
                            }
                            l.fetch_add(1, Ordering::SeqCst);
                            a.lock()
                                .unwrap()
                                .push(format!("{kind}:{}", q["request[slugs]"]));
                            assert_eq!(
                                q.get("request[fields][sections]").map(String::as_str),
                                Some("0")
                            );
                            let all = if kind == "plugins" { PLUGINS } else { THEMES };
                            answer(all, q).into_response()
                        }
                    },
                ),
            )
            .fallback(move |uri: Uri| async move {
                match images.get(uri.path()) {
                    Some(body) => {
                        ([(header::CONTENT_TYPE, "image/png")], body.to_vec()).into_response()
                    }
                    None => StatusCode::NOT_FOUND.into_response(),
                }
            });
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        Org {
            url,
            lookups,
            down,
            asked,
        }
    }

    fn item(id: &str) -> Item {
        Item {
            id: id.into(),
            name: plugin_slug(id).into(),
            ..Default::default()
        }
    }

    #[tokio::test]
    async fn looked_up_cached_misses_kept_a_week_and_offline_kept() {
        let org = org().await;
        let home = tempfile::tempdir().unwrap();
        let opts = Options {
            keychain: Ok(keyring_core::mock::Store::new().unwrap()),
            feeds: Feeds {
                wordpress_org: org.url.clone(),
                wordpress_org_images: Some(org.url.clone()),
                ..Default::default()
            },
            ..Default::default()
        };
        let core = Core::start(home.path(), opts).await.unwrap();
        let id = core
            .db(|c| {
                sites::insert(
                    c,
                    &NewSite {
                        url: "https://mc-a.test",
                        mode: Mode::Basic,
                        api_url: "https://mc-a.test/wp-json/",
                        oauth: None,
                        username: Some("admin"),
                    },
                    &Details::default(),
                )
            })
            .unwrap();
        let inv = Inventory {
            plugins: [
                "akismet/akismet.php",
                "bricks/bricks.php",
                "classic-editor/classic-editor.php",
                "classic-monks-pro/classic-monks-pro.php",
                "elementor/elementor.php",
                "woocommerce/woocommerce.php",
                "woocommerce-subscriptions/woocommerce-subscriptions.php",
                // Never asked: not a directory slug.
                "My Plugin/x.php",
            ]
            .map(item)
            .into(),
            themes: ["bricks", "twentytwentyfive", "twentytwentyfour"]
                .map(item)
                .into(),
            ..Default::default()
        };
        core.db(|c| {
            c.execute(
                "INSERT INTO inventory (site_id, snapshot, fetched_at) VALUES (?1, ?2, unixepoch())",
                params![id, serde_json::to_string(&inv).unwrap()],
            )
        })
        .unwrap();
        let mut events = core.changed.subscribe();

        core.refresh_package_icons().await;
        assert_eq!(org.lookups.load(Ordering::SeqCst), 2, "one batch per kind");
        assert_eq!(
            *org.asked.lock().unwrap(),
            [
                "plugins:akismet,bricks,classic-editor,classic-monks-pro,elementor,woocommerce,woocommerce-subscriptions",
                "themes:bricks,twentytwentyfive,twentytwentyfour",
            ]
        );
        assert!(matches!(events.recv().await, Ok(Changed::Inventory)));
        let icon = |k, s| core.package_icon(k, s).unwrap_or_default();
        assert!(icon(Kind::Plugin, "woocommerce").starts_with("data:image/svg+xml;base64,"));
        assert!(icon(Kind::Plugin, "akismet").starts_with("data:image/png;base64,"));
        assert!(icon(Kind::Plugin, "elementor").starts_with("data:image/gif;base64,"));
        assert!(icon(Kind::Theme, "twentytwentyfive").starts_with("data:image/png;base64,"));
        for (k, s) in [
            (Kind::Plugin, "bricks"),
            (Kind::Plugin, "classic-monks-pro"),
            (Kind::Plugin, "woocommerce-subscriptions"),
            (Kind::Theme, "bricks"),
        ] {
            assert_eq!(core.package_icon(k, s), None, "{s}");
            assert!(path(&core.home, k, s).exists(), "the miss is kept: {s}");
        }
        assert_eq!(
            core.package_icon(Kind::Plugin, "../wporg/plugins/akismet"),
            None
        );
        let listed = core.package_icons();
        assert_eq!(
            listed.keys().collect::<Vec<_>>(),
            [
                "plugin/akismet",
                "plugin/classic-editor",
                "plugin/elementor",
                "plugin/woocommerce",
                "theme/twentytwentyfive",
                "theme/twentytwentyfour",
            ]
        );

        // A sentence naming one (the reports' work rows); the longest name wins.
        let named = |t| core.icon_named(&inv, t).unwrap_or_default();
        assert!(named("Update woocommerce").starts_with("data:image/svg+xml"));
        assert!(named("Update elementor/elementor.php").starts_with("data:image/gif"));
        assert_eq!(core.icon_named(&inv, "Update bricks/bricks.php"), None);
        assert_eq!(core.icon_named(&inv, "Turned on AI agent access"), None);

        // Within the week nothing is asked again, misses included.
        core.refresh_package_icons().await;
        assert_eq!(org.lookups.load(Ordering::SeqCst), 2);

        // A week on: asked again. Offline, the cache stays as it was.
        let week_ago = SystemTime::now() - WEEK - Duration::from_secs(60);
        for (k, s) in [(Kind::Plugin, "akismet"), (Kind::Plugin, "bricks")] {
            std::fs::File::options()
                .append(true)
                .open(path(&core.home, k, s))
                .unwrap()
                .set_modified(week_ago)
                .unwrap();
        }
        *org.down.lock().unwrap() = true;
        core.refresh_package_icons().await;
        assert_eq!(org.lookups.load(Ordering::SeqCst), 2);
        assert!(icon(Kind::Plugin, "akismet").starts_with("data:image/png"));
        assert!(due(&path(&core.home, Kind::Plugin, "akismet")));
        *org.down.lock().unwrap() = false;
        core.refresh_package_icons().await;
        assert_eq!(org.lookups.load(Ordering::SeqCst), 3);
        assert_eq!(org.asked.lock().unwrap()[2], "plugins:akismet,bricks");
        assert!(!due(&path(&core.home, Kind::Plugin, "bricks")));

        // The search's answer carries icons: cached with no lookup.
        let answer = json!({"plugins": [
            {"slug": "classic-editor", "icons": {"2x": "https://ps.w.org/classic-editor/assets/icon-256x256.png"}},
            {"slug": "new-one", "icons": {"svg": "https://ps.w.org/woocommerce/assets/icon.svg"}},
            {"slug": "elsewhere", "icons": {"svg": "https://evil.test/i.svg"}},
        ]});
        core.cache_found_icons(&answer).await;
        assert_eq!(org.lookups.load(Ordering::SeqCst), 3);
        assert!(icon(Kind::Plugin, "new-one").starts_with("data:image/svg+xml"));
        assert_eq!(core.package_icon(Kind::Plugin, "elsewhere"), None);
    }
}
