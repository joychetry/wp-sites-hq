//! Search numbers for reports, both off until turned on in Settings:
//! Google Search Console (read-only, through your own Google OAuth client and a
//! loopback sign-in with PKCE), and AgentedSEO's abilities on sites that have it.
//!
//! AgentedSEO is still being built, so its reader is tolerant: it takes
//! `get-page-stats` as `{ totals?: { clicks, impressions, position }, pages: [{ url, clicks, impressions, position }] }`
//! and `get-audit-issues` as `{ issues: [{ severity, ... }] }` or `{ counts: { severity: n } }`,
//! and skips what isn't there.

use std::collections::BTreeMap;

use reqwest::Url;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::Core;
use crate::connect::{SiteError, plain};
use crate::net::{self, Retry};
use crate::oauth::{self, Loopback, Tokens};
use crate::sites::{Mode, Site};

pub const SCOPE: &str = "https://www.googleapis.com/auth/webmasters.readonly";
const CLIENT: &str = "google-search-console-client";
const TOKENS: &str = "google-search-console-tokens";
const GOOGLE: &str = "google";
pub const GSC_OFF: &str = "Search Console is off. Turn it on in Settings.";
pub const GSC_NO_CLIENT: &str = "Add your Google OAuth client ID and secret in Settings first.";
pub const GSC_NOT_CONNECTED: &str = "Connect your Google account in Settings first.";

#[derive(Serialize, Deserialize)]
struct GoogleClient {
    id: String,
    secret: String,
}

#[derive(Debug, Default, Clone, Serialize, PartialEq, Eq)]
pub struct GscStatus {
    pub on: bool,
    pub client: bool,
    pub connected: bool,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize, PartialEq)]
pub struct SearchRow {
    pub query: String,
    pub clicks: f64,
    pub impressions: f64,
    pub ctr: f64,
    pub position: f64,
}

#[derive(Debug, Default, Clone, Serialize, Deserialize, PartialEq)]
pub struct SearchStats {
    /// The Search Console property that answered.
    pub property: String,
    pub from: String,
    pub to: String,
    pub clicks: f64,
    pub impressions: f64,
    pub ctr: f64,
    pub position: f64,
    pub top_queries: Vec<SearchRow>,
}

/// What AgentedSEO says about one site. Missing numbers stay `None`.
#[derive(Debug, Default, Clone, Serialize, Deserialize, PartialEq)]
pub struct SeoSummary {
    pub version: String,
    pub clicks: Option<f64>,
    pub impressions: Option<f64>,
    pub position: Option<f64>,
    /// Address and clicks, most first.
    pub top_pages: Vec<(String, f64)>,
    /// Open audit issues by severity.
    pub issues: BTreeMap<String, i64>,
}

fn row(v: &Value) -> SearchRow {
    SearchRow {
        query: v["keys"][0].as_str().unwrap_or_default().to_string(),
        clicks: v["clicks"].as_f64().unwrap_or_default(),
        impressions: v["impressions"].as_f64().unwrap_or_default(),
        ctr: v["ctr"].as_f64().unwrap_or_default(),
        position: v["position"].as_f64().unwrap_or_default(),
    }
}

/// The properties a site may be in Search Console as: its address, then its domain.
fn properties(site_url: &str) -> Vec<String> {
    let url = site_url.trim_end_matches('/');
    let mut out = vec![format!("{url}/")];
    if let Some(host) = Url::parse(url)
        .ok()
        .and_then(|u| u.host_str().map(String::from))
    {
        out.push(format!("sc-domain:{}", host.trim_start_matches("www.")));
    }
    out
}

/// The AgentedSEO ability as this site's Classic Monks lists it.
fn seo_tool(site: &Site, name: &str) -> Option<String> {
    let tools = site.capabilities["abilities"].as_array()?;
    ["agentedseo_", "agentedseo/", "agentedseo-", "agented-seo/"]
        .iter()
        .map(|p| format!("{p}{name}"))
        .find(|t| tools.iter().any(|x| x == t.as_str()))
}

