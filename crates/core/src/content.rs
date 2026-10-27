//! Posts, pages and every post type the connection can edit (plan Phase 3):
//! find the types, list and read entries, create and edit them (title, status,
//! terms, featured image, and the body through the block-safe editor), trash
//! them, and the media library (browse, import from a link).
//!
//! Classic Monks sites need its content tools from M6 (`list-post-types`).
//! Basic mode uses core REST, so it sees only types shown in REST. Pages built
//! with Elementor or Bricks keep their body in the builder: it is never edited here.

use std::collections::BTreeMap;

use reqwest::Method;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::Core;
use crate::blocks::{self, Block};
use crate::connect::{AppPassword, SiteError, plain, rest_url};
use crate::fleet::has_tool;
use crate::net::{self, Retry};
use crate::sites::{self, Mode, Site};

/// Types WordPress uses for itself, never shown as content.
const INTERNAL: &[&str] = &[
    "attachment",
    "nav_menu_item",
    "wp_block",
    "wp_template",
    "wp_template_part",
    "wp_navigation",
    "wp_global_styles",
    "wp_font_family",
    "wp_font_face",
];

/// The statuses Monks Central sets. Scheduling (future) arrives with dates in v0.2.
const STATUSES: &[&str] = &["publish", "draft", "pending", "private"];
/// "All" in the list: everything but the trash.
const ALL: &str = "publish,draft,pending,private,future";
const PER_PAGE: u32 = 20;
/// The largest file "import from a link" downloads in Basic mode.
const MAX_IMPORT: usize = 25 * 1024 * 1024;

