// SPDX-License-Identifier: GPL-3.0-or-later
//! OAuth 2.1 client for Classic Monks (plan 5.4): discovery from the
//! protected-resource document, dynamic client registration, PKCE S256, a
//! loopback redirect, code exchange, refresh and revoke.

use std::time::{SystemTime, UNIX_EPOCH};

use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use reqwest::Url;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;

use crate::net::{self, Limits, Reply, Retry};

/// Registered once per site; the loopback port is ignored by the server (RFC 8252 7.3).
pub const REDIRECT_URI: &str = "http://127.0.0.1/callback";
pub const CLIENT_NAME: &str = "WP Sites HQ";
/// The grant AI agents use: not the operator, so the site's approvals apply.
pub const AGENT_CLIENT_NAME: &str = "WP Sites HQ (AI agents)";

#[derive(Debug, thiserror::Error)]
pub enum OAuthError {
    #[error(transparent)]
    Net(#[from] net::NetError),
    #[error("{0}")]
    Site(String),
}

fn site_err(msg: impl Into<String>) -> OAuthError {
    OAuthError::Site(msg.into())
}

/// What a Classic Monks site says about itself.
#[derive(Debug, Clone)]
pub struct Discovery {
    /// The MCP endpoint, from the protected-resource `resource` value.
    pub resource: String,
    pub resource_name: Option<String>,
    pub issuer: String,
    pub authorization_endpoint: String,
    pub token_endpoint: String,
    pub registration_endpoint: Option<String>,
    pub revocation_endpoint: Option<String>,
}

#[derive(Deserialize)]
struct ProtectedResource {
    resource: String,
    #[serde(default)]
    authorization_servers: Vec<String>,
    resource_name: Option<String>,
}

#[derive(Deserialize)]
struct ServerMetadata {
    issuer: String,
    authorization_endpoint: String,
    token_endpoint: String,
    registration_endpoint: Option<String>,
    revocation_endpoint: Option<String>,
    #[serde(default)]
    code_challenge_methods_supported: Vec<String>,
}

/// Where Classic Monks' MCP endpoint lives under the REST base.
const MCP_ROUTE: &str = "/classic-monks/v1/mcp";

/// `None` when the site has no Classic Monks MCP endpoint (or it is switched off).
///
/// Other plugins (Novamira) answer the generic well-known addresses too, so the
/// endpoint's own 401 and the resource-specific document come first.
pub async fn discover(
    http: &reqwest::Client,
    limits: &Limits,
    site: &Url,
) -> Result<Option<Discovery>, OAuthError> {
    let key = site.as_str();
    let base = crate::sites::url_string(site);
    let origin = site.origin().ascii_serialization();
    let site_path = site.path().trim_end_matches('/');

    let mut found = None;
    // RFC 9728 5.1: the endpoint's 401 names its own document.
    for endpoint in [
        format!("{base}/wp-json{MCP_ROUTE}"),
        format!("{base}/?rest_route={MCP_ROUTE}"),
    ] {
        let probe = serde_json::json!({ "jsonrpc": "2.0", "id": 0, "method": "ping" });
        let reply = net::send(limits, key, Retry::Write, || {
            http.post(&endpoint).json(&probe)
        })
        .await?;
        let Some(doc) = (reply.status == 401)
            .then(|| resource_metadata(&reply.headers))
            .flatten()
        else {
            continue;
        };
        on_site(site, &doc)?;
        found = protected_resource(http, limits, key, &doc)
            .await?
            .filter(|pr| is_cm_resource(&pr.resource));
        if found.is_some() {
            break;
        }
    }
    if found.is_none() {
        let doc =
            format!("{origin}/.well-known/oauth-protected-resource{site_path}/wp-json{MCP_ROUTE}");
        found = protected_resource(http, limits, key, &doc)
            .await?
            .filter(|pr| is_cm_resource(&pr.resource));
    }
    let pr = match found {
        Some(pr) => pr,
        // Older connectors only answer the generic address.
        None => {
            let doc = format!("{base}/.well-known/oauth-protected-resource");
            let Some(pr) = protected_resource(http, limits, key, &doc).await? else {
                return Ok(None);
            };
            if !is_cm_resource(&pr.resource) {
                let named = Url::parse(&pr.resource)
                    .map(|u| format!("{}{}", u.host_str().unwrap_or_default(), u.path()))
                    .unwrap_or_else(|_| pr.resource.clone());
                return Err(site_err(format!(
                    "Another plugin on this site (it names {named}) answers WordPress sign-in requests, \
                     and this site's Classic Monks connector is too old to step around it. \
                     Update Classic Monks (or WP Sites HQ) on the site, then try again."
                )));
            }
            pr
        }
    };
    let issuer = pr
        .authorization_servers
        .first()
        .ok_or_else(|| site_err("The site's sign-in details name no sign-in server."))?
        .trim_end_matches('/')
        .to_string();
    on_site(site, &issuer)?;
    let mut meta = None;
    for url in server_metadata_urls(&issuer) {
        let reply = net::send(limits, key, Retry::ReadOnly, || http.get(&url)).await?;
        meta = reply
            .json::<ServerMetadata>()
            .filter(|_| reply.status == 200);
        if meta.is_some() {
            break;
        }
    }
    let meta = meta.ok_or_else(|| site_err("The site's sign-in server didn't describe itself."))?;
    if meta.issuer.trim_end_matches('/') != issuer {
        return Err(site_err(
            "The site's sign-in server gave a different address than the site named.",
        ));
    }
    if !meta
        .code_challenge_methods_supported
        .iter()
        .any(|m| m == "S256")
    {
        return Err(site_err(
            "The site's sign-in server doesn't support PKCE (S256). Update Classic Monks.",
        ));
    }
    for addr in [
        Some(&pr.resource),
        Some(&meta.authorization_endpoint),
        Some(&meta.token_endpoint),
        meta.registration_endpoint.as_ref(),
        meta.revocation_endpoint.as_ref(),
    ]
    .into_iter()
    .flatten()
    {
        on_site(site, addr)?;
    }
    Ok(Some(Discovery {
        resource: pr.resource,
        resource_name: pr.resource_name,
        issuer,
        authorization_endpoint: meta.authorization_endpoint,
        token_endpoint: meta.token_endpoint,
        registration_endpoint: meta.registration_endpoint,
        revocation_endpoint: meta.revocation_endpoint,
    }))
}

/// A protected-resource document, or `None` when this address doesn't serve one.
async fn protected_resource(
    http: &reqwest::Client,
    limits: &Limits,
    key: &str,
    url: &str,
) -> Result<Option<ProtectedResource>, OAuthError> {
    let reply = net::send(limits, key, Retry::ReadOnly, || http.get(url)).await?;
    if net::php_fatal(&reply.body) {
        return Err(site_err(
            "The site answered with a PHP fatal error instead of its sign-in details. Fix the error on the site (its PHP error log names it), then try again.",
        ));
    }
    Ok(reply.json().filter(|_| reply.status == 200))
}

/// The `resource_metadata` parameter of a `WWW-Authenticate` challenge (RFC 9728 5.1).
fn resource_metadata(headers: &reqwest::header::HeaderMap) -> Option<String> {
    headers
        .get_all(reqwest::header::WWW_AUTHENTICATE)
        .iter()
        .filter_map(|v| v.to_str().ok())
        .find_map(resource_metadata_param)
}

fn resource_metadata_param(challenge: &str) -> Option<String> {
    const NAME: &str = "resource_metadata";
    // ASCII lowercasing keeps byte offsets, so `at` indexes `challenge` too.
    let lower = challenge.to_ascii_lowercase();
    let mut from = 0;
    while let Some(i) = lower[from..].find(NAME) {
        let at = from + i;
        from = at + NAME.len();
        let starts_param = at == 0 || matches!(lower.as_bytes()[at - 1], b' ' | b'\t' | b',');
        let Some(rest) = challenge[from..]
            .trim_start()
            .strip_prefix('=')
            .filter(|_| starts_param)
        else {
            continue;
        };
        let rest = rest.trim_start();
        let value = match rest.strip_prefix('"') {
            Some(quoted) => &quoted[..quoted.find('"')?],
            None => rest.split([',', ' ', '\t']).next().unwrap_or_default(),
        };
        if !value.is_empty() {
            return Some(value.to_string());
        }
    }
    None
}

/// Classic Monks' MCP endpoint, in pretty or plain permalink form.
fn is_cm_resource(resource: &str) -> bool {
    Url::parse(resource).is_ok_and(|u| {
        u.path().trim_end_matches('/').ends_with(MCP_ROUTE)
            || u.query_pairs()
                .any(|(k, v)| k == "rest_route" && v.trim_end_matches('/') == MCP_ROUTE)
    })
}

/// RFC 8414 3.1: an issuer with a path puts the well-known part first; the OIDC
/// and appended forms follow for servers that only know those.
fn server_metadata_urls(issuer: &str) -> Vec<String> {
    let append = format!("{issuer}/.well-known/oauth-authorization-server");
    let Ok(url) = Url::parse(issuer) else {
        return vec![append];
    };
    let path = url.path().trim_end_matches('/');
    if path.is_empty() {
        return vec![append];
    }
    let origin = url.origin().ascii_serialization();
    vec![
        format!("{origin}/.well-known/oauth-authorization-server{path}"),
        format!("{origin}/.well-known/openid-configuration{path}"),
        append,
    ]
}

/// Every sign-in and MCP address stays on the site's own host (https may stand in for
/// http), so a site's details can't send codes, tokens or the browser anywhere else.
fn on_site(site: &Url, addr: &str) -> Result<(), OAuthError> {
    let ok = Url::parse(addr).is_ok_and(|u| {
        u.host_str() == site.host_str() && (u.origin() == site.origin() || u.scheme() == "https")
    });
    if ok {
        Ok(())
    } else {
        Err(site_err(
            "The site's sign-in details point to another address. Check the site's address, \
             and that WordPress knows it runs on HTTPS.",
        ))
    }
}

/// RFC 7591. Classic Monks registration is stateless, so a retry is harmless.
pub async fn register(
    http: &reqwest::Client,
    limits: &Limits,
    site: &str,
    d: &Discovery,
    client_name: &str,
) -> Result<String, OAuthError> {
    let endpoint = d
        .registration_endpoint
        .as_deref()
        .ok_or_else(|| site_err("The site doesn't let new apps register. Update Classic Monks."))?;
    let body = serde_json::json!({
        "client_name": client_name,
        "redirect_uris": [REDIRECT_URI],
        "grant_types": ["authorization_code", "refresh_token"],
        "response_types": ["code"],
        "token_endpoint_auth_method": "none",
    });
    let reply = net::send(limits, site, Retry::ReadOnly, || {
        http.post(endpoint).json(&body)
    })
    .await?;
    reply
        .json::<Value>()
        .filter(|_| reply.status == 201 || reply.status == 200)
        .and_then(|v| v["client_id"].as_str().map(String::from))
        .ok_or_else(|| {
            site_err(oauth_message(
                &reply,
                "The site refused to register WP Sites HQ.",
            ))
        })
}

pub fn random_token(bytes: usize) -> String {
    let mut buf = vec![0u8; bytes];
    getrandom::fill(&mut buf).expect("the OS random source works");
    URL_SAFE_NO_PAD.encode(buf)
}

pub struct Pkce {
    pub verifier: String,
    pub challenge: String,
}

pub fn pkce() -> Pkce {
    // 48 bytes = 64 characters, inside the 43-128 RFC 7636 allows.
    let verifier = random_token(48);
    let challenge = URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    Pkce {
        verifier,
        challenge,
    }
}

pub fn authorize_url(
    d: &Discovery,
    client_id: &str,
    redirect_uri: &str,
    state: &str,
    challenge: &str,
) -> Result<String, OAuthError> {
    let mut url = Url::parse(&d.authorization_endpoint)
        .map_err(|_| site_err("The site's sign-in address isn't valid."))?;
    url.query_pairs_mut()
        .append_pair("response_type", "code")
        .append_pair("client_id", client_id)
        .append_pair("redirect_uri", redirect_uri)
        .append_pair("state", state)
        .append_pair("code_challenge", challenge)
        .append_pair("code_challenge_method", "S256")
        .append_pair("resource", &d.resource);
    Ok(url.into())
}

/// The browser comes back to `http://127.0.0.1:<port>/callback`.
pub struct Loopback {
    listener: TcpListener,
    pub redirect_uri: String,
}

impl Loopback {
    pub async fn bind() -> std::io::Result<Self> {
        let listener = TcpListener::bind("127.0.0.1:0").await?;
        let port = listener.local_addr()?.port();
        Ok(Self {
            listener,
            redirect_uri: format!("http://127.0.0.1:{port}/callback"),
        })
    }