/// Reads AgentedSEO's replies, taking only the fields it recognises.
pub(crate) fn read_seo(
    caps: Option<&Value>,
    stats: Option<&Value>,
    issues: Option<&Value>,
) -> SeoSummary {
    let mut s = SeoSummary {
        version: caps
            .and_then(|c| c["version"].as_str().or(c["plugin"]["version"].as_str()))
            .unwrap_or_default()
            .to_string(),
        ..Default::default()
    };
    if let Some(v) = stats {
        let pages = v["pages"].as_array().cloned().unwrap_or_default();
        let sum = |k: &str| {
            let n: Vec<f64> = pages.iter().filter_map(|p| p[k].as_f64()).collect();
            (!n.is_empty()).then(|| n.iter().sum())
        };
        s.clicks = v["totals"]["clicks"].as_f64().or_else(|| sum("clicks"));
        s.impressions = v["totals"]["impressions"]
            .as_f64()
            .or_else(|| sum("impressions"));
        s.position = v["totals"]["position"].as_f64();
        let mut top: Vec<(String, f64)> = pages
            .iter()
            .filter_map(|p| {
                let url = p["url"].as_str().or(p["page"].as_str())?;
                Some((url.to_string(), p["clicks"].as_f64().unwrap_or_default()))
            })
            .collect();
        top.sort_by(|a, b| b.1.total_cmp(&a.1));
        top.truncate(5);
        s.top_pages = top;
    }
    if let Some(v) = issues {
        if let Some(list) = v["issues"].as_array() {
            for i in list {
                let sev = i["severity"].as_str().unwrap_or("other").to_string();
                *s.issues.entry(sev).or_default() += 1;
            }
        } else if let Some(counts) = v["counts"].as_object() {
            for (k, n) in counts {
                if let Some(n) = n.as_i64() {
                    s.issues.insert(k.clone(), n);
                }
            }
        }
    }
    s
}

impl Core {
    pub fn gsc_status(&self) -> Result<GscStatus, SiteError> {
        Ok(GscStatus {
            on: self.app_settings()?.search_console,
            client: self.open_named::<GoogleClient>(CLIENT)?.is_some(),
            connected: self.open_named::<Tokens>(TOKENS)?.is_some(),
        })
    }

    /// Your own Google OAuth client ("Desktop app" type), kept in the vault.
    pub fn gsc_set_client(&self, id: &str, secret: &str) -> Result<GscStatus, SiteError> {
        let (id, secret) = (id.trim(), secret.trim());
        let fine = |s: &str| !s.is_empty() && s.len() <= 300 && !s.chars().any(char::is_whitespace);
        if !fine(id) || !fine(secret) {
            return Err(plain(
                "Paste the client ID and the client secret from Google Cloud.",
            ));
        }
        self.save_named(
            CLIENT,
            &GoogleClient {
                id: id.into(),
                secret: secret.into(),
            },
        )?;
        // A new client's sign-in is a new one.
        self.db(|c| self.delete_named(c, TOKENS))?;
        self.gsc_status()
    }

    /// Forget the Google sign-in and the client.
    pub fn gsc_forget(&self) -> Result<GscStatus, SiteError> {
        self.db(|c| {
            self.delete_named(c, TOKENS)?;
            self.delete_named(c, CLIENT)
        })?;
        self.gsc_status()
    }

