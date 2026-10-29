// SPDX-License-Identifier: GPL-3.0-or-later
//! A site's media library (plan "media and editor", part 1): list it with filters,
//! upload files the person picked in the window, change an item's details,
//! replace its file (and put the earlier one back), move items to the trash.
//!
//! Uploads and replaces go to Classic Monks in chunks (`upload-media`,
//! `replace-media`, the protocol `install-zip` uses), with progress and a way
//! to stop. Basic mode lists, uploads in one request and changes details over
//! core REST; replace, trash and usage need Classic Monks. Files come only as
//! bytes from the window: no tool here takes a path, and none is an agent tool.

use std::collections::BTreeMap;
use std::sync::atomic::{AtomicBool, Ordering};

use base64::Engine;
use reqwest::Method;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::Core;
use crate::connect::{SiteError, plain};
use crate::content::{Body, local, text};
use crate::fleet::has_tool;
use crate::sites::{Mode, Site};

const PAGE: u32 = 30;
/// Bytes per chunk, under the site's 2 MB a call (as `install-zip`).
const CHUNK: usize = 1024 * 1024;
/// shortcut: the window sends the whole file at once, so it sits in memory; stream chunks from the window if larger files are needed.
pub const MAX_FILE: usize = 256 * 1024 * 1024;

pub const NEEDS_CM_MEDIA: &str = "Replacing files needs Monks Central, Classic Monks or Classic Monks Pro on the site, and the media trash Classic Monks Pro. This site is in Basic mode.";
pub const OLD_CM_MEDIA: &str = "This site's Classic Monks is older and can't do this yet. Update Classic Monks on the site, then check it again.";
pub const STOPPED: &str = "Stopped. Nothing was added.";

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct Media {
    pub id: i64,
    pub title: String,
    pub url: String,
    pub mime: String,
    pub alt: String,
    /// The site's local time, "2026-10-28 09:30:00".
    pub date: String,
    pub caption: String,
    pub description: String,
    pub file_name: String,
    pub author: String,
    pub width: u32,
    pub height: u32,
    /// Bytes on the site; 0 when not known.
    pub size: u64,
    /// A small version for the grid, or the file itself.
    pub thumb: String,
    /// Entries that use it, when it was asked for and the site can tell.
    pub usage: Option<u64>,
}

/// One page of the library, and what the site takes.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct Library {
    pub items: Vec<Media>,
    pub total: u64,
    /// Extensions ("jpg|jpeg|jpe") to MIME types; empty when not known (Basic mode).
    pub allowed: BTreeMap<String, String>,
    /// The largest upload in bytes; 0 when not known.
    pub limit: u64,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct MediaQuery {
    pub page: Option<u32>,
    pub search: Option<String>,
    /// image, video, audio or application (documents).
    pub kind: Option<String>,
    /// "2026-10".
    pub month: Option<String>,
    /// One item, by id.
    pub id: Option<i64>,
    /// Count the entries using each item (Classic Monks only).
    #[serde(default)]
    pub usage: bool,
}

/// Details to change; missing ones stay as they are.
#[derive(Debug, Clone, Default, Deserialize, Serialize)]
pub struct Details {
    pub alt: Option<String>,
    pub title: Option<String>,
    pub caption: Option<String>,
    pub description: Option<String>,
}

impl Details {
    fn is_empty(&self) -> bool {
        [&self.alt, &self.title, &self.caption, &self.description]
            .iter()
            .all(|f| f.is_none())
    }
}

/// What the trash and restore did.
#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize)]
pub struct Moved {
    pub done: Vec<i64>,
    /// Items left as they were, and why.
    pub skipped: Vec<(i64, String)>,
}