    /// Wait for the redirect with our `state`, check `iss` (RFC 9207), and
    /// return the code. Other requests (a favicon) are answered and ignored.
    pub async fn wait(self, state: &str, issuer: &str) -> Result<String, OAuthError> {
        loop {
            let (mut conn, _) = self.listener.accept().await.map_err(|e| {
                site_err(format!("The sign-in return address stopped working: {e}"))
            })?;
            let mut buf = vec![0u8; 8192];
            let mut len = 0;
            // A connection that sends nothing (a browser's preconnect) can't hold up the real one.
            let _ = tokio::time::timeout(std::time::Duration::from_secs(5), async {
                while len < buf.len() && !buf[..len].windows(4).any(|w| w == b"\r\n\r\n") {
                    match conn.read(&mut buf[len..]).await {
                        Ok(0) | Err(_) => break,
                        Ok(n) => len += n,
                    }
                }
            })
            .await;
            let head = String::from_utf8_lossy(&buf[..len]);
            let target = head.split_whitespace().nth(1).unwrap_or("");
            let Ok(url) = Url::parse(&format!("http://127.0.0.1{target}")) else {
                continue;
            };
            if url.path() != "/callback" {
                let _ = conn
                    .write_all(
                        b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n",
                    )
                    .await;
                continue;
            }
            let q: std::collections::HashMap<_, _> = url.query_pairs().into_owned().collect();
            if q.get("state").map(String::as_str) != Some(state) {
                // Not ours (an old tab, or another program): say so, and keep waiting.
                let _ = conn.write_all(&page(STRANGER)).await;
                continue;
            }
            let result = if q
                .get("iss")
                .is_some_and(|i| i.trim_end_matches('/') != issuer)
            {
                Err("The sign-in came back from a different server than the site. Try again.")
            } else if let Some(err) = q.get("error") {
                Err(if err == "access_denied" {
                    "You chose not to connect the site."
                } else {
                    "The site didn't complete the sign-in."
                })
            } else if let Some(code) = q.get("code") {
                Ok(code.clone())
            } else {
                Err("The site didn't complete the sign-in.")
            };
            let said = match &result {
                Ok(_) => "WP Sites HQ is connected. You can close this tab.",
                Err(msg) => msg,
            };
            let _ = conn.write_all(&page(said)).await;
            return result.map_err(site_err);
        }
    }
}

const STRANGER: &str = "This sign-in didn't come from the request WP Sites HQ made. Try again.";

/// The page the browser shows after coming back.
fn page(said: &str) -> Vec<u8> {
    let html = format!(
        "<!doctype html><meta charset=utf-8><title>WP Sites HQ</title><p style=\"font:16px system-ui;margin:3em\">{said}</p>"
    );
    format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nReferrer-Policy: no-referrer\r\nConnection: close\r\n\r\n{html}",
        html.len()
    )
    .into_bytes()
}

