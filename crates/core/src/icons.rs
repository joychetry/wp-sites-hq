// SPDX-License-Identifier: GPL-3.0-or-later
//! Site icons (favicons) for the site tiles. Found on every check, cached as a
//! `data:` URL in `<data>/icons/<site id>`. A failed fetch keeps the old one.

use std::path::{Path, PathBuf};
use std::time::Duration;

use base64::Engine;
use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use reqwest::Url;
use reqwest::header::{HeaderMap, LINK};
use serde_json::Value;
use sha2::{Digest, Sha256};

use crate::Core;
use crate::connect::{rest_root_from_link, rest_url};
use crate::sites::{self, Site};

/// A bigger body is not an icon.
const CAP: usize = 256 * 1024;
/// Per request, well under the client's 30 s, so a check never waits long.
const WAIT: Duration = Duration::from_secs(8);

fn path(home: &Path, id: i64) -> PathBuf {
    home.join("icons").join(id.to_string())
}

impl Core {
    /// The site's cached icon as a `data:` URL.
    pub fn site_icon(&self, id: i64) -> Option<String> {
        std::fs::read_to_string(path(&self.home, id)).ok()
    }

    /// Delete the site's cached icon.
    pub(crate) fn forget_icon(&self, id: i64) {
        let _ = std::fs::remove_file(path(&self.home, id));
    }

    /// Fetch the site's icon and cache it: WordPress's site icon, else the home
    /// page's `<link rel="icon">`, else `/favicon.ico`. Never fails.
    pub(crate) async fn refresh_icon(&self, site: &Site) {
        let Ok(home) = Url::parse(&site.url) else {
            return;
        };
        for url in self.icon_candidates(site, &home).await {
            // WordPress keeps its icons in its own uploads: another host is refused.
            if url.host_str() != home.host_str() || !matches!(url.scheme(), "http" | "https") {
                continue;
            }
            let Some((_, body)) = self.get_capped(&site.url, url).await else {
                continue;
            };
            let Some(mime) = image_mime(&body) else {
                continue;
            };
            let key = URL_SAFE_NO_PAD.encode(&Sha256::digest(&body)[..9]);
            let file = path(&self.home, site.id);
            if site.icon.as_deref() == Some(key.as_str()) && file.exists() {
                return;
            }
            if save(
                &file,
                &format!("data:{mime};base64,{}", STANDARD.encode(&body)),
            )
            .is_err()
            {
                return;
            }
            match self.db(|c| sites::set_icon(c, site.id, &key)) {
                Ok(true) => self.notify(),
                // Removed while this ran.
                _ => self.forget_icon(site.id),
            }
            return;
        }
    }

    /// Where the icon may be, best first.
    async fn icon_candidates(&self, site: &Site, home: &Url) -> Vec<Url> {
        // Relative links resolve against the home page, `/blog/` not `/`.
        let base = Url::parse(&format!("{}/", sites::url_string(home))).unwrap_or(home.clone());
        let page = self.get_capped(&site.url, home.clone()).await;
        let root = page
            .as_ref()
            .and_then(|(h, _)| {
                rest_root_from_link(home, h.get_all(LINK).iter().filter_map(|v| v.to_str().ok()))
            })
            .unwrap_or_else(|| format!("{}/wp-json/", sites::url_string(home)));
        let mut found = Vec::new();
        // The full index is megabytes: ask for the one field.
        if let Ok(mut index) = Url::parse(&rest_url(&root, "/")) {
            index
                .query_pairs_mut()
                .append_pair("_fields", "site_icon_url");
            if let Some((_, body)) = self.get_capped(&site.url, index).await
                && let Ok(json) = serde_json::from_slice::<Value>(&body)
                && let Some(url) = site_icon_url(&json).and_then(|u| base.join(u).ok())
            {
                found.push(url);
            }
        }
        if let Some((_, body)) = &page {
            found.extend(icon_links(&String::from_utf8_lossy(body), &base));
        }
        found.extend(home.join("/favicon.ico").ok());
        found
    }

    /// GET with no credentials under the site's request limits. At most `CAP + 1`
    /// bytes are read; None unless it answered 200.
    async fn get_capped(&self, key: &str, url: Url) -> Option<(HeaderMap, Vec<u8>)> {
        let _permits = self.limits.acquire(key).await;
        let mut resp = self.http.get(url).timeout(WAIT).send().await.ok()?;
        if resp.status() != reqwest::StatusCode::OK {
            return None;
        }
        let headers = std::mem::take(resp.headers_mut());
        let mut body = Vec::new();
        while body.len() <= CAP
            && let Some(chunk) = resp.chunk().await.ok()?
        {
            body.extend_from_slice(&chunk);
        }
        Some((headers, body))
    }
}

/// Write through a temporary file, so a reader never sees half an icon.
fn save(file: &Path, data_url: &str) -> std::io::Result<()> {
    std::fs::create_dir_all(file.parent().expect("in icons/"))?;
    let tmp = file.with_extension("tmp");
    std::fs::write(&tmp, data_url)?;
    std::fs::rename(&tmp, file)
}

