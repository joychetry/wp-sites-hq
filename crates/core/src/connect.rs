//! Adding, refreshing, checking and removing sites (plan 5.4, 5.5).

use std::sync::atomic::Ordering;
use std::sync::{Arc, Weak};
use std::time::{Duration, Instant};

use reqwest::Url;
use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tokio::sync::oneshot;

use crate::net::{self, Reply, Retry};
use crate::oauth::{self, RefreshError, Tokens};
use crate::sites::{self, Details, Health, Mode, NewSite, OAuthClient, Site};
use crate::vault::{Vault, VaultError};
use crate::{Changed, Core, vault};

/// How long the app waits for the human in the browser.
const SIGN_IN_WAIT: Duration = Duration::from_secs(600);
/// Health checks while the core runs.
const CHECK_EVERY: Duration = Duration::from_secs(15 * 60);
/// Slower than this gets a note. Slow is not unhealthy (Phase 1 review).
const SLOW: Duration = Duration::from_secs(3);
const TOO_OLD: &str = "Update WordPress to 7.1 or newer first.";

#[derive(Debug, thiserror::Error)]
pub enum SiteError {
    #[error("{0}")]
    Plain(String),
    #[error("Monks Central can't read this site's saved sign-in. Sign in again.")]
    SignInAgain,
    #[error("This site runs WordPress {0}. {TOO_OLD}")]
    TooOld(String),
    /// The site's own approval gate stopped the change until a person approves it there.
    #[error("{message}")]
    NeedsApproval {
        message: String,
        approve_url: String,
    },
    /// A safe update broke the site, so the version before it was put back.
    #[error("{0}")]
    RolledBack(String),
}

pub(crate) fn plain(msg: impl Into<String>) -> SiteError {
    SiteError::Plain(msg.into())
}

/// A site's own error message as words: WordPress puts HTML in some
/// ("<strong>Error:</strong> … <a href=…>Get support</a>").
pub(crate) fn site_said(msg: &str) -> String {
    let mut text = String::new();
    let mut in_tag = false;
    for c in msg.chars() {
        match c {
            '<' => in_tag = true,
            '>' if in_tag => in_tag = false,
            _ if !in_tag => text.push(c),
            _ => {}
        }
    }
    crate::fleet::decode_entities(&text.split_whitespace().collect::<Vec<_>>().join(" "))
}

impl From<rusqlite::Error> for SiteError {
    fn from(e: rusqlite::Error) -> Self {
        plain(format!("Monks Central's database had a problem: {e}"))
    }
}

impl From<net::NetError> for SiteError {
    fn from(e: net::NetError) -> Self {
        plain(e.message)
    }
}

impl From<oauth::OAuthError> for SiteError {
    fn from(e: oauth::OAuthError) -> Self {
        plain(e.to_string())
    }
}

/// A Basic mode secret, sealed in the vault as JSON.
#[derive(Serialize, Deserialize)]
pub(crate) struct AppPassword {
    pub(crate) username: String,
    pub(crate) password: String,
}

/// What removing a site did on the site itself.
#[derive(Debug, Serialize)]
pub struct Removed {
    pub signed_out: bool,
    pub message: String,
}

fn secret_name(id: i64) -> String {
    Grant::Operator.secret(id)
}

/// Which of a site's two Classic Monks grants: the app's own (operator), or the
/// one AI agents use, where the site's approvals still apply (plan 5.6).
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) enum Grant {
    Operator,
    Agent,
}

impl Grant {
    pub(crate) fn secret(self, id: i64) -> String {
        match self {
            Grant::Operator => format!("site:{id}"),
            Grant::Agent => format!("site:{id}:agent"),
        }
    }

    fn client(self, site: &Site) -> Option<&OAuthClient> {
        match self {
            Grant::Operator => site.oauth.as_ref(),
            Grant::Agent => site.agent_oauth.as_ref(),
        }
    }
}

/// An agent grant the site no longer honours.
pub const AGENT_ACCESS_ENDED: &str = "AI agents' access to this site has ended on the site. Turn it on again in the Monks Central app, under AI.";

/// "7.1.3" and "7.1-beta2" pass; "7.0.7" doesn't. Unreadable versions pass:
/// they can't be shown to be too old.
pub fn at_least_7_1(version: &str) -> bool {
    let mut parts = version
        .split(|c: char| !c.is_ascii_digit())
        .map(|p| p.parse::<u32>().ok());
    match (parts.next().flatten(), parts.next().flatten()) {
        (Some(major), Some(minor)) => (major, minor) >= (7, 1),
        (Some(major), None) => major > 7,
        _ => true,
    }
}

impl Core {
    pub(crate) fn db<T>(
        &self,
        f: impl FnOnce(&Connection) -> rusqlite::Result<T>,
    ) -> Result<T, SiteError> {
        Ok(f(self.store.lock().unwrap().conn())?)
    }

    pub(crate) fn notify(&self) {
        let _ = self.changed.send(Changed::Sites);
    }

    fn vault(&self) -> Result<Arc<Vault>, SiteError> {
        let mut slot = self.vault.lock().unwrap();
        if let Some(v) = slot.as_ref() {
            return Ok(v.clone());
        }
        let keychain = self
            .keychain
            .as_ref()
            .map_err(|e| plain(format!("Couldn't use the system keychain: {e}")))?;
        let key = vault::load_or_create_master_key(&**keychain, &self.home)
            .map_err(|e| plain(e.to_string()))?;
        let v = Arc::new(Vault::new(&key));
        *slot = Some(v.clone());
        Ok(v)
    }

    fn save_secret(&self, id: i64, secret: &impl Serialize) -> Result<(), SiteError> {
        self.save_named(&secret_name(id), secret)
    }

    pub(crate) fn save_named(&self, name: &str, secret: &impl Serialize) -> Result<(), SiteError> {
        let bytes = zeroize::Zeroizing::new(serde_json::to_vec(secret).expect("plain struct"));
        let vault = self.vault()?;
        self.db(|c| Ok(vault.put(c, name, &bytes)))?
            .map_err(|e| plain(e.to_string()))
    }

    /// A secret, or `None` when it is missing or won't open.
    pub(crate) fn open_named<T: serde::de::DeserializeOwned>(
        &self,
        name: &str,
    ) -> Result<Option<T>, SiteError> {
        let vault = self.vault()?;
        let got = self.db(|c| Ok(vault.get(c, name)))?;
        match got {
            Ok(Some(bytes)) => Ok(serde_json::from_slice(&bytes).ok()),
            Ok(None) | Err(VaultError::SignInAgain) => Ok(None),
            Err(e) => Err(plain(e.to_string())),
        }
    }

    /// Delete a secret, even when the keychain is gone.
    pub(crate) fn delete_named(&self, c: &Connection, name: &str) -> rusqlite::Result<()> {
        c.execute("DELETE FROM credentials WHERE name = ?1", [name])?;
        Ok(())
    }