/// A grant's tokens, sealed in the vault as JSON.
#[derive(Clone, Serialize, Deserialize, PartialEq, Eq)]
pub struct Tokens {
    pub access_token: String,
    pub refresh_token: String,
    /// Unix seconds.
    pub expires_at: i64,
}

impl std::fmt::Debug for Tokens {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Tokens")
            .field("expires_at", &self.expires_at)
            .finish_non_exhaustive()
    }
}

impl Tokens {
    /// Expired, or will be within a minute.
    pub fn expiring(&self) -> bool {
        self.expires_at - 60 <= now()
    }
}

pub fn now() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or_default()
}

/// When a token from this reply expires. The site's number is held to a year, so a huge
/// one can't overflow (which would make every call refresh).
pub(crate) fn expires_at(reply: &Value) -> i64 {
    now().saturating_add(
        reply["expires_in"]
            .as_i64()
            .unwrap_or(3600)
            .clamp(0, 365 * 86_400),
    )
}

fn tokens(reply: &Reply) -> Option<Tokens> {
    let v: Value = reply.json()?;
    if reply.status != 200 {
        return None;
    }
    Some(Tokens {
        access_token: v["access_token"].as_str()?.to_string(),
        refresh_token: v["refresh_token"].as_str()?.to_string(),
        expires_at: expires_at(&v),
    })
}