/// `site_icon_url` from the REST index, when set.
fn site_icon_url(index: &Value) -> Option<&str> {
    index["site_icon_url"]
        .as_str()
        .filter(|u| !u.trim().is_empty())
}

/// The `<head>`'s icon links resolved against `base`: `icon` and `shortcut icon`
/// first, then `apple-touch-icon`.
fn icon_links(html: &str, base: &Url) -> Vec<Url> {
    // ASCII lowercasing keeps byte offsets, so `lower` indexes `html`.
    let lower = html.to_ascii_lowercase();
    let head = &lower[..lower.find("</head").unwrap_or(lower.len())];
    let (mut icons, mut touch) = (Vec::new(), Vec::new());
    let mut at = 0;
    while let Some(i) = head[at..].find("<link") {
        let start = at + i;
        let end = head[start..].find('>').map_or(head.len(), |e| start + e);
        at = end;
        let tag = &html[start..end];
        let rel = attr(tag, "rel").unwrap_or_default().to_ascii_lowercase();
        let Some(url) = attr(tag, "href").and_then(|h| base.join(&h.replace("&amp;", "&")).ok())
        else {
            continue;
        };
        let mut rels = rel.split_ascii_whitespace();
        if rels.clone().any(|r| r == "icon") {
            icons.push(url);
        } else if rels.any(|r| r.starts_with("apple-touch-icon")) {
            touch.push(url);
        }
    }
    icons.extend(touch);
    icons
}

/// An attribute's value in a tag, quoted or bare.
fn attr<'a>(tag: &'a str, name: &str) -> Option<&'a str> {
    let lower = tag.to_ascii_lowercase();
    let mut from = 0;
    while let Some(i) = lower[from..].find(name) {
        let at = from + i;
        from = at + name.len();
        // `data-rel=` is not `rel=`.
        if !lower[..at].ends_with(|c: char| c.is_ascii_whitespace()) {
            continue;
        }
        let Some(rest) = lower[from..].trim_start().strip_prefix('=') else {
            continue;
        };
        let value = &tag[tag.len() - rest.trim_start().len()..];
        return Some(match value.chars().next() {
            Some(q @ ('"' | '\'')) => value[1..].split(q).next().unwrap_or_default(),
            _ => value
                .split(|c: char| c.is_ascii_whitespace())
                .next()
                .unwrap_or_default(),
        });
    }
    None
}