    /// Sign in to Google in the browser and keep the tokens. Read-only scope.
    pub async fn gsc_connect(
        &self,
        open: impl FnOnce(&str) -> std::io::Result<()>,
    ) -> Result<GscStatus, SiteError> {
        if !self.app_settings()?.search_console {
            return Err(plain(GSC_OFF));
        }
        let client: GoogleClient = self
            .open_named(CLIENT)?
            .ok_or_else(|| plain(GSC_NO_CLIENT))?;
        let back = Loopback::bind()
            .await
            .map_err(|e| plain(format!("Couldn't open the sign-in return address: {e}")))?;
        let redirect_uri = back.redirect_uri.clone();
        let pkce = oauth::pkce();
        let state = oauth::random_token(24);
        let mut url = Url::parse(&self.feeds.google_auth)
            .map_err(|_| plain("The Google sign-in address isn't valid."))?;
        url.query_pairs_mut()
            .append_pair("response_type", "code")
            .append_pair("client_id", &client.id)
            .append_pair("redirect_uri", &redirect_uri)
            .append_pair("scope", SCOPE)
            .append_pair("state", &state)
            .append_pair("code_challenge", &pkce.challenge)
            .append_pair("code_challenge_method", "S256")
            .append_pair("access_type", "offline")
            .append_pair("prompt", "consent");
        open(url.as_str()).map_err(|e| plain(format!("Couldn't open the browser: {e}")))?;
        let code = tokio::time::timeout(
            std::time::Duration::from_secs(300),
            back.wait(&state, "https://accounts.google.com"),
        )
        .await
        .map_err(|_| plain("The Google sign-in took more than 5 minutes. Try again."))?
        .map_err(|e| plain(e.to_string()))?;
        let form = [
            ("grant_type", "authorization_code"),
            ("code", code.as_str()),
            ("client_id", client.id.as_str()),
            ("client_secret", client.secret.as_str()),
            ("redirect_uri", redirect_uri.as_str()),
            ("code_verifier", pkce.verifier.as_str()),
        ];
        let reply = net::send(&self.limits, GOOGLE, Retry::Write, || {
            self.http.post(&self.feeds.google_token).form(&form)
        })
        .await?;
        let tokens = google_tokens(&reply, None).ok_or_else(|| {
            plain(
                "Google didn't finish the sign-in. Check the client ID and secret, then try again.",
            )
        })?;
        self.save_named(TOKENS, &tokens)?;
        self.gsc_status()
    }

    /// A fresh access token, refreshed when it's about to run out.
    async fn gsc_token(&self) -> Result<String, SiteError> {
        let tokens: Tokens = self
            .open_named(TOKENS)?
            .ok_or_else(|| plain(GSC_NOT_CONNECTED))?;
        if !tokens.expiring() {
            return Ok(tokens.access_token);
        }
        let client: GoogleClient = self
            .open_named(CLIENT)?
            .ok_or_else(|| plain(GSC_NO_CLIENT))?;
        let form = [
            ("grant_type", "refresh_token"),
            ("refresh_token", tokens.refresh_token.as_str()),
            ("client_id", client.id.as_str()),
            ("client_secret", client.secret.as_str()),
        ];
        let reply = net::send(&self.limits, GOOGLE, Retry::ReadOnly, || {
            self.http.post(&self.feeds.google_token).form(&form)
        })
        .await?;
        let fresh = google_tokens(&reply, Some(&tokens.refresh_token)).ok_or_else(|| {
            plain("Google said no to the saved sign-in. Connect your Google account again in Settings.")
        })?;
        self.save_named(TOKENS, &fresh)?;
        Ok(fresh.access_token)
    }

    /// Clicks, impressions, CTR, position and the top 10 queries between two days.
    pub async fn search_stats(
        &self,
        id: i64,
        from: &str,
        to: &str,
    ) -> Result<SearchStats, SiteError> {
        if !self.app_settings()?.search_console {
            return Err(plain(GSC_OFF));
        }
        let site = self.site(id)?;
        let token = self.gsc_token().await?;
        let mut last = None;
        for property in properties(&site.url) {
            let mut url = Url::parse(&self.feeds.search_console)
                .map_err(|_| plain("The Search Console address isn't valid."))?;
            url.path_segments_mut()
                .map_err(|_| plain("The Search Console address isn't valid."))?
                .extend(["sites", property.as_str(), "searchAnalytics", "query"]);
            let ask = |dims: Value, limit: u32| {
                let body = json!({ "startDate": from, "endDate": to, "dimensions": dims, "rowLimit": limit });
                let url = url.clone();
                let token = token.clone();
                async move {
                    net::send(&self.limits, GOOGLE, Retry::ReadOnly, || {
                        self.http.post(url.clone()).bearer_auth(&token).json(&body)
                    })
                    .await
                }
            };
            let total = ask(json!([]), 1).await?;
            if total.status == 403 || total.status == 404 {
                last = Some(total.status);
                continue;
            }
            if total.status != 200 {
                return Err(plain(format!(
                    "Search Console answered {}. Try again later.",
                    total.status
                )));
            }
            let queries = ask(json!(["query"]), 10).await?;
            let t = total
                .json::<Value>()
                .map(|v| row(&v["rows"][0]))
                .unwrap_or_default();
            let top = queries
                .json::<Value>()
                .and_then(|v| v["rows"].as_array().map(|r| r.iter().map(row).collect()))
                .unwrap_or_default();
            return Ok(SearchStats {
                property,
                from: from.into(),
                to: to.into(),
                clicks: t.clicks,
                impressions: t.impressions,
                ctr: t.ctr,
                position: t.position,
                top_queries: top,
            });
        }
        Err(plain(match last {
            Some(403) => format!(
                "Your Google account can't read {} in Search Console.",
                site.url
            ),
            _ => format!("Search Console has no property for {}.", site.url),
        }))
    }