/// The server's `error_description`, or `fallback`.
fn oauth_message(reply: &Reply, fallback: &str) -> String {
    if let Some(plain) = net::explain_status(reply) {
        return plain.to_string();
    }
    reply
        .json::<Value>()
        .and_then(|v| v["error_description"].as_str().map(String::from))
        .unwrap_or_else(|| fallback.to_string())
}

pub struct Exchange<'a> {
    pub token_endpoint: &'a str,
    pub client_id: &'a str,
    pub code: &'a str,
    pub redirect_uri: &'a str,
    pub verifier: &'a str,
    pub resource: &'a str,
}

/// Codes are single use: sent once, never retried after leaving the machine.
pub async fn exchange(
    http: &reqwest::Client,
    limits: &Limits,
    site: &str,
    x: &Exchange<'_>,
) -> Result<Tokens, OAuthError> {
    let form = [
        ("grant_type", "authorization_code"),
        ("code", x.code),
        ("client_id", x.client_id),
        ("redirect_uri", x.redirect_uri),
        ("code_verifier", x.verifier),
        ("resource", x.resource),
    ];
    let reply = net::send(limits, site, Retry::Write, || {
        http.post(x.token_endpoint).form(&form)
    })
    .await?;
    tokens(&reply)
        .ok_or_else(|| site_err(oauth_message(&reply, "The site didn't finish the sign-in.")))
}