fn media_from(m: &Value, rest: bool) -> Media {
    let num = |v: &Value| v.as_u64().unwrap_or_default();
    if rest {
        let d = &m["media_details"];
        return Media {
            id: m["id"].as_i64().unwrap_or_default(),
            title: text(&m["title"]),
            url: text(&m["source_url"]),
            mime: text(&m["mime_type"]),
            alt: text(&m["alt_text"]),
            date: local(&m["date"]),
            caption: text(&m["caption"]),
            description: text(&m["description"]),
            file_name: text(&m["source_url"])
                .rsplit('/')
                .next()
                .unwrap_or_default()
                .into(),
            author: String::new(),
            width: num(&d["width"]) as u32,
            height: num(&d["height"]) as u32,
            size: num(&d["filesize"]),
            thumb: text(&d["sizes"]["thumbnail"]["source_url"]),
            usage: None,
        };
    }
    Media {
        id: m["id"].as_i64().unwrap_or_default(),
        title: text(&m["title"]),
        url: text(&m["url"]),
        mime: text(&m["mime_type"]),
        alt: text(&m["alt_text"]),
        date: text(&m["date"]),
        caption: text(&m["caption"]),
        description: text(&m["description"]),
        file_name: text(&m["file_name"]),
        author: text(&m["author"]),
        width: num(&m["width"]) as u32,
        height: num(&m["height"]) as u32,
        size: num(&m["file_size"]),
        thumb: text(&m["thumbnail"]),
        usage: m["usage"].as_u64(),
    }
}

/// "2026-10" -> the first and last moment of that month, for core REST.
fn month_range(m: &str) -> Option<(String, String)> {
    let (y, mo) = m.split_once('-')?;
    let (y, mo): (u32, u32) = (y.parse().ok()?, mo.parse().ok()?);
    if !(1..=12).contains(&mo) || y < 1970 {
        return None;
    }
    let (ny, nm) = if mo == 12 { (y + 1, 1) } else { (y, mo + 1) };
    Some((
        format!("{y:04}-{mo:02}-01T00:00:00"),
        format!("{ny:04}-{nm:02}-01T00:00:00"),
    ))
}

const KINDS: &[&str] = &["image", "video", "audio", "application"];

/// The file from the window, checked: base64 that decodes, not empty, not too big.
pub fn decode_file(data: &str) -> Result<Vec<u8>, SiteError> {
    if data.len() > MAX_FILE / 3 * 4 + 4 {
        return Err(plain(
            "Monks Central uploads files up to 256 MB. Upload larger ones in WordPress.",
        ));
    }
    let bytes = base64::engine::general_purpose::STANDARD
        .decode(data)
        .map_err(|_| plain("The file didn't arrive whole. Choose it again."))?;
    if bytes.is_empty() {
        return Err(plain("That file is empty."));
    }
    Ok(bytes)
}

/// A file name as the site should see it: the last part, no control characters, at most 200
/// characters with its type kept.
fn clean_name(name: &str) -> Result<String, SiteError> {
    let name: String = name
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or_default()
        .chars()
        .filter(|c| !c.is_control())
        .collect();
    let Some((stem, ext)) = name
        .rsplit_once('.')
        .filter(|(s, e)| !s.trim().is_empty() && !e.is_empty())
    else {
        return Err(plain("The file needs a name with a type, like photo.jpg."));
    };
    let ext: String = ext.chars().take(20).collect();
    let stem: String = stem.chars().take(200 - 1 - ext.chars().count()).collect();
    Ok(format!("{stem}.{ext}"))
}

/// "2026-1" -> "2026-01": the month as the site's get-media takes it.
fn month_param(m: &str) -> Option<String> {
    month_range(m).map(|(from, _)| from[..7].to_string())
}

impl Core {
    fn media_site(&self, id: i64, tool: &str) -> Result<Site, SiteError> {
        let site = self.site(id)?;
        match site.mode {
            Mode::Basic if tool != "upload-media" && tool != "update-media" => {
                Err(plain(NEEDS_CM_MEDIA))
            }
            Mode::ClassicMonks if !has_tool(&site, tool) => Err(plain(OLD_CM_MEDIA)),
            _ => Ok(site),
        }
    }

    /// One page of the media library, newest first.
    pub async fn media(&self, id: i64, q: &MediaQuery) -> Result<Library, SiteError> {
        let _work = self.working().await;
        self.media_inner(id, q).await
    }