    /// AgentedSEO's numbers on one site, or `None` when it's off or the site hasn't it.
    pub async fn agentedseo(&self, id: i64, days: u32) -> Result<Option<SeoSummary>, SiteError> {
        let _work = self.working().await;
        self.agentedseo_inner(id, days).await
    }

    pub(crate) async fn agentedseo_inner(
        &self,
        id: i64,
        days: u32,
    ) -> Result<Option<SeoSummary>, SiteError> {
        if !self.app_settings()?.agentedseo {
            return Ok(None);
        }
        let site = self.site(id)?;
        if site.mode != Mode::ClassicMonks {
            return Ok(None);
        }
        let (caps, stats, issues) = (
            seo_tool(&site, "get-capabilities"),
            seo_tool(&site, "get-page-stats"),
            seo_tool(&site, "get-audit-issues"),
        );
        if stats.is_none() && issues.is_none() {
            return Ok(None);
        }
        let call = |tool: Option<String>, args: Value| async move {
            match tool {
                Some(t) => Some(self.call_ability_inner(id, &t, args).await).transpose(),
                None => Ok(None),
            }
        };
        let caps = call(caps, json!({})).await?;
        let stats = call(stats, json!({ "days": days.clamp(1, 365) })).await?;
        let issues = call(issues, json!({})).await?;
        Ok(Some(read_seo(
            caps.as_ref(),
            stats.as_ref(),
            issues.as_ref(),
        )))
    }
}