#[derive(Debug, thiserror::Error)]
pub enum RefreshError {
    /// Never reached the site: nothing changed there, the old token still works.
    #[error(transparent)]
    NotSent(net::NetError),
    /// The site said no (expired, revoked, reused).
    #[error("{0}")]
    Rejected(String),
    /// Sent, but the answer was lost or unreadable: the site may have rotated
    /// the token, so the old one must not be used again.
    #[error("{0}")]
    Lost(String),
    /// PHP printed a fatal error: WordPress never got to the token, so the old one still works.
    #[error("{0}")]
    Broken(String),
}

pub async fn refresh(
    http: &reqwest::Client,
    limits: &Limits,
    site: &str,
    token_endpoint: &str,
    client_id: &str,
    refresh_token: &str,
    resource: &str,
) -> Result<Tokens, RefreshError> {
    let form = [
        ("grant_type", "refresh_token"),
        ("refresh_token", refresh_token),
        ("client_id", client_id),
        ("resource", resource),
    ];
    // Never retried: a second try with the same token would revoke the grant.
    let reply = match net::send(limits, site, Retry::Write, || {
        http.post(token_endpoint).form(&form)
    })
    .await
    {
        Ok(r) => r,
        Err(e) if e.never_sent() => return Err(RefreshError::NotSent(e)),
        Err(e) => return Err(RefreshError::Lost(e.message.to_string())),
    };
    if let Some(t) = tokens(&reply) {
        return Ok(t);
    }
    if net::php_fatal(&reply.body) {
        return Err(RefreshError::Broken(
            "The site answers with a PHP fatal error, so the sign-in wasn't renewed. Fix the error on the site, then try again.".into(),
        ));
    }
    let msg = oauth_message(&reply, "The site refused to renew the sign-in.");
    if matches!(reply.status, 400 | 401) {
        Err(RefreshError::Rejected(msg))
    } else {
        Err(RefreshError::Lost(msg))
    }
}

