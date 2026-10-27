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
pub const CLIENT_NAME: &str = "Monks Central";

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

/// `None` when the site has no Classic Monks MCP endpoint (or it is switched off).
pub async fn discover(
    http: &reqwest::Client,
    limits: &Limits,
    site: &Url,
) -> Result<Option<Discovery>, OAuthError> {
    let key = site.as_str();
    let url = format!(
        "{}/.well-known/oauth-protected-resource",
        crate::sites::url_string(site)
    );
    let reply = net::send(limits, key, Retry::ReadOnly, || http.get(&url)).await?;
    let Some(pr) = reply
        .json::<ProtectedResource>()
        .filter(|_| reply.status == 200)
    else {
        return Ok(None);
    };
    let issuer = pr
        .authorization_servers
        .first()
        .ok_or_else(|| site_err("The site's sign-in details name no sign-in server."))?
        .trim_end_matches('/')
        .to_string();
    let meta_url = format!("{issuer}/.well-known/oauth-authorization-server");
    let reply = net::send(limits, key, Retry::ReadOnly, || http.get(&meta_url)).await?;
    let meta: ServerMetadata = reply
        .json()
        .filter(|_| reply.status == 200)
        .ok_or_else(|| site_err("The site's sign-in server didn't describe itself."))?;
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

/// RFC 7591. Classic Monks registration is stateless, so a retry is harmless.
pub async fn register(
    http: &reqwest::Client,
    limits: &Limits,
    site: &str,
    d: &Discovery,
) -> Result<String, OAuthError> {
    let endpoint = d
        .registration_endpoint
        .as_deref()
        .ok_or_else(|| site_err("The site doesn't let new apps register. Update Classic Monks."))?;
    let body = serde_json::json!({
        "client_name": CLIENT_NAME,
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
                "The site refused to register Monks Central.",
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
            while len < buf.len() && !buf[..len].windows(4).any(|w| w == b"\r\n\r\n") {
                match conn.read(&mut buf[len..]).await {
                    Ok(0) | Err(_) => break,
                    Ok(n) => len += n,
                }
            }
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
            let result = if q.get("state").map(String::as_str) != Some(state) {
                Err("This sign-in didn't come from the request Monks Central made. Try again.")
            } else if q
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
            let page = match &result {
                Ok(_) => "Monks Central is connected. You can close this tab.",
                Err(msg) => msg,
            };
            let html = format!(
                "<!doctype html><meta charset=utf-8><title>Monks Central</title><p style=\"font:16px system-ui;margin:3em\">{page}</p>"
            );
            let resp = format!(
                "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nReferrer-Policy: no-referrer\r\nConnection: close\r\n\r\n{html}",
                html.len()
            );
            let _ = conn.write_all(resp.as_bytes()).await;
            return result.map_err(site_err);
        }
    }
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

fn tokens(reply: &Reply) -> Option<Tokens> {
    let v: Value = reply.json()?;
    if reply.status != 200 {
        return None;
    }
    Some(Tokens {
        access_token: v["access_token"].as_str()?.to_string(),
        refresh_token: v["refresh_token"].as_str()?.to_string(),
        expires_at: now() + v["expires_in"].as_i64().unwrap_or(3600),
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
        let client_id = register(&http, &limits, &site.url, &d).await.unwrap();
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

        let closed = TcpListener::bind("127.0.0.1:0")
            .await
            .unwrap()
            .local_addr()
            .unwrap();
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
        for (query, expect) in [
            ("code=c&state=other", "didn't come from the request"),
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