    /// The site's secret, or "Sign in again" (and the site marked so) when it
    /// is missing or won't open.
    pub(crate) fn load_secret<T: serde::de::DeserializeOwned>(
        &self,
        id: i64,
    ) -> Result<T, SiteError> {
        match self.open_named(&secret_name(id))? {
            Some(t) => Ok(t),
            None => {
                self.mark_sign_in_again(id)?;
                Err(SiteError::SignInAgain)
            }
        }
    }

    fn mark_sign_in_again(&self, id: i64) -> Result<(), SiteError> {
        self.db(|c| sites::set_sign_in_again(c, id, true))?;
        self.notify();
        Ok(())
    }

    pub fn sites(&self) -> Result<Vec<Site>, SiteError> {
        self.db(sites::list)
    }

    pub fn site(&self, id: i64) -> Result<Site, SiteError> {
        self.db(|c| sites::get(c, id))?
            .ok_or_else(|| plain("That site isn't in Monks Central any more."))
    }

    pub fn groups(&self) -> Result<Vec<String>, SiteError> {
        self.db(sites::groups)
    }

    pub fn set_group(&self, id: i64, group: Option<&str>) -> Result<Site, SiteError> {
        self.db(|c| sites::set_group(c, id, group))?;
        self.notify();
        self.site(id)
    }

    pub fn set_tags(&self, id: i64, tags: &[String]) -> Result<Site, SiteError> {
        self.db(|c| sites::set_tags(c, id, tags))?;
        self.notify();
        self.site(id)
    }

    pub fn add_note(&self, id: i64, body: &str) -> Result<Site, SiteError> {
        if body.trim().is_empty() {
            return Err(plain("Write something in the note first."));
        }
        self.db(|c| sites::add_note(c, id, body))?;
        self.notify();
        self.site(id)
    }

    pub fn delete_note(&self, id: i64, note_id: i64) -> Result<Site, SiteError> {
        self.db(|c| sites::delete_note(c, note_id))?;
        self.notify();
        self.site(id)
    }

    /// Stop waiting for a sign-in that is open in the browser.
    pub fn cancel_sign_in(&self) {
        if let Some(tx) = self.sign_in.lock().unwrap().take() {
            let _ = tx.send(());
        }
    }