/// The image type the bytes start with. None: not an icon (or over the cap).
fn image_mime(body: &[u8]) -> Option<&'static str> {
    if body.is_empty() || body.len() > CAP {
        return None;
    }
    let head = &body[..body.len().min(1024)];
    Some(if head.starts_with(b"\x89PNG\r\n\x1a\n") {
        "image/png"
    } else if head.starts_with(&[0, 0, 1, 0]) {
        "image/x-icon"
    } else if head.starts_with(b"GIF87a") || head.starts_with(b"GIF89a") {
        "image/gif"
    } else if head.starts_with(&[0xff, 0xd8, 0xff]) {
        "image/jpeg"
    } else if head.len() >= 12 && head.starts_with(b"RIFF") && &head[8..12] == b"WEBP" {
        "image/webp"
    } else {
        let text = String::from_utf8_lossy(head).to_ascii_lowercase();
        let text = text.trim_start_matches('\u{feff}').trim_start();
        if !(text.starts_with('<') && text.contains("<svg") && !text.contains("<html")) {
            return None;
        }
        "image/svg+xml"
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::collections::HashMap;
    use std::sync::{Arc, Mutex};

    use crate::Options;
    use crate::sites::{Details, Mode, NewSite};

    const PNG: &[u8] = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR";
    const ICO: &[u8] = &[0, 0, 1, 0, 1, 0, 16, 16];

    #[test]
    fn site_icon_url_only_when_set() {
        let url = serde_json::json!({ "site_icon": 7, "site_icon_url": "https://a.test/i.png" });
        assert_eq!(site_icon_url(&url), Some("https://a.test/i.png"));
        assert_eq!(
            site_icon_url(&serde_json::json!({ "site_icon": 0, "site_icon_url": "" })),
            None
        );
        // Older WordPress: only the attachment id.
        assert_eq!(site_icon_url(&serde_json::json!({ "site_icon": 7 })), None);
    }

    #[test]
    fn icon_links_in_the_head() {
        let base = Url::parse("https://a.test/blog/").unwrap();
        let html = r#"<!doctype html><HTML><head>
            <link rel="stylesheet" href="/s.css">
            <LINK REL="Apple-Touch-Icon" HREF="touch.png">
            <link data-rel="icon" href="/no.png">
            <link href='/f.ico?v=1&amp;x=2' rel='shortcut icon'>
            <link rel=icon sizes=32x32 href=https://a.test/up/i-32.png>
            <link rel="icon">
            </head><body><link rel="icon" href="/body.png"></body>"#;
        let links: Vec<String> = icon_links(html, &base).iter().map(Url::to_string).collect();
        assert_eq!(
            links,
            [
                "https://a.test/f.ico?v=1&x=2",
                "https://a.test/up/i-32.png",
                "https://a.test/blog/touch.png",
            ]
        );
        assert!(icon_links("<html><head><title>x</title></head>", &base).is_empty());
        assert!(icon_links("", &base).is_empty());
    }

    #[test]
    fn only_images_under_the_cap() {
        assert_eq!(image_mime(PNG), Some("image/png"));
        assert_eq!(image_mime(ICO), Some("image/x-icon"));
        assert_eq!(image_mime(b"GIF89a\x01\0"), Some("image/gif"));
        assert_eq!(image_mime(&[0xff, 0xd8, 0xff, 0xe0]), Some("image/jpeg"));
        assert_eq!(image_mime(b"RIFF\0\0\0\0WEBPVP8 "), Some("image/webp"));
        assert_eq!(
            image_mime(
                b"\xef\xbb\xbf<?xml version=\"1.0\"?>\n<svg xmlns=\"http://www.w3.org/2000/svg\"/>"
            ),
            Some("image/svg+xml")
        );
        assert_eq!(image_mime(b"<!doctype html><html><svg></svg>"), None);
        assert_eq!(image_mime(b"{\"code\":\"rest_no_route\"}"), None);
        assert_eq!(image_mime(b""), None);
        let mut big = PNG.to_vec();
        big.resize(CAP + 1, 0);
        assert_eq!(image_mime(&big), None);
    }

    type Files = Arc<Mutex<HashMap<String, (&'static str, Vec<u8>)>>>;

    /// A site serving `files` by path; anything else is a 404.
    async fn server(files: Files) -> String {
        use axum::http::{StatusCode, Uri, header};
        use axum::response::IntoResponse;
        let app = axum::Router::new().fallback(move |uri: Uri| {
            let files = files.clone();
            async move {
                match files.lock().unwrap().get(uri.path()) {
                    Some((ct, body)) => {
                        ([(header::CONTENT_TYPE, *ct)], body.clone()).into_response()
                    }
                    None => StatusCode::NOT_FOUND.into_response(),
                }
            }
        });
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        url
    }

    #[tokio::test]
    async fn found_in_order_cached_kept_and_deleted() {
        let home = tempfile::tempdir().unwrap();
        let opts = Options {
            keychain: Ok(keyring_core::mock::Store::new().unwrap()),
            ..Default::default()
        };
        let core = Core::start(home.path(), opts).await.unwrap();
        let files: Files = Default::default();
        let url = server(files.clone()).await;
        let id = core
            .db(|c| {
                sites::insert(
                    c,
                    &NewSite {
                        url: &url,
                        mode: Mode::Basic,
                        api_url: &format!("{url}/wp-json/"),
                        oauth: None,
                        username: Some("admin"),
                    },
                    &Details::default(),
                )
            })
            .unwrap();
        let port = url.rsplit(':').next().unwrap();
        let set = |path: &str, ct, body: Vec<u8>| {
            files.lock().unwrap().insert(path.into(), (ct, body));
        };
        let html =
            r#"<head><link rel="icon" href="/icon.svg"><link rel="icon" href="/big.png"></head>"#;
        set("/", "text/html", html.into());
        set(
            "/wp-json/",
            "application/json",
            br#"{"site_icon_url":"/wp-content/uploads/i.png"}"#.into(),
        );
        set(
            "/wp-content/uploads/i.png",
            "image/png",
            [PNG, b"wp"].concat(),
        );
        set(
            "/icon.svg",
            "image/svg+xml",
            b"<svg xmlns='http://www.w3.org/2000/svg'/>".into(),
        );
        set("/favicon.ico", "image/x-icon", ICO.into());
        let mut big = PNG.to_vec();
        big.resize(CAP + 10, 0);
        set("/big.png", "image/png", big);
        let refresh = async |want: &str| {
            let site = core.site(id).unwrap();
            core.refresh_icon(&site).await;
            let icon = core.site_icon(id).unwrap_or_default();
            assert!(icon.starts_with(want), "{want}: {icon:.40}");
            core.site(id).unwrap().icon
        };

        // WordPress's site icon first.
        let wp = refresh("data:image/png;base64,").await;
        assert!(wp.is_some());
        assert_eq!(refresh("data:image/png").await, wp, "same bytes, same key");

        // On another host: refused, so the page's link.
        set(
            "/wp-json/",
            "application/json",
            format!(r#"{{"site_icon_url":"http://localhost:{port}/wp-content/uploads/i.png"}}"#)
                .into_bytes(),
        );
        let svg = refresh("data:image/svg+xml;base64,").await;
        assert_ne!(svg, wp);

        // Not an image, then too big: /favicon.ico.
        set(
            "/icon.svg",
            "image/svg+xml",
            b"<html>not found</html>".into(),
        );
        refresh("data:image/x-icon;base64,").await;

        // Nothing answers: the old icon stays.
        files.lock().unwrap().clear();
        let kept = core.site(id).unwrap().icon;
        assert_eq!(refresh("data:image/x-icon;base64,").await, kept);

        core.remove_site(id).await.unwrap();
        assert!(core.site_icon(id).is_none());
        assert!(!path(&core.home, id).exists());
    }
}