/// Google's token reply. A refresh may leave out the refresh token: keep the old one.
fn google_tokens(reply: &net::Reply, old_refresh: Option<&str>) -> Option<Tokens> {
    if reply.status != 200 {
        return None;
    }
    let v: Value = reply.json()?;
    Some(Tokens {
        access_token: v["access_token"].as_str()?.to_string(),
        refresh_token: v["refresh_token"].as_str().or(old_refresh)?.to_string(),
        expires_at: oauth::now() + v["expires_in"].as_i64().unwrap_or(3600),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Options;
    use crate::business::AppSettings;
    use crate::security::Feeds;
    use crate::testsite::TestSite;
    use axum::extract::{Form, Path, Query, State as Ax};
    use axum::http::{HeaderMap, StatusCode};
    use axum::response::{IntoResponse, Redirect};
    use axum::routing::{get, post};
    use axum::{Json, Router};
    use base64::Engine;
    use sha2::{Digest, Sha256};
    use std::collections::HashMap;
    use std::sync::{Arc, Mutex};

    /// A stand-in for Google: sign-in, tokens, and Search Console's query.
    #[derive(Default)]
    struct Google {
        challenge: String,
        refreshes: usize,
        bodies: Vec<(String, Value)>,
    }
    type G = Arc<Mutex<Google>>;

    async fn auth(Ax(g): Ax<G>, Query(q): Query<HashMap<String, String>>) -> Redirect {
        assert_eq!(q["scope"], SCOPE);
        assert_eq!(q["code_challenge_method"], "S256");
        g.lock().unwrap().challenge = q["code_challenge"].clone();
        Redirect::to(&format!(
            "{}?code=c0de&state={}",
            q["redirect_uri"], q["state"]
        ))
    }

    async fn token(Ax(g): Ax<G>, Form(f): Form<HashMap<String, String>>) -> impl IntoResponse {
        let mut g = g.lock().unwrap();
        assert_eq!(f["client_secret"], "s3cret");
        if f["grant_type"] == "refresh_token" {
            g.refreshes += 1;
            return Json(json!({ "access_token": "fresh", "expires_in": 3600 })).into_response();
        }
        let sum = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .encode(Sha256::digest(f["code_verifier"].as_bytes()));
        if f["code"] != "c0de" || sum != g.challenge {
            return (
                StatusCode::BAD_REQUEST,
                Json(json!({ "error": "invalid_grant" })),
            )
                .into_response();
        }
        // Already expired, so the first query refreshes it.
        Json(json!({ "access_token": "old", "refresh_token": "r1", "expires_in": 0 }))
            .into_response()
    }

    async fn query(
        Ax(g): Ax<G>,
        Path(site): Path<String>,
        h: HeaderMap,
        Json(body): Json<Value>,
    ) -> impl IntoResponse {
        assert_eq!(h["authorization"], "Bearer fresh");
        g.lock().unwrap().bodies.push((site.clone(), body.clone()));
        if !site.starts_with("sc-domain:") {
            return (
                StatusCode::FORBIDDEN,
                Json(json!({ "error": { "code": 403 } })),
            )
                .into_response();
        }
        if body["dimensions"].as_array().unwrap().is_empty() {
            return Json(json!({ "rows": [{ "clicks": 120.0, "impressions": 4000.0, "ctr": 0.03, "position": 8.4 }] })).into_response();
        }
        Json(json!({ "rows": [{ "keys": ["sourdough near me"], "clicks": 40.0, "impressions": 900.0, "ctr": 0.044, "position": 3.2 }] })).into_response()
    }

    async fn google() -> (String, G) {
        let g: G = Arc::default();
        let app = Router::new()
            .route("/auth", get(auth))
            .route("/token", post(token))
            .route(
                "/webmasters/v3/sites/{site}/searchAnalytics/query",
                post(query),
            )
            .with_state(g.clone());
        let l = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", l.local_addr().unwrap());
        tokio::spawn(async move { axum::serve(l, app).await });
        (url, g)
    }

    async fn core(google: &str) -> (tempfile::TempDir, Arc<Core>) {
        let home = tempfile::tempdir().unwrap();
        let opts = Options {
            keychain: Ok(keyring_core::mock::Store::new().unwrap()),
            feeds: Feeds {
                google_auth: format!("{google}/auth"),
                google_token: format!("{google}/token"),
                search_console: format!("{google}/webmasters/v3"),
                ..Feeds::default()
            },
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
    async fn search_console_signs_in_with_pkce_and_reads_a_domain_property() {
        let (gurl, g) = google().await;
        let (_h, core) = core(&gurl).await;
        let site = TestSite::start().await;
        let s = core.add_site_oauth(&site.url, browser).await.unwrap();

        // Off by default: nothing reaches Google.
        assert_eq!(
            core.gsc_connect(browser).await.unwrap_err().to_string(),
            GSC_OFF
        );
        assert_eq!(
            core.search_stats(s.id, "2026-09-01", "2026-09-30")
                .await
                .unwrap_err()
                .to_string(),
            GSC_OFF
        );
        core.save_app_settings(&AppSettings {
            search_console: true,
            ..Default::default()
        })
        .unwrap();
        assert_eq!(
            core.gsc_connect(browser).await.unwrap_err().to_string(),
            GSC_NO_CLIENT
        );
        assert!(core.gsc_set_client("id 1", "x").is_err());
        core.gsc_set_client("123.apps.googleusercontent.com", "s3cret")
            .unwrap();
        assert_eq!(
            core.search_stats(s.id, "2026-09-01", "2026-09-30")
                .await
                .unwrap_err()
                .to_string(),
            GSC_NOT_CONNECTED
        );

        let st = core.gsc_connect(browser).await.unwrap();
        assert_eq!(
            st,
            GscStatus {
                on: true,
                client: true,
                connected: true
            }
        );
        let stats = core
            .search_stats(s.id, "2026-09-01", "2026-09-30")
            .await
            .unwrap();
        assert_eq!(stats.property, "sc-domain:127.0.0.1");
        assert_eq!(
            (stats.clicks, stats.impressions, stats.position),
            (120.0, 4000.0, 8.4)
        );
        assert_eq!(stats.top_queries[0].query, "sourdough near me");
        {
            let g = g.lock().unwrap();
            assert_eq!(g.refreshes, 1);
            // The address property first, then the domain; two queries there.
            assert_eq!(g.bodies.len(), 3);
            assert!(g.bodies[0].0.starts_with("http://127.0.0.1"));
            assert_eq!(g.bodies[1].1["startDate"], "2026-09-01");
        }
        // The refreshed token is kept: no second refresh.
        core.search_stats(s.id, "2026-09-01", "2026-09-30")
            .await
            .unwrap();
        assert_eq!(g.lock().unwrap().refreshes, 1);

        assert_eq!(
            core.gsc_forget().unwrap(),
            GscStatus {
                on: true,
                client: false,
                connected: false
            }
        );
    }

    #[test]
    fn agentedseo_replies_are_read_loosely() {
        let s = read_seo(
            Some(&json!({ "version": "0.3.0" })),
            Some(
                &json!({ "pages": [{ "url": "/a", "clicks": 5, "impressions": 50 }, { "page": "/b", "clicks": 9 }, { "clicks": 1 }] }),
            ),
            Some(
                &json!({ "issues": [{ "severity": "error" }, { "severity": "warning" }, { "severity": "error" }, {}] }),
            ),
        );
        assert_eq!(s.version, "0.3.0");
        assert_eq!(
            (s.clicks, s.impressions, s.position),
            (Some(15.0), Some(50.0), None)
        );
        assert_eq!(
            s.top_pages,
            [("/b".to_string(), 9.0), ("/a".to_string(), 5.0)]
        );
        assert_eq!(
            s.issues,
            BTreeMap::from([
                ("error".into(), 2),
                ("warning".into(), 1),
                ("other".into(), 1)
            ])
        );
        let t = read_seo(
            None,
            Some(&json!({ "totals": { "clicks": 7, "position": 4.5 } })),
            Some(&json!({ "counts": { "error": 3 } })),
        );
        assert_eq!(
            (t.clicks, t.position, t.version.as_str()),
            (Some(7.0), Some(4.5), "")
        );
        assert_eq!(t.issues["error"], 3);
        assert_eq!(
            read_seo(None, Some(&json!("nonsense")), None),
            SeoSummary::default()
        );
        assert_eq!(
            properties("https://www.shop.test/"),
            ["https://www.shop.test/", "sc-domain:shop.test"]
        );
    }

    #[tokio::test]
    async fn agentedseo_is_read_only_when_on_and_on_the_site() {
        let (_h, core) = core("http://127.0.0.1:9").await;
        let site = TestSite::start().await;
        site.state().agentedseo = true;
        let s = core.add_site_oauth(&site.url, browser).await.unwrap();
        assert_eq!(core.agentedseo(s.id, 30).await.unwrap(), None);
        core.save_app_settings(&AppSettings {
            agentedseo: true,
            ..Default::default()
        })
        .unwrap();
        let got = core.agentedseo(s.id, 30).await.unwrap().unwrap();
        assert_eq!(got.clicks, Some(320.0));
        assert_eq!(got.issues["error"], 1);
        let days: Vec<_> = site
            .state()
            .calls
            .iter()
            .filter(|(t, _)| t == "agentedseo_get-page-stats")
            .map(|(_, a)| a["days"].clone())
            .collect();
        assert_eq!(days, [json!(30)]);

        let other = TestSite::start().await;
        let o = core.add_site_oauth(&other.url, browser).await.unwrap();
        assert_eq!(core.agentedseo(o.id, 30).await.unwrap(), None);
    }
}