/// RFC 7009. Revoking the refresh token revokes the whole grant on Classic Monks.
pub async fn revoke(
    http: &reqwest::Client,
    limits: &Limits,
    site: &str,
    endpoint: &str,
    client_id: &str,
    token: &str,
) -> Result<(), OAuthError> {
    let form = [
        ("token", token),
        ("token_type_hint", "refresh_token"),
        ("client_id", client_id),
    ];
    let reply = net::send(limits, site, Retry::ReadOnly, || {
        http.post(endpoint).form(&form)
    })
    .await?;
    if reply.status == 200 {
        Ok(())
    } else {
        Err(site_err(oauth_message(
            &reply,
            "The site didn't confirm the sign-out.",
        )))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testsite::{Refresh, TestSite};

    async fn connect(site: &TestSite) -> (Discovery, String, Tokens) {
        let (http, limits) = (crate::net::client().unwrap(), Limits::default());
        let url = Url::parse(&site.url).unwrap();
        let d = discover(&http, &limits, &url).await.unwrap().unwrap();
        assert_eq!(
            d.resource,
            format!("{}/wp-json/classic-monks/v1/mcp", site.url)
        );
        let client_id = register(&http, &limits, &site.url, &d, CLIENT_NAME)
            .await
            .unwrap();
        let pkce = pkce();
        let state = random_token(16);
        let lb = Loopback::bind().await.unwrap();
        let redirect = lb.redirect_uri.clone();
        let auth = authorize_url(&d, &client_id, &redirect, &state, &pkce.challenge).unwrap();
        // The "browser": follows the site's redirect back to the loopback.
        tokio::spawn(async move { reqwest::get(auth).await });
        let code = lb.wait(&state, &d.issuer).await.unwrap();
        let t = exchange(
            &http,
            &limits,
            &site.url,
            &Exchange {
                token_endpoint: &d.token_endpoint,
                client_id: &client_id,
                code: &code,
                redirect_uri: &redirect,
                verifier: &pkce.verifier,
                resource: &d.resource,
            },
        )
        .await
        .unwrap();
        (d, client_id, t)
    }

    #[tokio::test]
    async fn sign_in_refresh_and_revoke() {
        let site = TestSite::start().await;
        let (d, client_id, t) = connect(&site).await;
        assert!(!t.expiring());
        assert!(
            format!("{t:?}").find("cmat_").is_none(),
            "Debug hides tokens"
        );

        let (http, limits) = (crate::net::client().unwrap(), Limits::default());
        let t2 = refresh(
            &http,
            &limits,
            &site.url,
            &d.token_endpoint,
            &client_id,
            &t.refresh_token,
            &d.resource,
        )
        .await
        .unwrap();
        assert_ne!(t2.refresh_token, t.refresh_token, "rotated");
        assert_eq!(site.state().refreshes, 1);

        let endpoint = d.revocation_endpoint.as_deref().unwrap();
        revoke(
            &http,
            &limits,
            &site.url,
            endpoint,
            &client_id,
            &t2.refresh_token,
        )
        .await
        .unwrap();
        assert_eq!(site.state().revoked, 1);

        // A spent token is refused (the plugin revokes the grant on reuse).
        let err = refresh(
            &http,
            &limits,
            &site.url,
            &d.token_endpoint,
            &client_id,
            &t.refresh_token,
            &d.resource,
        )
        .await
        .unwrap_err();
        assert!(matches!(err, RefreshError::Rejected(_)), "{err}");
    }

    #[tokio::test]
    async fn lost_and_unsent_refreshes_are_told_apart() {
        let site = TestSite::start().await;
        let (d, client_id, t) = connect(&site).await;
        let (http, limits) = (crate::net::client().unwrap(), Limits::default());

        site.state().refresh = Refresh::ServerError;
        let err = refresh(
            &http,
            &limits,
            &site.url,
            &d.token_endpoint,
            &client_id,
            &t.refresh_token,
            &d.resource,
        )
        .await
        .unwrap_err();
        assert!(matches!(err, RefreshError::Lost(_)), "{err}");

        site.state().refresh = Refresh::Hang;
        let short = reqwest::Client::builder()
            .timeout(std::time::Duration::from_millis(300))
            .build()
            .unwrap();
        let err = refresh(
            &short,
            &limits,
            &site.url,
            &d.token_endpoint,
            &client_id,
            &t.refresh_token,
            &d.resource,
        )
        .await
        .unwrap_err();
        assert!(
            matches!(err, RefreshError::Lost(_)),
            "a timeout may have rotated: {err}"
        );

        // Bound but never listening, so the port stays closed and no other test takes it.
        let socket = tokio::net::TcpSocket::new_v4().unwrap();
        socket.bind("127.0.0.1:0".parse().unwrap()).unwrap();
        let closed = socket.local_addr().unwrap();
        let err = refresh(
            &http,
            &limits,
            &site.url,
            &format!("http://{closed}/token"),
            &client_id,
            &t.refresh_token,
            &d.resource,
        )
        .await
        .unwrap_err();
        assert!(matches!(err, RefreshError::NotSent(_)), "{err}");
    }

    #[tokio::test]
    async fn loopback_checks_state_issuer_and_denial() {
        // A return that isn't ours, and a connection that sends nothing, are passed over.
        let lb = Loopback::bind().await.unwrap();
        let base = lb.redirect_uri.clone();
        let browser = tokio::spawn(async move {
            let port = base.split(':').nth(2).unwrap().split('/').next().unwrap();
            let _idle = tokio::net::TcpStream::connect(format!("127.0.0.1:{port}"))
                .await
                .unwrap();
            let stranger = reqwest::get(format!("{base}?code=x&state=other"))
                .await
                .unwrap()
                .text()
                .await
                .unwrap();
            assert!(stranger.contains("didn't come from the request"));
            reqwest::get(format!("{base}?code=c&state=s"))
                .await
                .unwrap()
                .text()
                .await
                .unwrap()
        });
        assert_eq!(lb.wait("s", "https://site.local").await.unwrap(), "c");
        assert!(browser.await.unwrap().contains("connected"));

        for (query, expect) in [
            (
                "code=c&state=s&iss=https%3A%2F%2Fevil.example",
                "different server",
            ),
            ("error=access_denied&state=s", "chose not to connect"),
        ] {
            let lb = Loopback::bind().await.unwrap();
            let url = format!("{}?{query}", lb.redirect_uri);
            let browser = tokio::spawn(async move {
                reqwest::get(format!(
                    "{}favicon.ico",
                    &url[..url.find("callback").unwrap()]
                ))
                .await
                .unwrap();
                reqwest::get(url).await.unwrap().text().await.unwrap()
            });
            let err = lb.wait("s", "https://site.local").await.unwrap_err();
            assert!(err.to_string().contains(expect), "{query}: {err}");
            assert!(browser.await.unwrap().contains(expect));
        }
    }

    #[test]
    fn token_lifetimes_are_held_to_a_year() {
        let at = |v| expires_at(&serde_json::json!({ "expires_in": v })) - now();
        assert!((3599..=3600).contains(&at(serde_json::json!(3600))));
        assert!(at(serde_json::json!(i64::MAX)) <= 365 * 86_400);
        assert!(at(serde_json::json!(-5)) <= 0);
        assert!((3599..=3600).contains(&(expires_at(&serde_json::json!({})) - now())));
    }

    #[tokio::test]
    async fn no_classic_monks_is_none() {
        let site = TestSite::start().await;
        site.state().mcp_off = true;
        let url = Url::parse(&site.url).unwrap();
        let d = discover(&crate::net::client().unwrap(), &Limits::default(), &url)
            .await
            .unwrap();
        assert!(d.is_none());
    }

    #[tokio::test]
    async fn a_php_fatal_error_page_is_not_a_missing_plugin() {
        let site = TestSite::start().await;
        site.state().php_fatal = true;
        let url = Url::parse(&site.url).unwrap();
        let err = discover(&crate::net::client().unwrap(), &Limits::default(), &url)
            .await
            .unwrap_err();
        assert!(err.to_string().contains("PHP fatal error"), "{err}");
    }

    #[tokio::test]
    async fn sign_in_addresses_stay_on_the_site() {
        let site = TestSite::start().await;
        let url = Url::parse(&site.url).unwrap();
        let http = crate::net::client().unwrap();
        for addr in [
            "http://192.168.1.1/token",
            "smb://127.0.0.1/x",
            "file:///etc/passwd",
        ] {
            site.state().token_endpoint = Some(addr.into());
            let err = discover(&http, &Limits::default(), &url).await.unwrap_err();
            assert!(err.to_string().contains("another address"), "{addr}: {err}");
        }
        let host = url.host_str().unwrap();
        site.state().token_endpoint = Some(format!("https://{host}/token"));
        assert!(discover(&http, &Limits::default(), &url).await.is_ok());
    }

    #[test]
    fn resource_metadata_is_read_from_the_challenge() {
        let p = resource_metadata_param;
        let doc =
            "https://s.test/.well-known/oauth-protected-resource/wp-json/classic-monks/v1/mcp";
        assert_eq!(
            p(&format!("Bearer resource_metadata=\"{doc}\"")).unwrap(),
            doc
        );
        assert_eq!(
            p(&format!(
                "Bearer realm=\"WordPress\" ,  Resource_Metadata = \"{doc}\", scope=\"x\""
            ))
            .unwrap(),
            doc
        );
        assert_eq!(
            p(&format!(
                "Bearer error=\"invalid_token\",resource_metadata={doc}, x=y"
            ))
            .unwrap(),
            doc
        );
        assert_eq!(p("Bearer realm=\"WordPress\""), None);
        assert_eq!(p("Bearer xresource_metadata=\"https://evil.test\""), None);
        assert_eq!(p("Bearer resource_metadata=\"\""), None);

        let mut h = reqwest::header::HeaderMap::new();
        h.append(
            reqwest::header::WWW_AUTHENTICATE,
            "Basic realm=\"x\"".parse().unwrap(),
        );
        h.append(
            reqwest::header::WWW_AUTHENTICATE,
            format!("Bearer resource_metadata=\"{doc}\"")
                .parse()
                .unwrap(),
        );
        assert_eq!(resource_metadata(&h).unwrap(), doc);
    }

    #[test]
    fn only_classic_monks_resources_are_accepted() {
        assert!(is_cm_resource(
            "https://s.test/wp-json/classic-monks/v1/mcp"
        ));
        assert!(is_cm_resource(
            "https://s.test/blog/wp-json/classic-monks/v1/mcp/"
        ));
        assert!(is_cm_resource(
            "https://s.test/?rest_route=/classic-monks/v1/mcp"
        ));
        assert!(is_cm_resource(
            "https://s.test/?rest_route=%2Fclassic-monks%2Fv1%2Fmcp"
        ));
        assert!(!is_cm_resource("https://s.test/wp-json/novamira/v1/mcp"));
        assert!(!is_cm_resource(
            "https://s.test/?rest_route=/novamira/v1/mcp"
        ));
        assert!(!is_cm_resource("https://s.test/"));
        assert!(!is_cm_resource("not a url"));
    }

    #[test]
    fn issuer_paths_use_the_insert_form_first() {
        assert_eq!(
            server_metadata_urls("https://s.test/blog/classic-monks/v1"),
            [
                "https://s.test/.well-known/oauth-authorization-server/blog/classic-monks/v1",
                "https://s.test/.well-known/openid-configuration/blog/classic-monks/v1",
                "https://s.test/blog/classic-monks/v1/.well-known/oauth-authorization-server",
            ]
        );
        assert_eq!(
            server_metadata_urls("https://s.test"),
            ["https://s.test/.well-known/oauth-authorization-server"]
        );
    }

    #[tokio::test]
    async fn another_plugin_on_the_generic_addresses_is_stepped_around() {
        let site = TestSite::start().await;
        {
            let mut s = site.state();
            s.novamira = true;
            s.new_connector = true;
        }
        let (d, _, _) = connect(&site).await;
        assert_eq!(d.issuer, format!("{}/classic-monks/v1", site.url));
        assert!(d.authorization_endpoint.contains("/classic-monks/"));
    }

    #[tokio::test]
    async fn an_old_connector_behind_another_plugin_is_explained() {
        let site = TestSite::start().await;
        site.state().novamira = true;
        let url = Url::parse(&site.url).unwrap();
        let err = discover(&crate::net::client().unwrap(), &Limits::default(), &url)
            .await
            .unwrap_err();
        let msg = err.to_string();
        assert!(
            msg.contains("Another plugin") && msg.contains("/wp-json/novamira/v1/mcp"),
            "{msg}"
        );
        assert!(!msg.contains('\u{2014}'), "no em dashes");
    }

    #[test]
    fn pkce_is_s256_of_the_verifier() {
        let p = pkce();
        assert_eq!(p.verifier.len(), 64);
        assert_eq!(
            p.challenge,
            URL_SAFE_NO_PAD.encode(Sha256::digest(p.verifier.as_bytes()))
        );
        assert_ne!(pkce().verifier, p.verifier);
    }
}