    async fn media_inner(&self, id: i64, q: &MediaQuery) -> Result<Library, SiteError> {
        let site = self.content_site(id)?;
        let page = q.page.unwrap_or(1).max(1);
        let search = q.search.as_deref().unwrap_or_default().trim();
        let kind = q.kind.as_deref().filter(|k| KINDS.contains(k));
        let month = match q.month.as_deref().filter(|m| !m.is_empty()) {
            Some(m) => Some(month_param(m).ok_or_else(|| plain("Pick a month."))?),
            None => None,
        };
        match site.mode {
            Mode::ClassicMonks => {
                let mut args = json!({ "limit": PAGE, "offset": (page - 1).saturating_mul(PAGE), "usage": q.usage });
                if let Some(k) = kind {
                    args["mime_type"] = k.into();
                }
                if !search.is_empty() {
                    args["search"] = search.into();
                }
                if let Some(m) = &month {
                    args["month"] = m.as_str().into();
                }
                if let Some(i) = q.id {
                    args["id"] = i.into();
                }
                let v = self.call_ability_inner(id, "get-media", args).await?;
                Ok(Library {
                    items: v["media"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .map(|m| media_from(m, false))
                        .collect(),
                    total: v["total"].as_u64().unwrap_or_default(),
                    allowed: v["allowed_types"]
                        .as_object()
                        .into_iter()
                        .flatten()
                        .map(|(k, v)| (k.clone(), text(v)))
                        .collect(),
                    limit: v["upload_limit"].as_u64().unwrap_or_default(),
                })
            }
            Mode::Basic => {
                let mut query = vec![
                    ("per_page", PAGE.to_string()),
                    ("page", page.to_string()),
                    ("context", "edit".to_string()),
                ];
                if let Some(k) = kind {
                    query.push(("media_type", k.into()));
                }
                if !search.is_empty() {
                    query.push(("search", search.into()));
                }
                if let Some((after, before)) = month.as_deref().and_then(month_range) {
                    query.push(("after", after));
                    query.push(("before", before));
                }
                if let Some(i) = q.id {
                    query.push(("include", i.to_string()));
                }
                let reply = self
                    .rest(&site, Method::GET, "/wp/v2/media", &query, Body::None)
                    .await?;
                // Past the last page core REST answers 400; that is an empty page. A 400 on the
                // first page is the site's own refusal and is shown.
                if reply.status == 400 && page > 1 {
                    return Ok(Library::default());
                }
                let (v, reply) = self.answer(&site, reply)?;
                let total = reply
                    .headers
                    .get("x-wp-total")
                    .and_then(|h| h.to_str().ok()?.parse().ok())
                    .unwrap_or_default();
                Ok(Library {
                    items: v
                        .as_array()
                        .into_iter()
                        .flatten()
                        .map(|m| media_from(m, true))
                        .collect(),
                    total,
                    ..Default::default()
                })
            }
        }
    }

    /// One item with its usage, as the details panel shows it.
    pub async fn media_item(&self, id: i64, media_id: i64) -> Result<Media, SiteError> {
        let _work = self.working().await;
        self.media_one(id, media_id).await
    }

    async fn media_one(&self, id: i64, media_id: i64) -> Result<Media, SiteError> {
        let q = MediaQuery {
            id: Some(media_id),
            usage: true,
            ..Default::default()
        };
        self.media_inner(id, &q)
            .await?
            .items
            .into_iter()
            .find(|m| m.id == media_id)
            .ok_or_else(|| plain("That item isn't in the media library any more."))
    }

    /// Send a file in chunks to `tool`; `first` goes on the first call, `every` on all.
    /// `progress` hears (bytes sent, bytes in all) after each chunk; `stop` ends it between chunks.
    #[allow(clippy::too_many_arguments)]
    async fn send_chunks(
        &self,
        id: i64,
        tool: &str,
        bytes: &[u8],
        first: Value,
        every: Value,
        progress: &(dyn Fn(u64, u64) + Send + Sync),
        stop: &AtomicBool,
    ) -> Result<Value, SiteError> {
        let b64 = base64::engine::general_purpose::STANDARD;
        let chunks: Vec<&[u8]> = bytes.chunks(CHUNK).collect();
        let (all, mut sent) = (bytes.len() as u64, 0u64);
        let mut upload: Option<String> = None;
        progress(0, all);
        for (i, chunk) in chunks.iter().enumerate() {
            if stop.load(Ordering::Relaxed) {
                return Err(plain(STOPPED));
            }
            let last = i + 1 == chunks.len();
            let mut args = every.clone();
            args["data"] = b64.encode(chunk).into();
            args["done"] = last.into();
            match &upload {
                None => {
                    for (k, v) in first.as_object().into_iter().flatten() {
                        args[k] = v.clone();
                    }
                }
                Some(u) => {
                    args["upload_id"] = u.as_str().into();
                    args["offset"] = sent.into();
                }
            }
            let out = self.call_ability_inner(id, tool, args).await?;
            sent += chunk.len() as u64;
            progress(sent, all);
            if last {
                return Ok(out);
            }
            upload = out["upload_id"].as_str().map(String::from);
            if upload.is_none() {
                return Err(plain("The site didn't start the upload. Try again."));
            }
        }
        Err(plain("That file is empty."))
    }

    /// Add a file the person picked to the library, with its details.
    pub async fn upload_media(
        &self,
        id: i64,
        name: &str,
        bytes: &[u8],
        details: &Details,
        progress: &(dyn Fn(u64, u64) + Send + Sync),
        stop: &AtomicBool,
    ) -> Result<Media, SiteError> {
        let _work = self.working().await;
        let site = self.media_site(id, "upload-media")?;
        let name = clean_name(name)?;
        let field = |f: &Option<String>| f.as_deref().unwrap_or_default().trim().to_string();
        let new_id = match site.mode {
            Mode::ClassicMonks => {
                // The site reads title and alt on the last call: send them on every one.
                let every = json!({ "title": field(&details.title), "alt": field(&details.alt) });
                let first = json!({ "filename": name });
                let out = self
                    .send_chunks(id, "upload-media", bytes, first, every, progress, stop)
                    .await?;
                let new_id = added(&out["attachment_id"])?;
                // upload-media takes no caption or description: set them after.
                let rest = Details {
                    caption: details.caption.clone().filter(|c| !c.trim().is_empty()),
                    description: details.description.clone().filter(|c| !c.trim().is_empty()),
                    ..Default::default()
                };
                // The file is in the library now: a failed detail must not read as a failed upload,
                // or trying again adds it twice. The details panel shows what was kept.
                if !rest.is_empty() && has_tool(&site, "update-media") {
                    self.details_inner(&site, new_id, &rest).await.ok();
                }
                new_id
            }
            Mode::Basic => {
                if stop.load(Ordering::Relaxed) {
                    return Err(plain(STOPPED));
                }
                progress(0, bytes.len() as u64);
                let mime = mime_guess(&name);
                let file = Body::File {
                    name,
                    mime,
                    bytes: bytes.to_vec(),
                };
                let (m, _) = self
                    .rest_json(&site, Method::POST, "/wp/v2/media", &[], file)
                    .await?;
                progress(bytes.len() as u64, bytes.len() as u64);
                let new_id = added(&m["id"])?;
                if !details.is_empty() {
                    self.details_inner(&site, new_id, details).await.ok();
                }
                new_id
            }
        };
        self.media_one(id, new_id).await
    }

    /// Change an item's alt text, title, caption or description.
    pub async fn update_media(
        &self,
        id: i64,
        media_id: i64,
        details: &Details,
    ) -> Result<Media, SiteError> {
        let _work = self.working().await;
        let site = self.media_site(id, "update-media")?;
        if details.is_empty() {
            return Err(plain("Nothing to change."));
        }
        self.details_inner(&site, media_id, details).await?;
        self.media_one(id, media_id).await
    }

    async fn details_inner(
        &self,
        site: &Site,
        media_id: i64,
        d: &Details,
    ) -> Result<(), SiteError> {
        match site.mode {
            Mode::ClassicMonks => {
                let mut args = serde_json::to_value(d).unwrap_or_default();
                if let Some(o) = args.as_object_mut() {
                    o.retain(|_, v| !v.is_null());
                }
                args["id"] = media_id.into();
                self.call_ability_inner(site.id, "update-media", args)
                    .await?;
            }
            Mode::Basic => {
                let mut body = json!({});
                for (key, f) in [
                    ("alt_text", &d.alt),
                    ("title", &d.title),
                    ("caption", &d.caption),
                    ("description", &d.description),
                ] {
                    if let Some(v) = f {
                        body[key] = v.as_str().into();
                    }
                }
                let route = format!("/wp/v2/media/{media_id}");
                self.rest_json(site, Method::POST, &route, &[], Body::Json(body))
                    .await?;
            }
        }
        Ok(())
    }

    /// Put a new file in place of an item's file. The ID stays, and the address too
    /// unless `keep_name`. The site keeps the earlier file to put back.
    #[allow(clippy::too_many_arguments)]
    pub async fn replace_media(
        &self,
        id: i64,
        media_id: i64,
        name: &str,
        bytes: &[u8],
        keep_name: bool,
        progress: &(dyn Fn(u64, u64) + Send + Sync),
        stop: &AtomicBool,
    ) -> Result<Media, SiteError> {
        let _work = self.working().await;
        self.media_site(id, "replace-media")?;
        let name = clean_name(name)?;
        let first = json!({ "filename": name });
        let every = json!({ "id": media_id, "keep_name": keep_name });
        self.send_chunks(id, "replace-media", bytes, first, every, progress, stop)
            .await?;
        self.media_one(id, media_id).await
    }

    /// Swap the file from before the last replace back in (again swaps back).
    pub async fn restore_replaced_media(&self, id: i64, media_id: i64) -> Result<Media, SiteError> {
        let _work = self.working().await;
        self.media_site(id, "restore-replaced-media")?;
        self.call_ability_inner(id, "restore-replaced-media", json!({ "id": media_id }))
            .await?;
        self.media_one(id, media_id).await
    }

    /// Move items to Classic Monks' media trash, or (`back`) bring them back.
    pub async fn trash_media(&self, id: i64, ids: &[i64], back: bool) -> Result<Moved, SiteError> {
        let _work = self.working().await;
        let tool = if back { "restore-media" } else { "trash-media" };
        self.media_site(id, tool)?;
        let mut moved = Moved::default();
        for (n, part) in ids.chunks(50).enumerate() {
            let v = match self
                .call_ability_inner(id, tool, json!({ "ids": part }))
                .await
            {
                Ok(v) => v,
                Err(e) if n == 0 => return Err(e),
                // Earlier parts already moved: keep them (and their Undo), say why the rest didn't.
                Err(e) => {
                    let why = e.to_string();
                    moved
                        .skipped
                        .extend(ids[n * 50..].iter().map(|&i| (i, why.clone())));
                    break;
                }
            };
            let key = if back { "restored" } else { "trashed" };
            moved.done.extend(
                v[key]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(Value::as_i64),
            );
            moved
                .skipped
                .extend(v["skipped"].as_array().into_iter().flatten().map(|s| {
                    (
                        s["id"].as_i64().unwrap_or_default(),
                        skip_reason(&text(&s["reason"])),
                    )
                }));
        }
        Ok(moved)
    }
}

/// The new item's id from an upload's answer; without one the upload can't be shown or undone.
fn added(v: &Value) -> Result<i64, SiteError> {
    v.as_i64().filter(|&i| i > 0).ok_or_else(|| {
        plain("The site didn't say which item it added. Look in the media library before trying again.")
    })
}

/// The site's skip codes in words.
fn skip_reason(r: &str) -> String {
    match r {
        "not_an_attachment" => "It isn't in the media library.".into(),
        "already_trashed" => "It's already in the trash.".into(),
        "not_in_trash" => "It isn't in the trash.".into(),
        "forbidden" => "This connection may not change it.".into(),
        r => r.into(),
    }
}

/// A MIME type from the file name, for Basic mode's upload (WordPress checks it again).
fn mime_guess(name: &str) -> String {
    let ext = name.rsplit('.').next().unwrap_or_default().to_lowercase();
    match ext.as_str() {
        "jpg" | "jpeg" | "jpe" => "image/jpeg",
        "png" => "image/png",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "avif" => "image/avif",
        "pdf" => "application/pdf",
        "mp4" => "video/mp4",
        "mp3" => "audio/mpeg",
        _ => "application/octet-stream",
    }
    .into()
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Options;
    use crate::testsite::TestSite;
    use std::sync::{Arc, Mutex};

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
    async fn classic_monks_uploads_in_chunks_edits_replaces_and_trashes() {
        let (_h, core) = core().await;
        let site = TestSite::start().await;
        let s = core.add_site_oauth(&site.url, browser).await.unwrap();
        let go = AtomicBool::new(false);
        let seen = Mutex::new(Vec::new());
        let note = |a: u64, b: u64| seen.lock().unwrap().push((a, b));

        // 2.5 MB: three chunks, progress after each.
        let big = vec![7u8; CHUNK * 2 + CHUNK / 2];
        let d = Details {
            alt: Some("A red door".into()),
            title: Some("Door".into()),
            caption: Some("Our front door".into()),
            ..Default::default()
        };
        let m = core
            .upload_media(s.id, "C:\\pics\\door.jpg", &big, &d, &note, &go)
            .await
            .unwrap();
        assert_eq!(
            (
                m.title.as_str(),
                m.alt.as_str(),
                m.caption.as_str(),
                m.file_name.as_str()
            ),
            ("Door", "A red door", "Our front door", "door.jpg")
        );
        assert_eq!(m.size, big.len() as u64);
        assert_eq!(m.usage, Some(0));
        let all = big.len() as u64;
        assert_eq!(
            *seen.lock().unwrap(),
            [
                (0, all),
                (CHUNK as u64, all),
                (2 * CHUNK as u64, all),
                (all, all)
            ]
        );
        let calls: Vec<_> = site
            .state()
            .calls
            .iter()
            .filter(|c| c.0 == "upload-media")
            .map(|c| (c.1["offset"].as_u64(), c.1["filename"].is_string()))
            .collect();
        assert_eq!(
            calls,
            [
                (None, true),
                (Some(CHUNK as u64), false),
                (Some(2 * CHUNK as u64), false)
            ]
        );

        // Stopped before the first chunk: nothing is sent.
        let n = site.state().calls.len();
        let e = core
            .upload_media(
                s.id,
                "x.jpg",
                b"abc",
                &Details::default(),
                &|_, _| {},
                &AtomicBool::new(true),
            )
            .await
            .unwrap_err();
        assert_eq!(e.to_string(), STOPPED);
        assert_eq!(site.state().calls.len(), n);
        assert!(
            core.upload_media(s.id, "noext", b"abc", &Details::default(), &|_, _| {}, &go)
                .await
                .is_err()
        );

        // The list: total, what the site takes, filters.
        let lib = core.media(s.id, &MediaQuery::default()).await.unwrap();
        assert_eq!((lib.total, lib.items[0].id), (1, m.id));
        assert_eq!(lib.allowed["jpg|jpeg|jpe"], "image/jpeg");
        assert!(lib.limit > 0);
        let q = |kind: &str, month: &str| MediaQuery {
            kind: Some(kind.into()),
            month: Some(month.into()),
            ..Default::default()
        };
        assert_eq!(
            core.media(s.id, &q("image", "2026-10"))
                .await
                .unwrap()
                .total,
            1
        );
        assert_eq!(
            core.media(s.id, &q("application", "")).await.unwrap().total,
            0
        );
        assert_eq!(core.media(s.id, &q("", "2026-09")).await.unwrap().total, 0);
        assert!(core.media(s.id, &q("", "2026-13")).await.is_err());

        // Details: only what's sent changes.
        let e = Details {
            title: Some("Front door".into()),
            description: Some("Painted in 2024.".into()),
            ..Default::default()
        };
        let m2 = core.update_media(s.id, m.id, &e).await.unwrap();
        assert_eq!(
            (m2.title.as_str(), m2.alt.as_str(), m2.description.as_str()),
            ("Front door", "A red door", "Painted in 2024.")
        );
        assert!(
            core.update_media(s.id, m.id, &Details::default())
                .await
                .is_err()
        );

        // Replace keeps the ID and address; restore puts the earlier bytes back.
        let r = core
            .replace_media(s.id, m.id, "new.png", b"PNGDATA", false, &|_, _| {}, &go)
            .await
            .unwrap();
        assert_eq!((r.id, r.url.as_str(), r.size), (m.id, m.url.as_str(), 7));
        assert!(
            site.state()
                .calls
                .iter()
                .any(|c| c.0 == "replace-media" && c.1["id"] == m.id)
        );
        let back = core.restore_replaced_media(s.id, m.id).await.unwrap();
        assert_eq!(back.size, big.len() as u64);

        // Trash and back.
        let t = core.trash_media(s.id, &[m.id, 999], false).await.unwrap();
        assert_eq!(t.done, [m.id]);
        assert_eq!(
            t.skipped,
            [(999, "It isn't in the media library.".to_string())]
        );
        assert_eq!(
            core.media(s.id, &MediaQuery::default())
                .await
                .unwrap()
                .total,
            0
        );
        let b = core.trash_media(s.id, &[m.id], true).await.unwrap();
        assert_eq!(b.done, [m.id]);
        assert_eq!(core.media_item(s.id, m.id).await.unwrap().id, m.id);

        // A later part that fails keeps what the first part moved, with the rest said why.
        let mut ids = vec![m.id];
        ids.extend(1000..1049);
        ids.extend([1049, 0]);
        let t = core.trash_media(s.id, &ids, false).await.unwrap();
        assert_eq!(t.done, [m.id]);
        assert_eq!(t.skipped.len(), 49 + 2);
        assert_eq!(
            t.skipped[49..],
            [
                (1049, "The site broke on this part.".to_string()),
                (0, "The site broke on this part.".to_string())
            ]
        );
        // A first part that fails is the error itself.
        assert!(core.trash_media(s.id, &[0], true).await.is_err());
    }

    #[tokio::test]
    async fn basic_mode_uploads_and_edits_but_cannot_replace() {
        let (_h, core) = core().await;
        let site = TestSite::start().await;
        let pw = site.state().app_password.clone();
        let s = core.add_site_basic(&site.url, "admin", &pw).await.unwrap();
        let d = Details {
            alt: Some("A dot".into()),
            caption: Some("Tiny".into()),
            ..Default::default()
        };
        let m = core
            .upload_media(
                s.id,
                "img.png",
                crate::testsite::DOT_PNG,
                &d,
                &|_, _| {},
                &AtomicBool::new(false),
            )
            .await
            .unwrap();
        assert_eq!(
            (m.mime.as_str(), m.alt.as_str(), m.caption.as_str()),
            ("image/png", "A dot", "Tiny")
        );
        let lib = core.media(s.id, &MediaQuery::default()).await.unwrap();
        assert_eq!((lib.total, lib.limit), (1, 0));
        let e = core
            .replace_media(
                s.id,
                m.id,
                "a.png",
                b"x",
                false,
                &|_, _| {},
                &AtomicBool::new(false),
            )
            .await
            .unwrap_err();
        assert_eq!(e.to_string(), NEEDS_CM_MEDIA);
        assert!(core.trash_media(s.id, &[m.id], false).await.is_err());
    }

    #[test]
    fn files_months_and_items() {
        assert_eq!(
            month_range("2026-12"),
            Some(("2026-12-01T00:00:00".into(), "2027-01-01T00:00:00".into()))
        );
        assert!(month_range("2026-00").is_none() && month_range("x").is_none());
        assert_eq!(month_param("2026-1").as_deref(), Some("2026-01"));
        assert_eq!(month_param("2026-+3").as_deref(), Some("2026-03"));
        assert_eq!(clean_name("/home/me/../a/b.jpg").unwrap(), "b.jpg");
        assert!(
            clean_name("folder/").is_err()
                && clean_name(".jpg").is_err()
                && clean_name("x.").is_err()
        );
        let long = clean_name(&format!("{}.jpeg", "a".repeat(300))).unwrap();
        assert!(
            long.ends_with(".jpeg") && long.chars().count() == 200,
            "{long}"
        );
        assert!(added(&json!(0)).is_err() && added(&json!(null)).is_err());
        assert_eq!(added(&json!(42)).unwrap(), 42);
        assert!(decode_file("").is_err() && decode_file("%%").is_err());
        assert_eq!(decode_file("YWJj").unwrap(), b"abc");
        assert!(decode_file(&"A".repeat(MAX_FILE / 3 * 4 + 8)).is_err());
        assert_eq!(mime_guess("A.JPG"), "image/jpeg");
        let m = media_from(
            &json!({ "id": 3, "title": { "raw": "Shop" }, "source_url": "https://c/2026/10/s.jpg", "mime_type": "image/jpeg",
                "alt_text": "The shop", "date": "2026-10-28T09:00:00", "caption": { "raw": "Hi" },
                "media_details": { "width": 640, "height": 480, "filesize": 2048, "sizes": { "thumbnail": { "source_url": "https://c/t.jpg" } } } }),
            true,
        );
        assert_eq!(
            (
                m.file_name.as_str(),
                m.caption.as_str(),
                m.width,
                m.size,
                m.thumb.as_str(),
                m.date.as_str()
            ),
            (
                "s.jpg",
                "Hi",
                640,
                2048,
                "https://c/t.jpg",
                "2026-10-28 09:00:00"
            )
        );
    }
}