    /// The generator version in the public feed, if the site shows it. Lets a
    /// too-old site be refused before anyone signs in.
    async fn feed_version(&self, url: &Url) -> Option<String> {
        let feed = format!("{}/?feed=rss2", sites::url_string(url));
        let reply = net::send(&self.limits, url.as_str(), Retry::ReadOnly, || {
            self.http.get(&feed)
        })
        .await
        .ok()?;
        let body = String::from_utf8_lossy(&reply.body);
        let start = body.find("wordpress.org/?v=")? + "wordpress.org/?v=".len();
        let v: String = body[start..]
            .chars()
            .take_while(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-'))
            .collect();
        (!v.is_empty()).then_some(v)
    }

    async fn start_add(&self, input: &str, existing: Option<i64>) -> Result<Url, SiteError> {
        let url = sites::normalize_url(input).map_err(plain)?;
        if existing.is_none()
            && self
                .db(|c| sites::find_by_url(c, &sites::url_string(&url)))?
                .is_some()
        {
            return Err(plain("This site is already in Monks Central."));
        }
        if let Some(v) = self.feed_version(&url).await
            && !at_least_7_1(&v)
        {
            return Err(SiteError::TooOld(v));
        }
        Ok(url)
    }

    /// Add a site by Classic Monks OAuth. `open` shows the sign-in page in the
    /// browser; the human signs in there and ticks "operator".
    pub async fn add_site_oauth(
        &self,
        input: &str,
        open: impl FnOnce(&str) -> std::io::Result<()>,
    ) -> Result<Site, SiteError> {
        self.connect_oauth(input, None, open).await
    }

    /// Sign a site in again, keeping its group, tags and notes.
    pub async fn sign_in_again_oauth(
        &self,
        id: i64,
        open: impl FnOnce(&str) -> std::io::Result<()>,
    ) -> Result<Site, SiteError> {
        let site = self.site(id)?;
        self.connect_oauth(&site.url, Some(id), open).await
    }

    async fn connect_oauth(
        &self,
        input: &str,
        existing: Option<i64>,
        open: impl FnOnce(&str) -> std::io::Result<()>,
    ) -> Result<Site, SiteError> {
        let _work = self.working().await;
        let url = self.start_add(input, existing).await?;
        let key = url.as_str();
        let (d, client, tokens) = self.oauth_sign_in(&url, oauth::CLIENT_NAME, open).await?;

        let mut details = match self
            .describe_cm(key, &d.resource, &tokens.access_token, &url)
            .await
        {
            Ok(d) => d,
            Err(e) => {
                self.revoke_fresh(key, &client, &tokens).await;
                return Err(e);
            }
        };
        if let Some(v) = details.wp_version.as_deref().filter(|v| !at_least_7_1(v)) {
            let v = v.to_string();
            self.revoke_fresh(key, &client, &tokens).await;
            return Err(SiteError::TooOld(v));
        }
        if details.name.is_empty() {
            details.name = d.resource_name.clone().unwrap_or_default();
        }
        let new = NewSite {
            url: &sites::url_string(&url),
            mode: Mode::ClassicMonks,
            api_url: &d.resource,
            oauth: Some(&client),
            username: None,
        };
        // The grant this sign-in replaces. Its secret may be the reason for signing
        // in again (unreadable): then the site can't be told, and the grant ends by
        // itself within 30 days.
        let old = existing.and_then(|id| {
            let client = self.site(id).ok()?.oauth?;
            Some((client, self.load_secret::<Tokens>(id).ok()?))
        });
        match self.save_site(existing, &new, details, &tokens) {
            Ok(id) => {
                if let Some((client, tokens)) = old {
                    self.revoke_fresh(key, &client, &tokens).await;
                }
                self.after_connect(id).await
            }
            Err(e) => {
                self.revoke_fresh(key, &client, &tokens).await;
                Err(e)
            }
        }
    }

    /// Register `client_name`, send the human to the site's consent page, and
    /// take the grant they give.
    pub(crate) async fn oauth_sign_in(
        &self,
        url: &Url,
        client_name: &str,
        open: impl FnOnce(&str) -> std::io::Result<()>,
    ) -> Result<(oauth::Discovery, OAuthClient, Tokens), SiteError> {
        let key = url.as_str();
        let d = oauth::discover(&self.http, &self.limits, url).await?.ok_or_else(|| {
            plain("This site has no Classic Monks connection. Switch on AI > MCP in Classic Monks, or add the site in Basic mode with an application password.")
        })?;
        let client_id = oauth::register(&self.http, &self.limits, key, &d, client_name).await?;
        let pkce = oauth::pkce();
        let state = oauth::random_token(24);
        let loopback = oauth::Loopback::bind()
            .await
            .map_err(|e| plain(format!("Couldn't open a local return address: {e}")))?;
        let redirect_uri = loopback.redirect_uri.clone();
        let auth_url =
            oauth::authorize_url(&d, &client_id, &redirect_uri, &state, &pkce.challenge)?;

        let (tx, rx) = oneshot::channel();
        {
            let mut slot = self.sign_in.lock().unwrap();
            if slot.as_ref().is_some_and(|t| !t.is_closed()) {
                return Err(plain(
                    "Another sign-in is open in your browser. Finish or cancel it first.",
                ));
            }
            *slot = Some(tx);
        }
        open(&auth_url).map_err(|e| plain(format!("Couldn't open your browser: {e}")))?;
        let code = tokio::select! {
            r = loopback.wait(&state, &d.issuer) => r?,
            _ = rx => return Err(plain("Sign-in cancelled.")),
            () = tokio::time::sleep(SIGN_IN_WAIT) => return Err(plain("The sign-in took too long. Try again.")),
        };
        let tokens = oauth::exchange(
            &self.http,
            &self.limits,
            key,
            &oauth::Exchange {
                token_endpoint: &d.token_endpoint,
                client_id: &client_id,
                code: &code,
                redirect_uri: &redirect_uri,
                verifier: &pkce.verifier,
                resource: &d.resource,
            },
        )
        .await?;
        let client = OAuthClient {
            issuer: d.issuer.clone(),
            token_endpoint: d.token_endpoint.clone(),
            revocation_endpoint: d.revocation_endpoint.clone(),
            client_id,
        };
        Ok((d, client, tokens))
    }

    /// Give back a grant: one just made for a site that won't be added, or the
    /// one a new sign-in replaced.
    pub(crate) async fn revoke_fresh(&self, key: &str, client: &OAuthClient, tokens: &Tokens) {
        if let Some(endpoint) = &client.revocation_endpoint {
            let _ = oauth::revoke(
                &self.http,
                &self.limits,
                key,
                endpoint,
                &client.client_id,
                &tokens.refresh_token,
            )
            .await;
        }
    }

    /// Insert or update the site row, then seal its secret (read back before
    /// success). A new row is taken out again if the secret can't be saved.
    fn save_site(
        &self,
        existing: Option<i64>,
        new: &NewSite,
        mut details: Details,
        secret: &impl Serialize,
    ) -> Result<i64, SiteError> {
        if details.name.is_empty() {
            details.name = Url::parse(new.url)
                .ok()
                .and_then(|u| u.host_str().map(String::from))
                .unwrap_or_else(|| new.url.to_string());
        }
        let id = match existing {
            Some(id) => {
                self.db(|c| {
                    sites::set_connection(c, id, new)?;
                    sites::set_details(c, id, &details)
                })?;
                id
            }
            None => self.db(|c| sites::insert(c, new, &details))?,
        };
        if let Err(e) = self.save_secret(id, secret) {
            if existing.is_none() {
                self.db(|c| sites::delete(c, id))?;
            }
            return Err(e);
        }
        Ok(id)
    }

    async fn after_connect(&self, id: i64) -> Result<Site, SiteError> {
        self.check_site_inner(id).await;
        self.site(id)
    }

    /// Versions and capabilities from the ability list and `get-hq-status`,
    /// never from a version header (plan 5.4).
    pub(crate) async fn describe_cm(
        &self,
        key: &str,
        mcp_url: &str,
        access_token: &str,
        url: &Url,
    ) -> Result<Details, SiteError> {
        let list = self
            .post_mcp(
                key,
                mcp_url,
                access_token,
                "tools/list",
                json!({}),
                Retry::ReadOnly,
            )
            .await?;
        let list = rpc_result(list)?;
        let (names, read_only) = tool_names(&list);
        let has_hq = names.contains(&"get-hq-status");
        let mut details = Details::default();
        let mut caps = json!({
            "abilities": names,
            "read_only": read_only,
            "hq_status": has_hq,
            "degraded": !has_hq,
        });
        if has_hq {
            let reply = self
                .post_mcp(
                    key,
                    mcp_url,
                    access_token,
                    "tools/call",
                    json!({ "name": "get-hq-status", "arguments": {} }),
                    Retry::ReadOnly,
                )
                .await?;
            let hq = tool_output(rpc_result(reply)?)?;
            details.wp_version = hq["wordpress"]["version"].as_str().map(String::from);
            details.php_version = hq["php"]["version"].as_str().map(String::from);
            details.cm_version = hq["plugin"]["version"].as_str().map(String::from);
            caps["operator"] = hq["connection"]["operator"].clone();
            caps["scope"] = hq["connection"]["scope"].clone();
            caps["approvals"] = hq["mcp"]["approvals"].clone();
            caps["modules"] = hq["modules"].clone();
            caps["environment"] = hq["wordpress"]["environment"].clone();
            caps["pending_approvals"] = hq["pending_approvals"].clone();
        } else if names.contains(&"get-site-info") {
            let reply = self
                .post_mcp(
                    key,
                    mcp_url,
                    access_token,
                    "tools/call",
                    json!({ "name": "get-site-info", "arguments": {} }),
                    Retry::ReadOnly,
                )
                .await?;
            if let Ok(info) = rpc_result(reply).and_then(tool_output) {
                details.wp_version = info["wordpress"]["version"].as_str().map(String::from);
                details.php_version = info["server"]["php_version"].as_str().map(String::from);
                details.name = info["wordpress"]["site_name"]
                    .as_str()
                    .unwrap_or_default()
                    .to_string();
            }
        }
        if details.wp_version.is_none() {
            details.wp_version = self.feed_version(url).await;
        }
        details.capabilities = caps;
        Ok(details)
    }

    /// One JSON-RPC message to a Classic Monks MCP endpoint. The token goes in
    /// Authorization and in X-CM-Authorization, for hosts that strip the first.
    async fn post_mcp(
        &self,
        key: &str,
        mcp_url: &str,
        token: &str,
        method: &str,
        params: Value,
        retry: Retry,
    ) -> Result<Reply, SiteError> {
        let body = json!({ "jsonrpc": "2.0", "id": 1, "method": method, "params": params });
        let bearer = format!("Bearer {token}");
        Ok(net::send(&self.limits, key, retry, || {
            self.http
                .post(mcp_url)
                .header(reqwest::header::AUTHORIZATION, &bearer)
                .header("X-CM-Authorization", &bearer)
                .header(
                    reqwest::header::ACCEPT,
                    "application/json, text/event-stream",
                )
                .json(&body)
        })
        .await?)
    }

    pub(crate) fn refresh_lock(&self, id: i64, grant: Grant) -> Arc<tokio::sync::Mutex<()>> {
        self.refresh_locks
            .lock()
            .unwrap()
            .entry((id, grant))
            .or_default()
            .clone()
    }

    /// The grant's saved tokens. A missing agent grant means agents have no access.
    pub(crate) fn tokens(&self, id: i64, grant: Grant) -> Result<Tokens, SiteError> {
        match grant {
            Grant::Operator => self.load_secret(id),
            Grant::Agent => self
                .open_named(&grant.secret(id))?
                .ok_or_else(|| plain(crate::fleet::NO_AGENT_ACCESS)),
        }
    }

    /// The site stopped honouring a grant: the app's means "Sign in again";
    /// the agents' is forgotten, so agents can only read until it is turned on again.
    fn grant_lost(&self, id: i64, grant: Grant) -> SiteError {
        match grant {
            Grant::Operator => match self.mark_sign_in_again(id) {
                Ok(()) => SiteError::SignInAgain,
                Err(e) => e,
            },
            Grant::Agent => {
                let _ = self.db(|c| {
                    self.delete_named(c, &grant.secret(id))?;
                    sites::set_agent(c, id, None)
                });
                self.notify();
                plain(AGENT_ACCESS_ENDED)
            }
        }
    }

    /// A working access token: the saved one, or one refresh away.
    async fn access_token(&self, site: &Site, grant: Grant) -> Result<Tokens, SiteError> {
        let tokens = self.tokens(site.id, grant)?;
        if tokens.expiring() {
            return self.refresh_after(site, grant, &tokens.access_token).await;
        }
        Ok(tokens)
    }

    /// Single-flight refresh. Every caller that saw `seen` fail or expire waits
    /// here; the first refreshes, the rest use its result. A refresh that may
    /// have rotated the token on the site but whose answer was lost puts the
    /// site in "Sign in again" with no retry: the plugin revokes the whole
    /// grant when a spent refresh token comes back.
    async fn refresh_after(
        &self,
        site: &Site,
        grant: Grant,
        seen: &str,
    ) -> Result<Tokens, SiteError> {
        let lock = self.refresh_lock(site.id, grant);
        let _one = lock.lock().await;
        let current = self.tokens(site.id, grant)?;
        if current.access_token != seen && !current.expiring() {
            return Ok(current);
        }
        let site = self.site(site.id)?;
        if grant == Grant::Operator && site.sign_in_again {
            return Err(SiteError::SignInAgain);
        }
        let client = grant
            .client(&site)
            .ok_or_else(|| plain("This site has no sign-in to renew."))?;
        self.refreshes.fetch_add(1, Ordering::SeqCst);
        let renewed = oauth::refresh(
            &self.http,
            &self.limits,
            &site.url,
            &client.token_endpoint,
            &client.client_id,
            &current.refresh_token,
            &site.api_url,
        )
        .await;
        match renewed {
            Ok(tokens) => {
                // The old refresh token is spent: if the new one can't be kept, only a new sign-in helps.
                if let Err(e) = self.save_named(&grant.secret(site.id), &tokens) {
                    self.grant_lost(site.id, grant);
                    return Err(e);
                }
                Ok(tokens)
            }
            Err(RefreshError::NotSent(e)) => Err(e.into()),
            Err(RefreshError::Rejected(_) | RefreshError::Lost(_)) => {
                Err(self.grant_lost(site.id, grant))
            }
        }
    }

    /// Renew every grant (at start, plan 5.4). Sites that need a sign-in are skipped.
    pub async fn refresh_all(&self) {
        let Ok(all) = self.sites() else { return };
        for site in all
            .into_iter()
            .filter(|s| s.mode == Mode::ClassicMonks && !s.sign_in_again)
        {
            let _work = self.working().await;
            if let Ok(t) = self.load_secret::<Tokens>(site.id) {
                let _ = self
                    .refresh_after(&site, Grant::Operator, &t.access_token)
                    .await;
            }
            if site.agent_access
                && let Ok(t) = self.tokens(site.id, Grant::Agent)
            {
                let _ = self
                    .refresh_after(&site, Grant::Agent, &t.access_token)
                    .await;
            }
        }
    }

    /// Call a Classic Monks ability as the operator grant. Read-only abilities
    /// (by the site's own `readOnlyHint`) are retried; others are not.
    pub async fn call_ability(&self, id: i64, tool: &str, args: Value) -> Result<Value, SiteError> {
        let _work = self.working().await;
        self.call_ability_inner(id, tool, args).await
    }

    pub(crate) async fn call_ability_inner(
        &self,
        id: i64,
        tool: &str,
        args: Value,
    ) -> Result<Value, SiteError> {
        let site = self.site(id)?;
        if site.mode != Mode::ClassicMonks {
            return Err(plain(
                "This site is in Basic mode. That needs Classic Monks.",
            ));
        }
        let read_only = site.capabilities["read_only"]
            .as_array()
            .is_some_and(|r| r.iter().any(|t| t == tool));
        let retry = if read_only {
            Retry::ReadOnly
        } else {
            Retry::Write
        };
        let reply = self
            .mcp(
                &site,
                Grant::Operator,
                "tools/call",
                json!({ "name": tool, "arguments": args }),
                retry,
            )
            .await?;
        tool_output(reply)
    }

    pub(crate) async fn mcp(
        &self,
        site: &Site,
        grant: Grant,
        method: &str,
        params: Value,
        retry: Retry,
    ) -> Result<Value, SiteError> {
        if grant == Grant::Operator && site.sign_in_again {
            return Err(SiteError::SignInAgain);
        }
        let tokens = self.access_token(site, grant).await?;
        let mut reply = self
            .post_mcp(
                &site.url,
                &site.api_url,
                &tokens.access_token,
                method,
                params.clone(),
                retry,
            )
            .await?;
        if reply.status == 401 {
            // Refused before it ran, so sending it again is safe.
            let tokens = self
                .refresh_after(site, grant, &tokens.access_token)
                .await?;
            reply = self
                .post_mcp(
                    &site.url,
                    &site.api_url,
                    &tokens.access_token,
                    method,
                    params,
                    retry,
                )
                .await?;
            if reply.status == 401 {
                return Err(self.grant_lost(site.id, grant));
            }
        }
        rpc_result(reply)
    }

    /// Add a site in Basic mode: core REST with an application password.
    pub async fn add_site_basic(
        &self,
        input: &str,
        username: &str,
        password: &str,
    ) -> Result<Site, SiteError> {
        self.connect_basic(input, None, username, password).await
    }

    pub async fn sign_in_again_basic(
        &self,
        id: i64,
        username: &str,
        password: &str,
    ) -> Result<Site, SiteError> {
        let site = self.site(id)?;
        self.connect_basic(&site.url, Some(id), username, password)
            .await
    }

    async fn connect_basic(
        &self,
        input: &str,
        existing: Option<i64>,
        username: &str,
        password: &str,
    ) -> Result<Site, SiteError> {
        let _work = self.working().await;
        let (username, password) = (username.trim(), password.trim());
        if username.is_empty() || password.is_empty() {
            return Err(plain(
                "Enter the WordPress user name and an application password.",
            ));
        }
        let url = self.start_add(input, existing).await?;
        let key = url.as_str();
        let root = self.rest_root(&url).await?;
        let secret = AppPassword {
            username: username.to_string(),
            password: password.to_string(),
        };
        let me = self
            .rest_get(
                key,
                &root,
                "/wp/v2/users/me",
                &[("context", "edit")],
                &secret,
            )
            .await?;
        if me.status == 401 || me.status == 403 {
            return Err(plain(
                "WordPress didn't accept this user name and application password. Check them. If they are right, the host may be removing the Authorization header, which Basic mode needs: ask the host to pass it through, or install Classic Monks.",
            ));
        }
        let me: Value = rest_json(&me)?;
        let env = self
            .rest_get(
                key,
                &root,
                "/wp-abilities/v1/abilities/core/get-environment-info/run",
                &[],
                &secret,
            )
            .await?;
        let mut details = Details::default();
        match env.status {
            200 => {
                let env: Value = rest_json(&env)?;
                details.wp_version = env["wp_version"].as_str().map(String::from);
                details.php_version = env["php_version"].as_str().map(String::from);
            }
            // No Abilities API: older than WordPress 6.9.
            404 => return Err(SiteError::TooOld("older than 6.9".into())),
            _ => details.wp_version = self.feed_version(&url).await,
        }
        if let Some(v) = details.wp_version.as_deref().filter(|v| !at_least_7_1(v)) {
            return Err(SiteError::TooOld(v.to_string()));
        }
        // The REST index names the site.
        let index = self.rest_get(key, &root, "/", &[], &secret).await?;
        if let Some(name) = index
            .json::<Value>()
            .and_then(|v| v["name"].as_str().map(String::from))
        {
            details.name = name;
        }
        let caps = &me["capabilities"];
        details.capabilities = json!({
            "user": me["username"],
            "roles": me["roles"],
            "manage_options": caps["manage_options"] == true,
            "install_plugins": caps["install_plugins"] == true,
            "activate_plugins": caps["activate_plugins"] == true,
            "edit_posts": caps["edit_posts"] == true,
        });
        let new = NewSite {
            url: &sites::url_string(&url),
            mode: Mode::Basic,
            api_url: &root,
            oauth: None,
            username: Some(username),
        };
        let id = self.save_site(existing, &new, details, &secret)?;
        self.after_connect(id).await
    }

    /// The REST root from the home page's `Link: rel="https://api.w.org/"`, so
    /// sites without pretty permalinks (`?rest_route=`) work.
    async fn rest_root(&self, url: &Url) -> Result<String, SiteError> {
        let home = sites::url_string(url);
        let reply = net::send(&self.limits, url.as_str(), Retry::ReadOnly, || {
            self.http.get(&home)
        })
        .await?;
        let from_link = reply
            .headers
            .get_all(reqwest::header::LINK)
            .iter()
            .filter_map(|v| v.to_str().ok())
            .flat_map(|v| v.split(','))
            .find(|l| l.contains("rel=\"https://api.w.org/\""))
            .and_then(|l| Some(l[l.find('<')? + 1..l.find('>')?].to_string()));
        Ok(from_link.unwrap_or_else(|| format!("{home}/wp-json/")))
    }

    pub(crate) async fn rest_get(
        &self,
        key: &str,
        root: &str,
        route: &str,
        query: &[(&str, &str)],
        secret: &AppPassword,
    ) -> Result<Reply, SiteError> {
        let url = rest_url(root, route);
        Ok(net::send(&self.limits, key, Retry::ReadOnly, || {
            self.http
                .get(&url)
                .query(query)
                .basic_auth(&secret.username, Some(&secret.password))
        })
        .await?)
    }

    /// Check one site and save its health. Never fails: problems become the health.
    pub async fn check_site(&self, id: i64) {
        let _work = self.working().await;
        self.check_site_inner(id).await;
    }

    async fn check_site_inner(&self, id: i64) {
        let Ok(site) = self.site(id) else { return };
        let (health, detail) = self.health(&site).await;
        let _ = self.db(|c| sites::set_health(c, id, health, &detail));
        self.notify();
        if health == Health::Ok {
            // Plugins, themes and updates, for the screens that show them.
            let _ = self.refresh_inventory_inner(id).await;
        }
    }

    async fn health(&self, site: &Site) -> (Health, String) {
        let started = Instant::now();
        let home = net::send(&self.limits, &site.url, Retry::ReadOnly, || {
            self.http.get(&site.url)
        })
        .await;
        let took = started.elapsed();
        match home {
            Err(e) => return (Health::Down, e.message.to_string()),
            Ok(r) if r.status >= 500 => {
                return (
                    Health::Down,
                    net::explain_status(&r).map_or_else(
                        || format!("The home page answered {}.", r.status),
                        String::from,
                    ),
                );
            }
            Ok(r) if r.status >= 400 => {
                return (
                    Health::Warning,
                    format!("The home page answered {}.", r.status),
                );
            }
            Ok(_) => {}
        }
        if let Err(e) = self.check_connection(site).await {
            return (Health::Warning, e.to_string());
        }
        let site = self.site(site.id).unwrap_or_else(|_| site.clone());
        if let Some(v) = site.wp_version.as_deref().filter(|v| !at_least_7_1(v)) {
            return (Health::Warning, format!("WordPress {v}. {TOO_OLD}"));
        }
        (Health::Ok, answered(took))
    }

    /// The connection works, and the versions are fresh.
    async fn check_connection(&self, site: &Site) -> Result<(), SiteError> {
        if site.sign_in_again {
            return Err(SiteError::SignInAgain);
        }
        match site.mode {
            Mode::ClassicMonks if site.capabilities["hq_status"] == true => {
                let hq = self
                    .call_ability_inner(site.id, "get-hq-status", json!({}))
                    .await?;
                let mut d = Details {
                    name: String::new(),
                    wp_version: hq["wordpress"]["version"].as_str().map(String::from),
                    php_version: hq["php"]["version"].as_str().map(String::from),
                    cm_version: hq["plugin"]["version"].as_str().map(String::from),
                    capabilities: site.capabilities.clone(),
                };
                d.capabilities["operator"] = hq["connection"]["operator"].clone();
                d.capabilities["pending_approvals"] = hq["pending_approvals"].clone();
                // Tools come and go with Classic Monks updates: keep the list current.
                let list = self
                    .mcp(
                        site,
                        Grant::Operator,
                        "tools/list",
                        json!({}),
                        Retry::ReadOnly,
                    )
                    .await?;
                let (names, read_only) = tool_names(&list);
                d.capabilities["abilities"] = json!(names);
                d.capabilities["read_only"] = json!(read_only);
                self.db(|c| sites::set_details(c, site.id, &d))
            }
            Mode::ClassicMonks => self
                .mcp(
                    site,
                    Grant::Operator,
                    "tools/list",
                    json!({}),
                    Retry::ReadOnly,
                )
                .await
                .map(drop),
            Mode::Basic => {
                let secret: AppPassword = self.load_secret(site.id)?;
                let me = self
                    .rest_get(&site.url, &site.api_url, "/wp/v2/users/me", &[], &secret)
                    .await?;
                match me.status {
                    200 => Ok(()),
                    401 | 403 => {
                        self.mark_sign_in_again(site.id)?;
                        Err(plain(
                            "WordPress no longer accepts the application password. Sign in again.",
                        ))
                    }
                    s => Err(plain(net::explain_status(&me).map_or_else(
                        || format!("The REST API answered {s}."),
                        String::from,
                    ))),
                }
            }
        }
    }

    /// Check every site, a few at a time (the request limits pace them).
    pub async fn check_all(self: &Arc<Self>) {
        let Ok(all) = self.sites() else { return };
        let mut set = tokio::task::JoinSet::new();
        for site in all {
            let core = self.clone();
            set.spawn(async move { core.check_site(site.id).await });
        }
        while set.join_next().await.is_some() {}
    }

    /// At start: close jobs a closed app left, renew every grant, check every
    /// site (and read its plugins), then check again every 15 minutes. Each
    /// site's security scan runs once a day. Home pages load every 5 minutes.
    pub fn start_background(self: &Arc<Self>) {
        let weak: Weak<Self> = Arc::downgrade(self);
        let _ = self.close_unfinished_jobs();
        let monitors = weak.clone();
        tokio::spawn(async move {
            loop {
                let Some(core) = monitors.upgrade() else {
                    return;
                };
                core.check_monitors(false).await;
                drop(core);
                tokio::time::sleep(crate::monitor::UPTIME_EVERY).await;
            }
        });
        tokio::spawn(async move {
            if let Some(core) = weak.upgrade() {
                core.refresh_all().await;
            }
            loop {
                let Some(core) = weak.upgrade() else { return };
                core.check_all().await;
                // Sites not scanned for a day.
                core.scan_all_security(true).await;
                drop(core);
                tokio::time::sleep(CHECK_EVERY).await;
            }
        });
    }

    /// Sign out on the site (`oauth/revoke`), then delete the secret and the site.
    pub async fn remove_site(&self, id: i64) -> Result<Removed, SiteError> {
        let _work = self.working().await;
        let site = self.site(id)?;
        let (signed_out, message) = match site.mode {
            Mode::ClassicMonks => match self.revoke_grant(&site, Grant::Operator).await {
                Ok(()) => (true, "Removed. Monks Central signed out of the site.".to_string()),
                Err(e) => (
                    false,
                    format!("Removed here, but the site couldn't be told ({e}). Remove the connection under AI > MCP on the site, or it ends by itself within 30 days."),
                ),
            },
            Mode::Basic => (
                false,
                "Removed. The application password still exists on the site: delete it under Users > Profile if nothing else uses it.".to_string(),
            ),
        };
        if site.agent_access {
            let _ = self.revoke_grant(&site, Grant::Agent).await;
        }
        self.db(|c| {
            self.delete_named(c, &secret_name(id))?;
            self.delete_named(c, &Grant::Agent.secret(id))?;
            sites::delete(c, id)
        })?;
        self.refresh_locks
            .lock()
            .unwrap()
            .retain(|(site, _), _| *site != id);
        self.notify();
        Ok(Removed {
            signed_out,
            message,
        })
    }

    pub(crate) async fn revoke_grant(&self, site: &Site, grant: Grant) -> Result<(), SiteError> {
        let client = grant
            .client(site)
            .ok_or_else(|| plain("no sign-in details"))?;
        let endpoint = client
            .revocation_endpoint
            .as_deref()
            .ok_or_else(|| plain("the site has no sign-out address"))?;
        let tokens = self.tokens(site.id, grant)?;
        // Waits for an in-flight refresh, so the token revoked is the current one.
        let lock = self.refresh_lock(site.id, grant);
        let _one = lock.lock().await;
        let tokens = self.tokens(site.id, grant).unwrap_or(tokens);
        oauth::revoke(
            &self.http,
            &self.limits,
            &site.url,
            endpoint,
            &client.client_id,
            &tokens.refresh_token,
        )
        .await?;
        Ok(())
    }
}

/// The detail for a healthy site. The UI shows a site whose detail starts with
/// "Slow" as healthy with a note.
fn answered(took: Duration) -> String {
    let said = if took > SLOW {
        "Slow: the home page took"
    } else {
        "Answered in"
    };
    format!("{said} {:.1} s.", took.as_secs_f64())
}

/// `root` + `route`, for both `/wp-json/` and `?rest_route=/` roots.
pub fn rest_url(root: &str, route: &str) -> String {
    if let Some(i) = root.find("rest_route=") {
        format!("{}{}", &root[..i + "rest_route=".len()], route)
    } else {
        format!("{}{}", root.trim_end_matches('/'), route)
    }
}

fn rest_json(reply: &Reply) -> Result<Value, SiteError> {
    if reply.status == 200
        && let Some(v) = reply.json()
    {
        return Ok(v);
    }
    Err(plain(net::explain_status(reply).map_or_else(
        || {
            format!(
                "The site's REST API answered {} and nothing Monks Central could read.",
                reply.status
            )
        },
        String::from,
    )))
}

/// The `result` of a JSON-RPC reply, or its error in plain words.
fn rpc_result(reply: Reply) -> Result<Value, SiteError> {
    let parsed: Option<Value> = reply.json();
    match parsed {
        Some(mut v) if v.get("result").is_some() => Ok(v["result"].take()),
        Some(v) if v.get("error").is_some() => Err(plain(format!(
            "Classic Monks said: {}",
            v["error"]["message"].as_str().unwrap_or("an unknown error")
        ))),
        _ => Err(plain(net::explain_status(&reply).map_or_else(
            || {
                if reply.status == 401 {
                    "The site refused Monks Central's sign-in.".to_string()
                } else {
                    format!(
                        "The site answered {} and nothing Monks Central could read.",
                        reply.status
                    )
                }
            },
            String::from,
        ))),
    }
}

/// The tools in a `tools/list` result, and the ones that only read.
fn tool_names(list: &Value) -> (Vec<&str>, Vec<&str>) {
    let tools = list["tools"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or_default();
    let names = tools.iter().filter_map(|t| t["name"].as_str()).collect();
    let read_only = tools
        .iter()
        .filter(|t| t["annotations"]["readOnlyHint"] == true)
        .filter_map(|t| t["name"].as_str())
        .collect();
    (names, read_only)
}

/// A tool call's structured output, or its error text.
pub(crate) fn tool_output(result: Value) -> Result<Value, SiteError> {
    if result["isError"] == true {
        let err = &result["structuredContent"];
        let msg = err["error"]
            .as_str()
            .or_else(|| result["content"][0]["text"].as_str())
            .unwrap_or("The tool failed.");
        if err["code"] == "cm_approval_required"
            && let Some(url) = err["approve_url"].as_str()
        {
            return Err(SiteError::NeedsApproval {
                message: site_said(msg),
                approve_url: url.to_string(),
            });
        }
        return Err(plain(site_said(msg)));
    }
    if let Some(s) = result.get("structuredContent") {
        return Ok(s.clone());
    }
    let text = result["content"][0]["text"].as_str().unwrap_or("null");
    Ok(serde_json::from_str(text).unwrap_or_else(|_| Value::String(text.into())))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::testsite::{Refresh, TestSite};
    use crate::{Options, sites::Mode};

    async fn core() -> (tempfile::TempDir, Arc<Core>) {
        let home = tempfile::tempdir().unwrap();
        let opts = Options {
            keychain: Ok(keyring_core::mock::Store::new().unwrap()),
            ..Default::default()
        };
        let core = Core::start(home.path(), opts).await.unwrap();
        (home, core)
    }

    #[test]
    fn site_errors_lose_their_html() {
        assert_eq!(
            site_said(
                "<strong>Error:</strong> The email could not be sent. <a href=\"https://wordpress.org/x/\">Get support</a>.\n"
            ),
            "Error: The email could not be sent. Get support."
        );
        assert_eq!(
            site_said("Tom &amp; Ana&#8217;s post"),
            "Tom & Ana\u{2019}s post"
        );
        let e = tool_output(json!({ "isError": true, "content": [{ "text": "<b>No</b> way" }] }));
        assert_eq!(e.unwrap_err().to_string(), "No way");
    }

    /// The browser: follows the site's consent redirect back to the loopback.
    fn browser(url: &str) -> std::io::Result<()> {
        let url = url.to_string();
        tokio::spawn(async move { reqwest::get(url).await });
        Ok(())
    }

    async fn added(core: &Core, site: &TestSite) -> Site {
        core.add_site_oauth(&site.url, browser).await.unwrap()
    }

    fn expire(core: &Core, id: i64) {
        let mut t: Tokens = core.load_secret(id).unwrap();
        t.expires_at = 0;
        core.save_secret(id, &t).unwrap();
    }

    #[test]
    fn a_slow_home_page_is_a_note() {
        assert_eq!(answered(Duration::from_millis(800)), "Answered in 0.8 s.");
        assert_eq!(answered(SLOW), "Answered in 3.0 s.");
        assert_eq!(
            answered(Duration::from_millis(4200)),
            "Slow: the home page took 4.2 s."
        );
    }

    #[test]
    fn version_floor_and_rest_urls() {
        for v in ["7.1", "7.1.3", "7.1-beta2", "7.2", "8.0", "10", "unknown"] {
            assert!(at_least_7_1(v), "{v}");
        }
        for v in ["7.0.7", "7.0", "6.9.4", "5.6"] {
            assert!(!at_least_7_1(v), "{v}");
        }
        assert_eq!(
            rest_url("https://a/wp-json/", "/wp/v2/users/me"),
            "https://a/wp-json/wp/v2/users/me"
        );
        assert_eq!(
            rest_url("https://a/?rest_route=/", "/wp/v2/users/me"),
            "https://a/?rest_route=/wp/v2/users/me"
        );
    }

    #[tokio::test]
    async fn oauth_site_is_added_with_its_capabilities() {
        let (_h, core) = core().await;
        let site = TestSite::start().await;
        let s = added(&core, &site).await;
        assert_eq!(s.mode, Mode::ClassicMonks);
        assert_eq!(
            s.api_url,
            format!("{}/wp-json/classic-monks/v1/mcp", site.url)
        );
        assert_eq!(s.name, "Test Site");
        assert_eq!(s.wp_version.as_deref(), Some("7.1.3"));
        assert_eq!(s.cm_version.as_deref(), Some("2.6.0-dev"));
        assert_eq!(s.capabilities["operator"], true);
        assert_eq!(s.capabilities["degraded"], false);
        assert!(
            s.capabilities["read_only"]
                .as_array()
                .unwrap()
                .iter()
                .any(|t| t == "get-posts")
        );
        assert_eq!(s.health, Health::Ok, "{}", s.health_detail);
        assert!(site.state().seen_x_cm > 0, "X-CM-Authorization is sent too");
        let err = core.add_site_oauth(&site.url, browser).await.unwrap_err();
        assert!(err.to_string().contains("already"), "{err}");
    }

    #[tokio::test]
    async fn twenty_parallel_calls_cause_one_refresh() {
        let (_h, core) = core().await;
        let site = TestSite::start().await;
        let s = added(&core, &site).await;
        let before = core.refreshes.load(Ordering::SeqCst);
        expire(&core, s.id);
        let calls: Vec<_> = (0..20)
            .map(|_| {
                let core = core.clone();
                tokio::spawn(async move { core.call_ability(s.id, "get-posts", json!({})).await })
            })
            .collect();
        for c in calls {
            c.await.unwrap().unwrap();
        }
        assert_eq!(core.refreshes.load(Ordering::SeqCst) - before, 1);
        assert_eq!(site.state().refreshes, 1);
    }

    #[tokio::test]
    async fn a_lost_refresh_is_not_retried() {
        let (_h, core) = core().await;
        let site = TestSite::start().await;
        let s = added(&core, &site).await;
        site.state().refresh = Refresh::ServerError;
        expire(&core, s.id);
        let err = core
            .call_ability(s.id, "get-posts", json!({}))
            .await
            .unwrap_err();
        assert!(matches!(err, SiteError::SignInAgain), "{err}");
        assert!(core.site(s.id).unwrap().sign_in_again);
        site.state().refresh = Refresh::Normal;
        let err = core
            .call_ability(s.id, "get-posts", json!({}))
            .await
            .unwrap_err();
        assert!(matches!(err, SiteError::SignInAgain));
        assert_eq!(core.refreshes.load(Ordering::SeqCst), 1, "no second try");
        assert_eq!(site.state().refreshes, 0);
    }

    #[tokio::test]
    async fn a_refused_token_is_refreshed_once_and_the_call_repeated() {
        let (_h, core) = core().await;
        let site = TestSite::start().await;
        let s = added(&core, &site).await;
        site.state().access_tokens.clear();
        let out = core
            .call_ability(s.id, "get-posts", json!({}))
            .await
            .unwrap();
        assert_eq!(out, json!({ "posts": [], "total": 0 }));
        assert_eq!(site.state().refreshes, 1);
    }

    #[tokio::test]
    async fn a_corrupt_secret_says_sign_in_again_until_signed_in() {
        let (_h, core) = core().await;
        let site = TestSite::start().await;
        let s = added(&core, &site).await;
        core.set_group(s.id, Some("Clients")).unwrap();
        core.add_note(s.id, "Ask before updating").unwrap();
        core.db(|c| {
            c.execute(
                "UPDATE credentials SET blob = x'00ff' WHERE name = ?1",
                [secret_name(s.id)],
            )
        })
        .unwrap();

        let err = core
            .call_ability(s.id, "get-posts", json!({}))
            .await
            .unwrap_err();
        assert_eq!(
            err.to_string(),
            "Monks Central can't read this site's saved sign-in. Sign in again."
        );
        assert!(core.site(s.id).unwrap().sign_in_again);
        core.check_site(s.id).await;
        assert_eq!(core.site(s.id).unwrap().health, Health::Warning);

        let again = core.sign_in_again_oauth(s.id, browser).await.unwrap();
        assert_eq!(again.id, s.id);
        assert!(!again.sign_in_again);
        assert_eq!(again.group.as_deref(), Some("Clients"));
        assert_eq!(again.notes.len(), 1);
        core.call_ability(s.id, "get-posts", json!({}))
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn signing_in_again_gives_back_the_old_grant() {
        let (_h, core) = core().await;
        let site = TestSite::start().await;
        let s = added(&core, &site).await;
        assert_eq!(site.state().live_grants(), 1);
        core.sign_in_again_oauth(s.id, browser).await.unwrap();
        assert_eq!(site.state().revoked, 1);
        assert_eq!(site.state().live_grants(), 1, "only the new grant is left");
        core.call_ability(s.id, "get-posts", json!({}))
            .await
            .unwrap();

        // An unreadable secret can't be given back: the new sign-in still works.
        core.db(|c| {
            c.execute(
                "UPDATE credentials SET blob = x'00ff' WHERE name = ?1",
                [secret_name(s.id)],
            )
        })
        .unwrap();
        core.sign_in_again_oauth(s.id, browser).await.unwrap();
        assert_eq!(site.state().revoked, 1);
        assert_eq!(site.state().live_grants(), 2);
        core.call_ability(s.id, "get-posts", json!({}))
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn remove_signs_out_on_the_site_then_deletes_secrets() {
        let (_h, core) = core().await;
        let site = TestSite::start().await;
        let s = added(&core, &site).await;
        let removed = core.remove_site(s.id).await.unwrap();
        assert!(removed.signed_out, "{}", removed.message);
        assert_eq!(site.state().revoked, 1);
        assert!(core.sites().unwrap().is_empty());
        let left: i64 = core
            .db(|c| c.query_row("SELECT count(*) FROM credentials", [], |r| r.get(0)))
            .unwrap();
        assert_eq!(left, 0);
    }

    #[tokio::test]
    async fn wordpress_below_7_1_is_refused() {
        let (_h, core) = core().await;
        let site = TestSite::start().await;
        site.state().feed_version = Some("7.0.7".into());
        let err = core
            .add_site_oauth(&site.url, |_| {
                panic!("no browser for a site that is too old")
            })
            .await
            .unwrap_err();
        assert_eq!(
            err.to_string(),
            "This site runs WordPress 7.0.7. Update WordPress to 7.1 or newer first."
        );

        // The feed hides the version: the sign-in happens, then the grant is given back.
        site.state().feed_version = None;
        site.state().wp_version = "7.0.7".into();
        let err = core.add_site_oauth(&site.url, browser).await.unwrap_err();
        assert!(matches!(err, SiteError::TooOld(_)), "{err}");
        assert_eq!(site.state().revoked, 1);
        assert!(core.sites().unwrap().is_empty());
        let err = core
            .add_site_basic(&site.url, "admin", "abcd efgh ijkl mnop qrst uvwx")
            .await
            .unwrap_err();
        assert!(matches!(err, SiteError::TooOld(_)), "{err}");
    }

    #[tokio::test]
    async fn host_that_strips_authorization_still_works_over_x_cm() {
        let (_h, core) = core().await;
        let site = TestSite::start().await;
        site.state().strip_authorization = true;
        let s = added(&core, &site).await;
        core.call_ability(s.id, "get-posts", json!({}))
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn released_classic_monks_is_degraded() {
        let (_h, core) = core().await;
        let site = TestSite::start().await;
        site.state().no_hq = true;
        let s = added(&core, &site).await;
        assert_eq!(s.capabilities["degraded"], true);
        assert_eq!(s.wp_version.as_deref(), Some("7.1.3"), "from the feed");
        assert_eq!(s.health, Health::Ok, "{}", s.health_detail);
    }

    #[tokio::test]
    async fn basic_mode() {
        let (_h, core) = core().await;
        let site = TestSite::start().await;
        site.state().mcp_off = true;
        let err = core.add_site_oauth(&site.url, browser).await.unwrap_err();
        assert!(err.to_string().contains("Basic mode"), "{err}");

        let err = core
            .add_site_basic(&site.url, "admin", "wrong")
            .await
            .unwrap_err();
        assert!(err.to_string().contains("didn't accept"), "{err}");

        let s = core
            .add_site_basic(&site.url, "admin", "abcd efgh ijkl mnop qrst uvwx")
            .await
            .unwrap();
        assert_eq!(s.mode, Mode::Basic);
        assert_eq!(s.name, "Test Site");
        assert_eq!(s.api_url, format!("{}/wp-json/", site.url));
        assert_eq!(
            (s.wp_version.as_deref(), s.php_version.as_deref()),
            (Some("7.1.3"), Some("8.4.26"))
        );
        assert_eq!(s.capabilities["install_plugins"], true);
        assert_eq!(s.health, Health::Ok, "{}", s.health_detail);

        site.state().app_password = "revoked".into();
        core.check_site(s.id).await;
        let s = core.site(s.id).unwrap();
        assert!(s.sign_in_again);
        let removed = core.remove_site(s.id).await.unwrap();
        assert!(!removed.signed_out);
    }

    #[tokio::test]
    async fn every_grant_is_renewed_at_start_and_down_sites_show() {
        let (_h, core) = core().await;
        let site = TestSite::start().await;
        let s = added(&core, &site).await;
        core.refresh_all().await;
        assert_eq!(site.state().refreshes, 1);
        site.state().home_status = 503;
        core.check_all().await;
        let s = core.site(s.id).unwrap();
        assert_eq!(s.health, Health::Down);
        assert!(s.health_detail.contains("error"), "{}", s.health_detail);
    }
}