pub const OLD_CLASSIC_MONKS: &str = "This site's Classic Monks is older and has no content tools for Monks Central. Update Classic Monks on the site, then check it again.";

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Taxonomy {
    pub name: String,
    pub label: String,
    pub hierarchical: bool,
    /// Whether new terms can be added (else only existing ones are offered).
    pub can_add: bool,
    /// Basic mode's REST route; empty on Classic Monks.
    pub rest_base: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct PostType {
    pub name: String,
    pub label: String,
    pub singular: String,
    pub hierarchical: bool,
    pub supports: Vec<String>,
    pub can_publish: bool,
    pub can_delete: bool,
    pub taxonomies: Vec<Taxonomy>,
    pub rest_base: String,
}

/// One row of a list.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Summary {
    pub id: i64,
    pub title: String,
    pub status: String,
    /// The site's local time, "2026-10-28 09:30:00".
    pub date: String,
    pub modified: String,
    pub author: String,
    pub link: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Listing {
    pub posts: Vec<Summary>,
    pub total: u64,
    pub page: u32,
    pub pages: u32,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct Query {
    pub post_type: String,
    /// One status, "trash", or none for everything but the trash.
    pub status: Option<String>,
    pub search: Option<String>,
    pub page: Option<u32>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct Term {
    pub id: i64,
    pub name: String,
}

/// One entry, as the editor opens it.
#[derive(Debug, Clone, Serialize)]
pub struct Post {
    pub id: i64,
    pub post_type: String,
    pub title: String,
    pub status: String,
    pub date: String,
    pub modified: String,
    pub link: String,
    pub featured_image: i64,
    pub featured_url: Option<String>,
    pub terms: BTreeMap<String, Vec<Term>>,
    /// `elementor` or `bricks` when a page builder renders the body.
    pub builder: Option<String>,
    pub blocks: Vec<Block>,
    /// Why the body can't be edited here, if it can't.
    pub locked: Option<String>,
    #[serde(skip)]
    raw: String,
}

/// A term picked by id, or typed by name (added if it isn't there yet).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(untagged)]
pub enum TermRef {
    Id(i64),
    Name(String),
}

#[derive(Debug, Clone, Deserialize)]
pub struct BlockEdit {
    pub index: usize,
    pub html: String,
}

/// What the editor sends. Missing fields stay as they are.
#[derive(Debug, Clone, Default, Deserialize)]
pub struct Draft {
    pub title: Option<String>,
    pub status: Option<String>,
    /// Replaces the terms of each taxonomy given.
    pub terms: Option<BTreeMap<String, Vec<TermRef>>>,
    /// An attachment id; 0 removes the featured image.
    pub featured_image: Option<i64>,
    /// A new entry's whole body.
    pub body: Option<String>,
    /// Text changes to an existing entry's blocks.
    #[serde(default)]
    pub edits: Vec<BlockEdit>,
    /// `modified` as the editor read it: refuse if the entry changed since.
    pub seen_modified: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Media {
    pub id: i64,
    pub title: String,
    pub url: String,
    pub mime: String,
    pub alt: String,
    pub date: String,
}

fn text(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        // Core REST sends `{ "raw": …, "rendered": … }` in the edit context.
        Value::Object(o) => o
            .get("raw")
            .or_else(|| o.get("rendered"))
            .map(text)
            .unwrap_or_default(),
        _ => String::new(),
    }
}

/// Core REST dates have a `T`; Classic Monks' have a space.
fn local(v: &Value) -> String {
    text(v).replacen('T', " ", 1)
}

fn builder_note(builder: &str) -> String {
    let name = if builder == "bricks" {
        "Bricks"
    } else {
        "Elementor"
    };
    format!(
        "This page is built with {name}, so its body lives in {name}. Edit the body in {name}; the title, status and terms can change here."
    )
}

/// Basic mode can't read builder meta, so it looks at the page as WordPress renders it.
fn builder_in(rendered: &str) -> Option<String> {
    if rendered.contains("data-elementor-type") || rendered.contains("class=\"elementor ") {
        Some("elementor".into())
    } else if rendered.contains("brxe-") || rendered.contains("id=\"brx-content\"") {
        Some("bricks".into())
    } else {
        None
    }
}

impl Post {
    fn new(mut post: Post) -> Post {
        post.locked = match (&post.builder, blocks::parse(&post.raw)) {
            (Some(b), _) => Some(builder_note(b)),
            (None, Ok(b)) => {
                post.blocks = b;
                None
            }
            (None, Err(e)) => Some(e.to_string()),
        };
        post
    }
}

/// From Classic Monks' `get-post-by-id` (with the M6 fields).
pub fn post_from_cm(v: &Value) -> Post {
    let terms = v["terms"]
        .as_object()
        .into_iter()
        .flatten()
        .map(|(tax, list)| {
            let list = list
                .as_array()
                .into_iter()
                .flatten()
                .map(|t| Term {
                    id: t["id"].as_i64().unwrap_or_default(),
                    name: text(&t["name"]),
                })
                .collect();
            (tax.clone(), list)
        })
        .collect();
    Post::new(Post {
        id: v["id"].as_i64().unwrap_or_default(),
        post_type: text(&v["type"]),
        title: text(&v["title"]),
        status: text(&v["status"]),
        date: text(&v["date"]),
        modified: text(&v["modified"]),
        link: text(&v["permalink"]),
        featured_image: v["featured_image_id"].as_i64().unwrap_or_default(),
        featured_url: v["featured_image"].as_str().map(String::from),
        terms,
        builder: v["builder"].as_str().map(String::from),
        blocks: Vec::new(),
        locked: None,
        raw: text(&v["content"]),
    })
}

/// From a core REST entry in the edit context.
pub fn post_from_rest(v: &Value, ty: &PostType) -> Post {
    let terms = ty
        .taxonomies
        .iter()
        .map(|t| {
            let ids = v[&t.rest_base].as_array().into_iter().flatten();
            let list = ids
                .filter_map(Value::as_i64)
                .map(|id| Term {
                    id,
                    name: String::new(),
                })
                .collect();
            (t.name.clone(), list)
        })
        .collect();
    Post::new(Post {
        id: v["id"].as_i64().unwrap_or_default(),
        post_type: text(&v["type"]),
        title: text(&v["title"]),
        status: text(&v["status"]),
        date: local(&v["date"]),
        modified: local(&v["modified"]),
        link: text(&v["link"]),
        featured_image: v["featured_media"].as_i64().unwrap_or_default(),
        featured_url: None,
        terms,
        builder: builder_in(v["content"]["rendered"].as_str().unwrap_or_default()),
        blocks: Vec::new(),
        locked: None,
        raw: text(&v["content"]),
    })
}

/// From Classic Monks' `list-post-types` (M6).
pub fn types_from_cm(v: &Value) -> Vec<PostType> {
    v["post_types"]
        .as_array()
        .into_iter()
        .flatten()
        .map(|t| PostType {
            name: text(&t["name"]),
            label: text(&t["label"]),
            singular: text(&t["singular"]),
            hierarchical: t["hierarchical"] == true,
            supports: t["supports"]
                .as_array()
                .into_iter()
                .flatten()
                .map(text)
                .collect(),
            can_publish: t["can_publish"] == true,
            can_delete: t["can_delete"] == true,
            taxonomies: t["taxonomies"]
                .as_array()
                .into_iter()
                .flatten()
                .map(|x| Taxonomy {
                    name: text(&x["name"]),
                    label: text(&x["label"]),
                    hierarchical: x["hierarchical"] == true,
                    can_add: x["can_add"] == true,
                    rest_base: String::new(),
                })
                .collect(),
            rest_base: String::new(),
        })
        .collect()
}

/// From core REST `/wp/v2/types` and `/wp/v2/taxonomies` (edit context).
pub fn types_from_rest(types: &Value, taxonomies: &Value) -> Vec<PostType> {
    let mut out: Vec<PostType> = types
        .as_object()
        .into_iter()
        .flatten()
        .filter(|(slug, _)| !INTERNAL.contains(&slug.as_str()))
        .map(|(slug, t)| {
            let taxonomies = t["taxonomies"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|tax| {
                    let x = &taxonomies[tax.as_str()?];
                    x.is_object().then(|| Taxonomy {
                        name: text(&x["slug"]),
                        label: text(&x["name"]),
                        hierarchical: x["hierarchical"] == true,
                        can_add: true,
                        rest_base: text(&x["rest_base"]),
                    })
                })
                .collect();
            PostType {
                name: slug.clone(),
                label: text(&t["name"]),
                singular: t["labels"]["singular_name"]
                    .as_str()
                    .map_or_else(|| text(&t["name"]), String::from),
                hierarchical: t["hierarchical"] == true,
                supports: t["supports"]
                    .as_object()
                    .into_iter()
                    .flatten()
                    .filter(|(_, on)| **on == true)
                    .map(|(k, _)| k.clone())
                    .collect(),
                can_publish: true,
                can_delete: true,
                taxonomies,
                rest_base: text(&t["rest_base"]),
            }
        })
        .collect();
    // Posts and pages first, as wp-admin lists them.
    out.sort_by_key(|t| match t.name.as_str() {
        "post" => 0,
        "page" => 1,
        _ => 2,
    });
    out
}

fn summary(p: &Value, rest: bool) -> Summary {
    let date = |v: &Value| if rest { local(v) } else { text(v) };
    Summary {
        id: p["id"].as_i64().unwrap_or_default(),
        title: text(&p["title"]),
        status: text(&p["status"]),
        date: date(&p["date"]),
        modified: date(&p["modified"]),
        author: if rest {
            text(&p["_embedded"]["author"][0]["name"])
        } else {
            text(&p["author"])
        },
        link: text(if rest { &p["link"] } else { &p["permalink"] }),
    }
}

fn listing(posts: Vec<Summary>, total: u64, page: u32) -> Listing {
    Listing {
        posts,
        total,
        page,
        pages: total.div_ceil(u64::from(PER_PAGE)).max(1) as u32,
    }
}

fn media_from(m: &Value, rest: bool) -> Media {
    Media {
        id: m["id"].as_i64().unwrap_or_default(),
        title: text(&m["title"]),
        url: text(if rest { &m["source_url"] } else { &m["url"] }),
        mime: text(&m["mime_type"]),
        alt: text(&m["alt_text"]),
        date: if rest {
            local(&m["date"])
        } else {
            text(&m["date"])
        },
    }
}

fn check_status(status: &Option<String>) -> Result<(), SiteError> {
    match status {
        Some(s) if !STATUSES.contains(&s.as_str()) => Err(plain(format!(
            "Monks Central can't set the status {s}. Use publish, draft, pending or private."
        ))),
        _ => Ok(()),
    }
}

/// A file name for an imported link: the last part of its path.
fn file_name(url: &reqwest::Url, mime: &str) -> String {
    let last = url
        .path_segments()
        .and_then(|mut s| s.next_back())
        .filter(|s| s.contains('.'))
        .map(String::from);
    last.unwrap_or_else(|| format!("image.{}", mime.rsplit('/').next().unwrap_or("jpg")))
}

/// A request body for core REST.
enum Body {
    None,
    Json(Value),
    File {
        mime: String,
        name: String,
        bytes: Vec<u8>,
    },
}

impl Core {
    fn content_site(&self, id: i64) -> Result<Site, SiteError> {
        let site = self.site(id)?;
        if site.mode == Mode::ClassicMonks && !has_tool(&site, "list-post-types") {
            return Err(plain(OLD_CLASSIC_MONKS));
        }
        Ok(site)
    }

    /// One core REST call as the site's application password.
    async fn rest(
        &self,
        site: &Site,
        method: Method,
        route: &str,
        query: &[(&str, String)],
        body: Body,
    ) -> Result<net::Reply, SiteError> {
        let secret: AppPassword = self.load_secret(site.id)?;
        let url = rest_url(&site.api_url, route);
        let retry = if method == Method::GET {
            Retry::ReadOnly
        } else {
            Retry::Write
        };
        Ok(net::send(&self.limits, &site.url, retry, || {
            let req = self
                .http
                .request(method.clone(), &url)
                .query(query)
                .basic_auth(&secret.username, Some(&secret.password));
            match &body {
                Body::None => req,
                Body::Json(v) => req.json(v),
                Body::File { mime, name, bytes } => req
                    .header(reqwest::header::CONTENT_TYPE, mime)
                    .header(
                        reqwest::header::CONTENT_DISPOSITION,
                        format!("attachment; filename=\"{}\"", name.replace('"', "")),
                    )
                    .body(bytes.clone()),
            }
        })
        .await?)
    }

    /// The reply's JSON, or what went wrong in the site's own words.
    async fn rest_json(
        &self,
        site: &Site,
        method: Method,
        route: &str,
        query: &[(&str, String)],
        body: Body,
    ) -> Result<(Value, net::Reply), SiteError> {
        let reply = self.rest(site, method, route, query, body).await?;
        self.answer(site, reply)
    }

    fn answer(&self, site: &Site, reply: net::Reply) -> Result<(Value, net::Reply), SiteError> {
        match reply.status {
            200 | 201 => match reply.json::<Value>() {
                Some(v) => Ok((v, reply)),
                None => Err(plain(
                    "The site sent an answer Monks Central couldn't read.",
                )),
            },
            401 => {
                self.db(|c| sites::set_sign_in_again(c, site.id, true))?;
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

    async fn rest_types(&self, site: &Site) -> Result<Vec<PostType>, SiteError> {
        let edit = [("context", "edit".to_string())];
        let (types, _) = self
            .rest_json(site, Method::GET, "/wp/v2/types", &edit, Body::None)
            .await?;
        let (taxes, _) = self
            .rest_json(site, Method::GET, "/wp/v2/taxonomies", &edit, Body::None)
            .await?;
        Ok(types_from_rest(&types, &taxes))
    }

    async fn rest_type(&self, site: &Site, name: &str) -> Result<PostType, SiteError> {
        self.rest_types(site)
            .await?
            .into_iter()
            .find(|t| t.name == name)
            .ok_or_else(|| {
                plain(format!(
                    "This site has no post type {name} in its REST API."
                ))
            })
    }

    /// The post types this connection can edit.
    pub async fn post_types(&self, id: i64) -> Result<Vec<PostType>, SiteError> {
        let _work = self.working().await;
        let site = self.content_site(id)?;
        match site.mode {
            Mode::ClassicMonks => Ok(types_from_cm(
                &self
                    .call_ability_inner(id, "list-post-types", json!({}))
                    .await?,
            )),
            Mode::Basic => self.rest_types(&site).await,
        }
    }

    /// One page of entries, newest first.
    pub async fn posts(&self, id: i64, q: &Query) -> Result<Listing, SiteError> {
        let _work = self.working().await;
        let site = self.content_site(id)?;
        let page = q.page.unwrap_or(1).max(1);
        let status = q.status.clone().unwrap_or_else(|| ALL.into());
        let search = q.search.as_deref().map(str::trim).unwrap_or_default();
        match site.mode {
            Mode::ClassicMonks => {
                let mut args = json!({
                    "post_type": q.post_type, "status": status, "limit": PER_PAGE,
                    "offset": (page - 1) * PER_PAGE, "orderby": "date", "order": "DESC",
                });
                if !search.is_empty() {
                    args["search"] = search.into();
                }
                let v = self.call_ability_inner(id, "get-posts", args).await?;
                let posts = v["posts"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .map(|p| summary(p, false))
                    .collect();
                Ok(listing(
                    posts,
                    v["total"].as_u64().unwrap_or_default(),
                    page,
                ))
            }
            Mode::Basic => {
                let ty = self.rest_type(&site, &q.post_type).await?;
                let mut query = vec![
                    ("context", "edit".to_string()),
                    ("per_page", PER_PAGE.to_string()),
                    ("page", page.to_string()),
                    ("status", status),
                    ("_embed", "author".into()),
                ];
                if !search.is_empty() {
                    query.push(("search", search.into()));
                }
                let route = format!("/wp/v2/{}", ty.rest_base);
                let (v, reply) = self
                    .rest_json(&site, Method::GET, &route, &query, Body::None)
                    .await?;
                let total = reply
                    .headers
                    .get("x-wp-total")
                    .and_then(|h| h.to_str().ok()?.parse().ok())
                    .unwrap_or_default();
                let posts = v
                    .as_array()
                    .into_iter()
                    .flatten()
                    .map(|p| summary(p, true))
                    .collect();
                Ok(listing(posts, total, page))
            }
        }
    }

    /// One entry, with its body split into blocks for the editor.
    pub async fn post(&self, id: i64, post_type: &str, post_id: i64) -> Result<Post, SiteError> {
        let _work = self.working().await;
        self.read_post(id, post_type, post_id).await
    }

    async fn read_post(&self, id: i64, post_type: &str, post_id: i64) -> Result<Post, SiteError> {
        let site = self.content_site(id)?;
        match site.mode {
            Mode::ClassicMonks => Ok(post_from_cm(
                &self
                    .call_ability_inner(id, "get-post-by-id", json!({ "post_id": post_id }))
                    .await?,
            )),
            Mode::Basic => {
                let ty = self.rest_type(&site, post_type).await?;
                let route = format!("/wp/v2/{}/{post_id}", ty.rest_base);
                let edit = [("context", "edit".to_string())];
                let (v, _) = self
                    .rest_json(&site, Method::GET, &route, &edit, Body::None)
                    .await?;
                let mut post = post_from_rest(&v, &ty);
                self.name_terms(&site, &ty, &mut post).await;
                if post.featured_image > 0 {
                    let route = format!("/wp/v2/media/{}", post.featured_image);
                    if let Ok((m, _)) = self
                        .rest_json(&site, Method::GET, &route, &[], Body::None)
                        .await
                    {
                        post.featured_url = Some(text(&m["source_url"]));
                    }
                }
                Ok(post)
            }
        }
    }

    /// Core REST gives term ids only: look up their names.
    async fn name_terms(&self, site: &Site, ty: &PostType, post: &mut Post) {
        for tax in &ty.taxonomies {
            let Some(list) = post.terms.get_mut(&tax.name).filter(|l| !l.is_empty()) else {
                continue;
            };
            let include = list
                .iter()
                .map(|t| t.id.to_string())
                .collect::<Vec<_>>()
                .join(",");
            let route = format!("/wp/v2/{}", tax.rest_base);
            let q = [("include", include), ("per_page", "100".into())];
            if let Ok((v, _)) = self
                .rest_json(site, Method::GET, &route, &q, Body::None)
                .await
            {
                for t in list.iter_mut() {
                    if let Some(found) = v
                        .as_array()
                        .into_iter()
                        .flatten()
                        .find(|x| x["id"].as_i64() == Some(t.id))
                    {
                        t.name = text(&found["name"]);
                    }
                }
            }
        }
    }

    /// Terms in a taxonomy, by name, optionally matching a search.
    pub async fn terms(
        &self,
        id: i64,
        taxonomy: &str,
        search: &str,
    ) -> Result<Vec<Term>, SiteError> {
        let _work = self.working().await;
        let site = self.content_site(id)?;
        let search = search.trim();
        let list = match site.mode {
            Mode::ClassicMonks => {
                let mut args = json!({ "taxonomy": taxonomy, "limit": 100, "hide_empty": false });
                if !search.is_empty() {
                    args["search"] = search.into();
                }
                self.call_ability_inner(id, "get-terms", args).await?["terms"].take()
            }
            Mode::Basic => {
                let base = self.rest_taxonomy(&site, taxonomy).await?;
                let mut q = vec![("per_page", "100".to_string()), ("orderby", "name".into())];
                if !search.is_empty() {
                    q.push(("search", search.into()));
                }
                let route = format!("/wp/v2/{base}");
                self.rest_json(&site, Method::GET, &route, &q, Body::None)
                    .await?
                    .0
            }
        };
        Ok(list
            .as_array()
            .into_iter()
            .flatten()
            .map(|t| Term {
                id: t["id"].as_i64().unwrap_or_default(),
                name: text(&t["name"]),
            })
            .collect())
    }

    async fn rest_taxonomy(&self, site: &Site, taxonomy: &str) -> Result<String, SiteError> {
        let (taxes, _) = self
            .rest_json(
                site,
                Method::GET,
                "/wp/v2/taxonomies",
                &[("context", "edit".into())],
                Body::None,
            )
            .await?;
        taxes[taxonomy]["rest_base"]
            .as_str()
            .map(String::from)
            .ok_or_else(|| {
                plain(format!(
                    "This site has no taxonomy {taxonomy} in its REST API."
                ))
            })
    }

    /// Core REST takes term ids: find typed names, adding the missing ones.
    async fn rest_term_ids(
        &self,
        site: &Site,
        ty: &PostType,
        terms: &BTreeMap<String, Vec<TermRef>>,
    ) -> Result<serde_json::Map<String, Value>, SiteError> {
        let mut out = serde_json::Map::new();
        for (name, refs) in terms {
            let tax = ty
                .taxonomies
                .iter()
                .find(|t| &t.name == name)
                .ok_or_else(|| plain(format!("{} has no taxonomy {name}.", ty.label)))?;
            let route = format!("/wp/v2/{}", tax.rest_base);
            let mut ids = Vec::new();
            for r in refs {
                let id = match r {
                    TermRef::Id(id) => *id,
                    TermRef::Name(n) => {
                        let q = [("search", n.clone()), ("per_page", "100".into())];
                        let (found, _) = self
                            .rest_json(site, Method::GET, &route, &q, Body::None)
                            .await?;
                        let same =
                            found.as_array().into_iter().flatten().find(|t| {
                                text(&t["name"]).to_lowercase() == n.trim().to_lowercase()
                            });
                        match same {
                            Some(t) => t["id"].as_i64().unwrap_or_default(),
                            None => {
                                let body = Body::Json(json!({ "name": n.trim() }));
                                let (t, _) = self
                                    .rest_json(site, Method::POST, &route, &[], body)
                                    .await?;
                                t["id"].as_i64().unwrap_or_default()
                            }
                        }
                    }
                };
                ids.push(json!(id));
            }
            out.insert(tax.rest_base.clone(), Value::Array(ids));
        }
        Ok(out)
    }

    /// The core REST body for a draft, plus the body text.
    async fn rest_fields(
        &self,
        site: &Site,
        ty: &PostType,
        d: &Draft,
        content: Option<&str>,
    ) -> Result<Value, SiteError> {
        let mut body = match &d.terms {
            Some(t) => Value::Object(self.rest_term_ids(site, ty, t).await?),
            None => json!({}),
        };
        if let Some(t) = &d.title {
            body["title"] = t.trim().into();
        }
        if let Some(s) = &d.status {
            body["status"] = s.as_str().into();
        }
        if let Some(c) = content {
            body["content"] = c.into();
        }
        if let Some(f) = d.featured_image {
            body["featured_media"] = f.into();
        }
        Ok(body)
    }

    /// Classic Monks' create-post / update-post fields for a draft.
    fn cm_fields(d: &Draft, content: Option<&str>) -> Value {
        let mut args = json!({});
        if let Some(t) = &d.title {
            args["title"] = t.trim().into();
        }
        if let Some(s) = &d.status {
            args["status"] = s.as_str().into();
        }
        if let Some(c) = content {
            args["content"] = c.into();
        }
        if let Some(t) = &d.terms {
            args["terms"] = json!(t);
        }
        if let Some(f) = d.featured_image {
            args["featured_image"] = f.into();
        }
        args
    }

    /// Add an entry. Returns it as the site saved it.
    pub async fn create_post(&self, id: i64, post_type: &str, d: Draft) -> Result<Post, SiteError> {
        let _work = self.working().await;
        let site = self.content_site(id)?;
        check_status(&d.status)?;
        if d.title.as_deref().is_none_or(|t| t.trim().is_empty()) {
            return Err(plain("Give it a title."));
        }
        let body = d.body.as_deref().unwrap_or_default();
        let new_id = match site.mode {
            Mode::ClassicMonks => {
                let mut args = Self::cm_fields(&d, Some(body));
                args["post_type"] = post_type.into();
                if d.featured_image == Some(0) {
                    args.as_object_mut().unwrap().remove("featured_image");
                }
                self.call_ability_inner(id, "create-post", args).await?["id"]
                    .as_i64()
                    .unwrap_or_default()
            }
            Mode::Basic => {
                let ty = self.rest_type(&site, post_type).await?;
                let fields = self.rest_fields(&site, &ty, &d, Some(body)).await?;
                let route = format!("/wp/v2/{}", ty.rest_base);
                self.rest_json(&site, Method::POST, &route, &[], Body::Json(fields))
                    .await?
                    .0["id"]
                    .as_i64()
                    .unwrap_or_default()
            }
        };
        self.read_post(id, post_type, new_id).await
    }

    /// Change an entry: title, status, terms, featured image, and the text of
    /// its blocks. The blocks themselves are checked to be the same after saving.
    pub async fn edit_post(
        &self,
        id: i64,
        post_type: &str,
        post_id: i64,
        d: Draft,
    ) -> Result<Post, SiteError> {
        let _work = self.working().await;
        let site = self.content_site(id)?;
        check_status(&d.status)?;
        if d.title.as_deref().is_some_and(|t| t.trim().is_empty()) {
            return Err(plain("The title can't be empty."));
        }
        let now = self.read_post(id, post_type, post_id).await?;
        if d.seen_modified.as_ref().is_some_and(|m| *m != now.modified) {
            return Err(plain(
                "This changed on the site after you opened it. Open it again to see the new version, then make your change.",
            ));
        }
        let content = if d.edits.is_empty() {
            None
        } else if let Some(note) = &now.locked {
            return Err(plain(note.clone()));
        } else {
            let edits: Vec<(usize, String)> =
                d.edits.iter().map(|e| (e.index, e.html.clone())).collect();
            Some(blocks::apply(&now.raw, &edits).map_err(|e| plain(e.to_string()))?)
        };
        let content = content.filter(|c| *c != now.raw);
        match site.mode {
            Mode::ClassicMonks => {
                let mut args = Self::cm_fields(&d, content.as_deref());
                args["post_id"] = post_id.into();
                self.call_ability_inner(id, "update-post", args).await?;
            }
            Mode::Basic => {
                let ty = self.rest_type(&site, post_type).await?;
                let fields = self.rest_fields(&site, &ty, &d, content.as_deref()).await?;
                let route = format!("/wp/v2/{}/{post_id}", ty.rest_base);
                self.rest_json(&site, Method::POST, &route, &[], Body::Json(fields))
                    .await?;
            }
        }
        let saved = self.read_post(id, post_type, post_id).await?;
        if let Some(sent) = &content
            && blocks::skeleton(&saved.raw) != blocks::skeleton(sent)
        {
            return Err(plain(
                "The site changed the page's blocks while saving it. Check the page in WordPress; its revisions hold the version before.",
            ));
        }
        Ok(saved)
    }

    /// Move an entry to the trash (WordPress keeps it there for 30 days).
    pub async fn trash_post(
        &self,
        id: i64,
        post_type: &str,
        post_id: i64,
    ) -> Result<(), SiteError> {
        let _work = self.working().await;
        let site = self.content_site(id)?;
        match site.mode {
            Mode::ClassicMonks => {
                self.call_ability_inner(id, "delete-post", json!({ "post_id": post_id }))
                    .await?;
            }
            Mode::Basic => {
                let ty = self.rest_type(&site, post_type).await?;
                let route = format!("/wp/v2/{}/{post_id}", ty.rest_base);
                self.rest_json(&site, Method::DELETE, &route, &[], Body::None)
                    .await?;
            }
        }
        Ok(())
    }

    /// One page of the media library, newest first. `images` keeps only images.
    pub async fn media(
        &self,
        id: i64,
        page: u32,
        search: &str,
        images: bool,
    ) -> Result<Vec<Media>, SiteError> {
        let _work = self.working().await;
        let site = self.content_site(id)?;
        let page = page.max(1);
        let search = search.trim();
        match site.mode {
            Mode::ClassicMonks => {
                let mut args = json!({ "limit": 30, "offset": (page - 1) * 30 });
                if images {
                    args["mime_type"] = "image".into();
                }
                if !search.is_empty() {
                    args["search"] = search.into();
                }
                let v = self.call_ability_inner(id, "get-media", args).await?;
                Ok(v["media"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .map(|m| media_from(m, false))
                    .collect())
            }
            Mode::Basic => {
                let mut q = vec![("per_page", "30".to_string()), ("page", page.to_string())];
                if images {
                    q.push(("media_type", "image".into()));
                }
                if !search.is_empty() {
                    q.push(("search", search.into()));
                }
                let reply = self
                    .rest(&site, Method::GET, "/wp/v2/media", &q, Body::None)
                    .await?;
                // Past the last page core REST answers 400; that is an empty page.
                if reply.status == 400 {
                    return Ok(Vec::new());
                }
                let (v, _) = self.answer(&site, reply)?;
                Ok(v.as_array()
                    .into_iter()
                    .flatten()
                    .map(|m| media_from(m, true))
                    .collect())
            }
        }
    }

    /// Add an image to the media library from a link.
    pub async fn import_media(&self, id: i64, link: &str, alt: &str) -> Result<Media, SiteError> {
        let _work = self.working().await;
        let site = self.content_site(id)?;
        let url = reqwest::Url::parse(link.trim())
            .ok()
            .filter(|u| matches!(u.scheme(), "https" | "http"))
            .ok_or_else(|| plain("Paste the full link to an image, starting with https://."))?;
        let alt = alt.trim();
        match site.mode {
            Mode::ClassicMonks => {
                let v = self
                    .call_ability_inner(
                        id,
                        "import-media-from-url",
                        json!({ "url": url.as_str(), "alt": alt }),
                    )
                    .await?;
                Ok(Media {
                    id: v["attachment_id"].as_i64().unwrap_or_default(),
                    title: text(&v["filename"]),
                    url: text(&v["url"]),
                    mime: text(&v["mime_type"]),
                    alt: alt.into(),
                    date: String::new(),
                })
            }
            Mode::Basic => {
                // Basic mode has no import tool: fetch the image here, then upload it.
                let host = url.host_str().unwrap_or_default().to_string();
                let got = net::send(&self.limits, &host, Retry::ReadOnly, || {
                    self.http.get(url.clone())
                })
                .await?;
                let mime = got
                    .headers
                    .get(reqwest::header::CONTENT_TYPE)
                    .and_then(|h| h.to_str().ok())
                    .unwrap_or_default()
                    .split(';')
                    .next()
                    .unwrap_or_default()
                    .trim()
                    .to_string();
                if got.status != 200 {
                    return Err(plain(format!(
                        "The link answered {} instead of an image.",
                        got.status
                    )));
                }
                if !mime.starts_with("image/") {
                    return Err(plain("That link isn't an image."));
                }
                if got.body.len() > MAX_IMPORT {
                    return Err(plain("That image is over 25 MB."));
                }
                let file = Body::File {
                    name: file_name(&url, &mime),
                    mime,
                    bytes: got.body,
                };
                let q = [("alt_text", alt.to_string())];
                let (m, _) = self
                    .rest_json(&site, Method::POST, "/wp/v2/media", &q, file)
                    .await?;
                Ok(media_from(&m, true))
            }
        }
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

    const PAGE: &str = "<!-- wp:heading -->\n<h2 class=\"wp-block-heading\">Menu</h2>\n<!-- /wp:heading -->\n<!-- wp:image {\"id\":3} -->\n<figure><img src=\"a.jpg\"/></figure>\n<!-- /wp:image -->\n<!-- wp:paragraph -->\n<p>Bread daily.</p>\n<!-- /wp:paragraph -->";

    fn draft(title: &str) -> Draft {
        Draft {
            title: Some(title.into()),
            status: Some("draft".into()),
            ..Default::default()
        }
    }

    fn named(post: &Post, tax: &str) -> Vec<String> {
        post.terms[tax].iter().map(|t| t.name.clone()).collect()
    }

    #[tokio::test]
    async fn classic_monks_creates_edits_and_trashes_content() {
        let (_h, core) = core().await;
        let site = TestSite::start().await;
        let s = core.add_site_oauth(&site.url, browser).await.unwrap();
        let types = core.post_types(s.id).await.unwrap();
        let book = types.iter().find(|t| t.name == "cm_book").unwrap();
        assert_eq!(book.taxonomies[0].name, "cm_genre");

        // A custom post type entry with a new term and an existing one.
        let mut d = draft("Kind of Blue");
        d.terms = Some(BTreeMap::from([(
            "cm_genre".into(),
            vec![TermRef::Name("Jazz".into())],
        )]));
        d.featured_image = Some(0);
        let b = core.create_post(s.id, "cm_book", d).await.unwrap();
        assert_eq!(
            (b.post_type.as_str(), b.status.as_str()),
            ("cm_book", "draft")
        );
        assert_eq!(named(&b, "cm_genre"), ["Jazz"]);
        let jazz = core.terms(s.id, "cm_genre", "Ja").await.unwrap();
        assert_eq!(jazz[0].name, "Jazz");
        let list = core
            .posts(
                s.id,
                &Query {
                    post_type: "cm_book".into(),
                    ..Default::default()
                },
            )
            .await
            .unwrap();
        assert_eq!(
            (list.total, list.posts[0].title.as_str()),
            (1, "Kind of Blue")
        );
        let found = core
            .posts(
                s.id,
                &Query {
                    post_type: "cm_book".into(),
                    search: Some("Blue".into()),
                    page: Some(1),
                    ..Default::default()
                },
            )
            .await
            .unwrap();
        assert_eq!(found.posts.len(), 1);

        // A block page: only the paragraph's text changes.
        let mut d = draft("Menu");
        d.body = Some(PAGE.into());
        let page = core.create_post(s.id, "page", d).await.unwrap();
        assert_eq!(page.blocks.len(), 3);
        assert!(page.blocks[0].editable && !page.blocks[1].editable);
        let edit = Draft {
            title: Some("Our menu".into()),
            edits: vec![BlockEdit {
                index: 2,
                html: "Bread at 7.".into(),
            }],
            seen_modified: Some(page.modified.clone()),
            ..Default::default()
        };
        let saved = core
            .edit_post(s.id, "page", page.id, edit.clone())
            .await
            .unwrap();
        assert_eq!(saved.title, "Our menu");
        assert_eq!(saved.raw, PAGE.replace("Bread daily.", "Bread at 7."));
        let stale = core
            .edit_post(s.id, "page", page.id, edit)
            .await
            .unwrap_err();
        assert!(stale.to_string().contains("changed on the site"), "{stale}");
        let locked = Draft {
            edits: vec![BlockEdit {
                index: 1,
                html: "x".into(),
            }],
            ..Default::default()
        };
        let e = core
            .edit_post(s.id, "page", page.id, locked)
            .await
            .unwrap_err();
        assert!(e.to_string().contains("Only text blocks"), "{e}");
        let e = core
            .edit_post(
                s.id,
                "page",
                page.id,
                Draft {
                    status: Some("future".into()),
                    ..Default::default()
                },
            )
            .await
            .unwrap_err();
        assert!(e.to_string().contains("can't set the status"));
        let e = core
            .edit_post(
                s.id,
                "page",
                page.id,
                Draft {
                    title: Some(" ".into()),
                    ..Default::default()
                },
            )
            .await
            .unwrap_err();
        assert!(e.to_string().contains("can't be empty"));

        // An Elementor page keeps its body; its title can still change.
        site.state()
            .posts
            .iter_mut()
            .find(|p| p["id"] == page.id)
            .unwrap()["builder"] = "elementor".into();
        let p = core.post(s.id, "page", page.id).await.unwrap();
        assert!(p.blocks.is_empty() && p.locked.as_deref().unwrap().contains("Elementor"));
        let body = Draft {
            edits: vec![BlockEdit {
                index: 0,
                html: "x".into(),
            }],
            ..Default::default()
        };
        let e = core
            .edit_post(s.id, "page", page.id, body)
            .await
            .unwrap_err();
        assert!(e.to_string().contains("built with Elementor"), "{e}");
        let renamed = core
            .edit_post(s.id, "page", page.id, draft("Menu (Elementor)"))
            .await
            .unwrap();
        assert_eq!(renamed.title, "Menu (Elementor)");
        assert!(
            site.state()
                .posts
                .iter()
                .any(|p| p["content"] == PAGE.replace("Bread daily.", "Bread at 7."))
        );

        // Media, a featured image, then the trash.
        let m = core
            .import_media(s.id, &format!("{}/img.png", site.url), "A dot")
            .await
            .unwrap();
        assert_eq!(m.alt, "A dot");
        assert_eq!(core.media(s.id, 1, "", true).await.unwrap()[0].id, m.id);
        let with = core
            .edit_post(
                s.id,
                "cm_book",
                b.id,
                Draft {
                    featured_image: Some(m.id),
                    ..Default::default()
                },
            )
            .await
            .unwrap();
        assert_eq!(with.featured_image, m.id);
        assert!(with.featured_url.is_some());
        assert!(core.import_media(s.id, "ftp://x/y.png", "").await.is_err());
        core.trash_post(s.id, "cm_book", b.id).await.unwrap();
        let all = core
            .posts(
                s.id,
                &Query {
                    post_type: "cm_book".into(),
                    ..Default::default()
                },
            )
            .await
            .unwrap();
        assert_eq!(all.total, 0, "the trash isn't in the list");
        let trash = core
            .posts(
                s.id,
                &Query {
                    post_type: "cm_book".into(),
                    status: Some("trash".into()),
                    ..Default::default()
                },
            )
            .await
            .unwrap();
        assert_eq!(trash.total, 1);
        let e = core
            .create_post(s.id, "post", Draft::default())
            .await
            .unwrap_err();
        assert!(e.to_string().contains("title"));
    }

    #[tokio::test]
    async fn a_site_that_changes_blocks_while_saving_is_reported() {
        let (_h, core) = core().await;
        let site = TestSite::start().await;
        let s = core.add_site_oauth(&site.url, browser).await.unwrap();
        let mut d = draft("Menu");
        d.body = Some(PAGE.into());
        let page = core.create_post(s.id, "page", d).await.unwrap();
        site.state().mangle_blocks = true;
        let edit = Draft {
            edits: vec![BlockEdit {
                index: 2,
                html: "Bread at 8.".into(),
            }],
            ..Default::default()
        };
        let e = core
            .edit_post(s.id, "page", page.id, edit)
            .await
            .unwrap_err();
        assert!(e.to_string().contains("changed the page's blocks"), "{e}");
    }

    #[tokio::test]
    async fn older_classic_monks_says_to_update_it() {
        let (_h, core) = core().await;
        let site = TestSite::start().await;
        site.state().no_content_tools = true;
        let s = core.add_site_oauth(&site.url, browser).await.unwrap();
        let e = core.post_types(s.id).await.unwrap_err();
        assert_eq!(e.to_string(), OLD_CLASSIC_MONKS);
        // Classic Monks is updated on the site: the next check sees its new tools.
        site.state().no_content_tools = false;
        core.check_site(s.id).await;
        assert_eq!(core.post_types(s.id).await.unwrap().len(), 3);
    }

    #[tokio::test]
    async fn basic_mode_manages_content_over_rest() {
        let (_h, core) = core().await;
        let site = TestSite::start().await;
        let s = core
            .add_site_basic(&site.url, "admin", "abcd efgh ijkl mnop qrst uvwx")
            .await
            .unwrap();
        let types = core.post_types(s.id).await.unwrap();
        let names: Vec<&str> = types.iter().map(|t| t.name.as_str()).collect();
        assert_eq!(names, ["post", "page"], "a type outside REST isn't seen");
        assert_eq!(types[0].taxonomies[0].rest_base, "categories");

        let m = core
            .import_media(s.id, &format!("{}/img.png", site.url), "A dot")
            .await
            .unwrap();
        assert_eq!((m.mime.as_str(), m.alt.as_str()), ("image/png", "A dot"));
        let e = core
            .import_media(s.id, &format!("{}/page.html", site.url), "")
            .await
            .unwrap_err();
        assert!(e.to_string().contains("isn't an image"));
        let e = core
            .import_media(s.id, &format!("{}/nothing.png", site.url), "")
            .await
            .unwrap_err();
        assert!(e.to_string().contains("answered 404"), "{e}");
        assert_eq!(core.media(s.id, 1, "", true).await.unwrap().len(), 1);
        assert!(
            core.media(s.id, 2, "dot", false).await.unwrap().is_empty(),
            "past the last page"
        );

        let mut d = draft("Hello");
        d.body = Some("<p>Hi</p>".into());
        d.featured_image = Some(m.id);
        d.terms = Some(BTreeMap::from([(
            "category".into(),
            vec![
                TermRef::Id(1),
                TermRef::Name("News".into()),
                TermRef::Name("news".into()),
            ],
        )]));
        let p = core.create_post(s.id, "post", d).await.unwrap();
        let mut cats = named(&p, "category");
        cats.sort();
        assert_eq!(
            cats,
            ["News", "News", "Uncategorized"],
            "a name is matched in any case, not added twice"
        );
        assert_eq!(site.state().terms.len(), 2);
        assert_eq!(
            p.featured_url.as_deref(),
            Some(format!("{}/wp-content/uploads/img.png", site.url).as_str())
        );
        assert_eq!(p.blocks[0].name, "", "a classic body is one block");
        assert_eq!(
            core.terms(s.id, "category", "new").await.unwrap()[0].name,
            "News"
        );
        assert!(core.terms(s.id, "nope", "").await.is_err());

        let edit = Draft {
            edits: vec![BlockEdit {
                index: 0,
                html: "<p>Hello there</p>".into(),
            }],
            status: Some("publish".into()),
            ..Default::default()
        };
        let saved = core.edit_post(s.id, "post", p.id, edit).await.unwrap();
        assert_eq!(
            (saved.raw.as_str(), saved.status.as_str()),
            ("<p>Hello there</p>", "publish")
        );
        let list = core
            .posts(
                s.id,
                &Query {
                    post_type: "post".into(),
                    search: Some("Hel".into()),
                    ..Default::default()
                },
            )
            .await
            .unwrap();
        assert_eq!((list.total, list.posts[0].author.as_str()), (1, "admin"));
        let bad = Draft {
            terms: Some(BTreeMap::from([("cm_genre".into(), vec![])])),
            ..Default::default()
        };
        assert!(
            core.edit_post(s.id, "post", p.id, bad)
                .await
                .unwrap_err()
                .to_string()
                .contains("no taxonomy")
        );
        assert!(
            core.post(s.id, "post", 999)
                .await
                .unwrap_err()
                .to_string()
                .contains("Invalid post ID")
        );
        assert!(
            core.post(s.id, "cm_book", p.id)
                .await
                .unwrap_err()
                .to_string()
                .contains("no post type")
        );
        core.trash_post(s.id, "post", p.id).await.unwrap();
        assert_eq!(
            core.posts(
                s.id,
                &Query {
                    post_type: "post".into(),
                    ..Default::default()
                }
            )
            .await
            .unwrap()
            .total,
            0
        );

        // A Bricks page shows as locked in Basic mode too.
        site.state().posts[0]["builder"] = "bricks".into();
        assert!(
            core.post(s.id, "post", p.id)
                .await
                .unwrap()
                .locked
                .unwrap()
                .contains("Bricks")
        );

        // A changed application password: sign in again.
        site.state().app_password = "changed".into();
        let e = core.post_types(s.id).await.unwrap_err();
        assert!(matches!(e, SiteError::SignInAgain), "{e}");
        assert!(core.site(s.id).unwrap().sign_in_again);
    }

    #[test]
    fn post_types_read_the_same_from_classic_monks_and_rest() {
        let cm = types_from_cm(&json!({ "post_types": [{
            "name": "cm_book", "label": "Books", "singular": "Book", "hierarchical": false,
            "supports": ["title", "editor"], "can_publish": true, "can_delete": false,
            "taxonomies": [{ "name": "cm_genre", "label": "Genres", "hierarchical": false, "can_add": true }],
        }] }));
        assert_eq!(cm[0].singular, "Book");
        assert!(cm[0].can_publish && !cm[0].can_delete);
        assert_eq!(cm[0].taxonomies[0].name, "cm_genre");

        let rest = types_from_rest(
            &json!({
                "attachment": { "name": "Media", "rest_base": "media", "taxonomies": [] },
                "wp_block": { "name": "Patterns", "rest_base": "blocks", "taxonomies": [] },
                "cm_book": { "name": "Books", "labels": { "singular_name": "Book" }, "rest_base": "books", "taxonomies": ["cm_genre", "gone"], "supports": { "title": true, "comments": false } },
                "page": { "name": "Pages", "rest_base": "pages", "hierarchical": true, "taxonomies": [] },
                "post": { "name": "Posts", "rest_base": "posts", "taxonomies": ["category"] },
            }),
            &json!({
                "category": { "slug": "category", "name": "Categories", "hierarchical": true, "rest_base": "categories" },
                "cm_genre": { "slug": "cm_genre", "name": "Genres", "rest_base": "genres" },
            }),
        );
        let names: Vec<&str> = rest.iter().map(|t| t.name.as_str()).collect();
        assert_eq!(
            names,
            ["post", "page", "cm_book"],
            "internal types left out"
        );
        assert_eq!(rest[2].singular, "Book");
        assert_eq!(rest[2].supports, ["title"]);
        assert_eq!(
            rest[2].taxonomies.len(),
            1,
            "an unknown taxonomy is skipped"
        );
        assert_eq!(rest[2].taxonomies[0].rest_base, "genres");
        assert_eq!(rest[1].singular, "Pages", "no labels: the plural");
        assert!(rest[1].hierarchical);
    }

    #[test]
    fn a_post_reads_its_blocks_or_says_why_the_body_is_locked() {
        let p = post_from_cm(&json!({
            "id": 7, "type": "page", "title": "Menu", "status": "draft", "date": "2026-10-28 09:00:00",
            "modified": "2026-10-28 09:05:00", "permalink": "https://a.local/menu/",
            "content": "<!-- wp:paragraph --><p>Hi</p><!-- /wp:paragraph -->",
            "featured_image": "https://a.local/x.jpg", "featured_image_id": 12,
            "terms": { "category": [{ "id": 3, "name": "News", "slug": "news" }] }, "builder": null,
        }));
        assert_eq!(p.blocks.len(), 1);
        assert!(p.locked.is_none());
        assert_eq!(p.terms["category"][0].name, "News");
        assert_eq!(p.featured_image, 12);

        let el = post_from_cm(&json!({ "id": 8, "content": "<p>x</p>", "builder": "elementor" }));
        assert!(el.blocks.is_empty());
        assert!(el.locked.unwrap().contains("built with Elementor"));
        let broken = post_from_cm(&json!({ "id": 9, "content": "<!-- wp:paragraph --><p>x</p>" }));
        assert!(broken.locked.unwrap().contains("can't read"));

        let ty = PostType {
            name: "post".into(),
            label: "Posts".into(),
            singular: "Post".into(),
            hierarchical: false,
            supports: vec![],
            can_publish: true,
            can_delete: true,
            taxonomies: vec![Taxonomy {
                name: "category".into(),
                label: "Categories".into(),
                hierarchical: true,
                can_add: true,
                rest_base: "categories".into(),
            }],
            rest_base: "posts".into(),
        };
        let r = post_from_rest(
            &json!({
                "id": 5, "type": "post", "title": { "raw": "Hello", "rendered": "Hello" }, "status": "publish",
                "date": "2026-10-28T09:00:00", "modified": "2026-10-28T09:01:00", "link": "https://c.local/hello/",
                "content": { "raw": "<p>Hi</p>", "rendered": "<div class=\"brxe-section\">x</div>" },
                "featured_media": 0, "categories": [1, 4],
            }),
            &ty,
        );
        assert_eq!(r.title, "Hello");
        assert_eq!(r.date, "2026-10-28 09:00:00");
        assert_eq!(r.terms["category"].len(), 2);
        assert_eq!(r.builder.as_deref(), Some("bricks"));
        assert!(r.locked.unwrap().contains("Bricks"));
        assert_eq!(
            builder_in("<div data-elementor-type=\"wp-page\">").as_deref(),
            Some("elementor")
        );
        assert_eq!(builder_in("<p>plain</p>"), None);
    }

    #[test]
    fn lists_media_and_small_helpers() {
        let s = summary(
            &json!({ "id": 1, "title": "A", "status": "draft", "date": "2026-10-28 09:00:00", "author": "Joy", "permalink": "https://a/?p=1" }),
            false,
        );
        assert_eq!(
            (s.author.as_str(), s.link.as_str()),
            ("Joy", "https://a/?p=1")
        );
        let r = summary(
            &json!({ "id": 2, "title": { "rendered": "B" }, "date": "2026-10-28T09:00:00", "_embedded": { "author": [{ "name": "admin" }] }, "link": "https://c/b/" }),
            true,
        );
        assert_eq!((r.title.as_str(), r.author.as_str()), ("B", "admin"));
        assert_eq!(listing(vec![], 41, 1).pages, 3);
        assert_eq!(listing(vec![], 0, 1).pages, 1);
        let m = media_from(
            &json!({ "id": 3, "title": { "rendered": "Shop" }, "source_url": "https://c/s.jpg", "mime_type": "image/jpeg", "alt_text": "The shop", "date": "2026-10-28T09:00:00" }),
            true,
        );
        assert_eq!(
            (m.url.as_str(), m.alt.as_str()),
            ("https://c/s.jpg", "The shop")
        );
        assert!(check_status(&Some("future".into())).is_err());
        assert!(check_status(&Some("draft".into())).is_ok() && check_status(&None).is_ok());
        let u = reqwest::Url::parse("https://x.test/a/photo.jpg?w=2").unwrap();
        assert_eq!(file_name(&u, "image/jpeg"), "photo.jpg");
        let u = reqwest::Url::parse("https://x.test/render").unwrap();
        assert_eq!(file_name(&u, "image/png"), "image.png");
        let t: Vec<TermRef> = serde_json::from_value(json!([3, "News"])).unwrap();
        assert_eq!(t, [TermRef::Id(3), TermRef::Name("News".into())]);
    }
}
