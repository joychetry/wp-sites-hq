//! A fake WordPress site for tests: Classic Monks' OAuth server as the plugin
//! runs it (rotating refresh tokens, reuse revokes the grant), its MCP endpoint,
//! the home page and feed, and the core REST routes Basic mode uses.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, MutexGuard};

use axum::extract::{Form, Query, State as Ax};
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::{any, delete, get, post};
use axum::{Json, Router};
use base64::Engine;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use serde_json::json;
use sha2::{Digest, Sha256};

#[derive(Debug, Default, Clone, Copy, PartialEq, Eq)]
pub enum Refresh {
    #[default]
    Normal,
    ServerError,
    Hang,
}

pub struct State {
    pub base: String,
    pub refreshes: usize,
    pub revoked: usize,
    pub refresh: Refresh,
    pub mcp_off: bool,
    /// What `get-hq-status` and core REST report.
    pub wp_version: String,
    /// What the feed's generator says; `None` hides it, as many sites do.
    pub feed_version: Option<String>,
    /// Released Classic Monks: no `get-hq-status`.
    pub no_hq: bool,
    pub operator: bool,
    /// The host drops the Authorization header.
    pub strip_authorization: bool,
    pub home_status: u16,
    pub app_password: String,
    pub mcp_calls: usize,
    /// Bearer tokens the MCP endpoint saw in Authorization and X-CM-Authorization.
    pub seen_x_cm: usize,
    /// Plugins as `get-site-snapshot` lists them; Basic mode's REST shows the same ones.
    pub plugins: Vec<serde_json::Value>,
    pub needs_credentials: bool,
    /// This tool fails, as an update that couldn't be installed.
    pub fail_tool: Option<String>,
    /// Classic Monks before M10: no safe update tools.
    pub no_safe_tools: bool,
    /// The next safe update fails to load, and the site puts the old version back.
    pub update_fatals: bool,
    /// The next update breaks the home page in a way only a visitor sees.
    pub update_breaks_home: bool,
    /// The next update writes this to the error log.
    pub log_on_update: Option<String>,
    /// The site's error log, a line each.
    pub error_log: Vec<String>,
    /// Every tool called, with its arguments.
    pub calls: Vec<(String, serde_json::Value)>,
    /// Posts, pages and books as WordPress stores them (`content` is the raw body).
    pub posts: Vec<serde_json::Value>,
    /// `{ id, taxonomy, name }`.
    pub terms: Vec<serde_json::Value>,
    pub media: Vec<serde_json::Value>,
    next_id: i64,
    saves: u32,
    /// Saving rewrites block comments, as a filter on a site might.
    pub mangle_blocks: bool,
    /// Classic Monks from before M6: no content tools.
    pub no_content_tools: bool,
    /// `{ id, username, email, name, role }`.
    pub users: Vec<serde_json::Value>,
    /// `{ id, post_id, post_title, author, email, content, date, status, parent }`;
    /// status as core REST says it: hold, approved, spam, trash.
    pub comments: Vec<serde_json::Value>,
    /// Classic Monks' on/off features and the ones Monks Central can't change.
    pub features: serde_json::Map<String, serde_json::Value>,
    pub locked: Vec<String>,
    pub settings: serde_json::Map<String, serde_json::Value>,
    /// Activity log rows, newest first, each with what undoing it puts back.
    pub activity: Vec<serde_json::Value>,
    pub approvals: Vec<serde_json::Value>,
    /// Users a password reset email went to.
    pub resets: Vec<i64>,
    /// Classic Monks as released (2.5.0): user, comment and feature tools only.
    pub released: bool,
    /// The login link create-login-link hands out.
    pub login_link: Option<String>,
    /// Code -> (PKCE challenge, client).
    codes: HashMap<String, (String, String)>,
    clients: u32,
    /// Grant (token family) -> the client it was given to.
    families: HashMap<u32, String>,
    /// Refresh token -> (spent, family).
    refresh_tokens: HashMap<String, (bool, u32)>,
    /// Access token -> family.
    pub access_tokens: HashMap<String, u32>,
    /// Client id -> the name it registered with.
    client_names: HashMap<String, String>,
    /// The human ticks "operator" on the consent page for AI agents' grant too.
    pub agent_operator: bool,
    /// Changes by AI agents' grant waiting for approval: (op id, tool, arguments).
    pub pending: Vec<(i64, String, serde_json::Value)>,
    /// Approved on the site, not run yet.
    approved: Vec<(String, serde_json::Value)>,
}

impl Default for State {
    fn default() -> Self {
        Self {
            base: String::new(),
            refreshes: 0,
            revoked: 0,
            refresh: Refresh::Normal,
            mcp_off: false,
            wp_version: "7.1.3".into(),
            feed_version: Some("7.1.3".into()),
            no_hq: false,
            operator: true,
            strip_authorization: false,
            home_status: 200,
            app_password: "abcd efgh ijkl mnop qrst uvwx".into(),
            mcp_calls: 0,
            seen_x_cm: 0,
            plugins: vec![json!({
                "plugin": "woocommerce/woocommerce.php", "name": "WooCommerce", "version": "10.2.0",
                "active": true, "auto_update": false, "update": "10.3.0",
            })],
            needs_credentials: false,
            fail_tool: None,
            no_safe_tools: false,
            update_fatals: false,
            update_breaks_home: false,
            log_on_update: None,
            error_log: Vec::new(),
            calls: Vec::new(),
            posts: Vec::new(),
            terms: vec![json!({ "id": 1, "taxonomy": "category", "name": "Uncategorized" })],
            media: Vec::new(),
            next_id: 100,
            saves: 0,
            mangle_blocks: false,
            no_content_tools: false,
            users: vec![
                json!({ "id": 1, "username": "admin", "email": "admin@example.com", "name": "Admin", "role": "administrator" }),
                json!({ "id": 2, "username": "sam", "email": "sam@example.com", "name": "Sam Shop", "role": "shop_manager" }),
            ],
            comments: vec![
                json!({ "id": 7, "post_id": 5, "post_title": "Hello world", "author": "Ana", "email": "ana@example.com", "content": "Lovely <b>bread</b>.", "date": "2026-10-28 09:00:00", "status": "hold", "parent": 0 }),
                json!({ "id": 8, "post_id": 5, "post_title": "Hello world", "author": "Bo", "email": "bo@example.com", "content": "First!", "date": "2026-10-27 09:00:00", "status": "approved", "parent": 0 }),
            ],
            features: [
                ("enable_svg_support", false),
                ("enable_maintenance_mode", false),
                ("enable_unplaced_thing", true),
            ]
            .into_iter()
            .map(|(k, v)| (k.to_string(), json!(v)))
            .collect(),
            locked: vec!["enable_maintenance_mode".into()],
            settings: [
                ("auto_resize_quality", json!(82)),
                ("limit_post_revisions", json!("default")),
            ]
            .into_iter()
            .map(|(k, v)| (k.to_string(), v))
            .collect(),
            activity: Vec::new(),
            approvals: vec![
                json!({ "op_id": 31, "tool": "delete-post", "client_label": "Claude [agent]", "user": "admin", "created_at": "2026-10-28 09:10:00", "expires_in": 600, "approve_url": "/wp-admin/admin.php?page=cm-ai-approve&op=31" }),
            ],
            resets: Vec::new(),
            released: false,
            login_link: None,
            codes: HashMap::new(),
            clients: 0,
            families: HashMap::new(),
            refresh_tokens: HashMap::new(),
            access_tokens: HashMap::new(),
            client_names: HashMap::new(),
            agent_operator: false,
            pending: Vec::new(),
            approved: Vec::new(),
        }
    }
}

type Shared = Arc<Mutex<State>>;

pub struct TestSite {
    pub url: String,
    state: Shared,
}

impl TestSite {
    pub async fn start() -> Self {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let state: Shared = Arc::new(Mutex::new(State {
            base: url.clone(),
            ..Default::default()
        }));
        let oauth = "/wp-json/classic-monks/v1/oauth";
        let app = Router::new()
            .route(
                "/.well-known/oauth-protected-resource",
                get(protected_resource),
            )
            .route(
                "/.well-known/oauth-authorization-server",
                get(server_metadata),
            )
            .route(&format!("{oauth}/register"), post(register))
            .route(&format!("{oauth}/authorize"), get(authorize))
            .route(&format!("{oauth}/token"), post(token))
            .route(&format!("{oauth}/revoke"), post(revoke))
            .route("/", get(home))
            .route("/wp-json/classic-monks/v1/mcp", post(mcp))
            .route("/wp-json/", get(rest_index))
            .route("/wp-json/wp/v2/users/me", get(users_me))
            .route(
                "/wp-json/wp-abilities/v1/abilities/core/get-environment-info/run",
                get(environment),
            )
            .route(
                "/wp-json/wp/v2/plugins",
                get(rest_plugins).post(rest_install),
            )
            .route(
                "/wp-json/wp/v2/plugins/{*plugin}",
                post(rest_set_status).merge(delete(rest_delete)),
            )
            .route("/wp-json/wp/v2/themes", get(rest_themes))
            .route("/wp-json/wp/v2/{base}", any(rest_content))
            .route("/wp-json/wp/v2/{base}/{id}", any(rest_content))
            .route("/img.png", get(image))
            .route(
                "/page.html",
                get(|| async { ([(header::CONTENT_TYPE, "text/html")], "<p>hi") }),
            )
            .with_state(state.clone());
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        Self { url, state }
    }

    pub fn state(&self) -> MutexGuard<'_, State> {
        self.state.lock().unwrap()
    }
}

impl State {
    /// Grants that still have a live refresh token.
    pub fn live_grants(&self) -> usize {
        let mut live: Vec<u32> = self
            .refresh_tokens
            .values()
            .filter(|(spent, _)| !spent)
            .map(|(_, f)| *f)
            .collect();
        live.sort_unstable();
        live.dedup();
        live.len()
    }

    /// A person approves every waiting change on the site's approve page.
    pub fn approve_all(&mut self) {
        let pending = std::mem::take(&mut self.pending);
        self.approved
            .extend(pending.into_iter().map(|(_, tool, args)| (tool, args)));
    }

    /// Grant families given to AI agents' client that still work.
    pub fn agent_grants(&self) -> usize {
        let mut live: Vec<u32> = self
            .access_tokens
            .values()
            .copied()
            .filter(|f| self.is_agent(*f))
            .collect();
        live.sort_unstable();
        live.dedup();
        live.len()
    }

    /// The owner removes AI agents' connection on the site.
    pub fn end_agent_grants(&mut self) {
        let agents: Vec<u32> = self
            .families
            .keys()
            .copied()
            .filter(|f| self.is_agent(*f))
            .collect();
        for f in agents {
            self.revoke_family(f);
        }
    }

    fn is_agent(&self, family: u32) -> bool {
        self.families
            .get(&family)
            .and_then(|c| self.client_names.get(c))
            .is_some_and(|n| n == crate::oauth::AGENT_CLIENT_NAME)
    }

    fn revoke_family(&mut self, family: u32) {
        self.refresh_tokens.retain(|_, (_, f)| *f != family);
        self.access_tokens.retain(|_, f| *f != family);
    }
}

fn mcp_url(base: &str) -> String {
    format!("{base}/wp-json/classic-monks/v1/mcp")
}

fn oauth_error(status: StatusCode, error: &str, description: &str) -> Response {
    (
        status,
        Json(json!({ "error": error, "error_description": description })),
    )
        .into_response()
}

async fn protected_resource(Ax(s): Ax<Shared>) -> Response {
    let s = s.lock().unwrap();
    if s.mcp_off {
        return (
            StatusCode::NOT_FOUND,
            [(header::CONTENT_TYPE, "text/html")],
            "<p>Not found",
        )
            .into_response();
    }
    Json(json!({
        "resource": mcp_url(&s.base),
        "authorization_servers": [s.base],
        "resource_name": "Test Site",
    }))
    .into_response()
}

async fn server_metadata(Ax(s): Ax<Shared>) -> Response {
    let base = s.lock().unwrap().base.clone();
    let o = format!("{base}/wp-json/classic-monks/v1/oauth");
    Json(json!({
        "issuer": base,
        "authorization_endpoint": format!("{o}/authorize"),
        "token_endpoint": format!("{o}/token"),
        "registration_endpoint": format!("{o}/register"),
        "revocation_endpoint": format!("{o}/revoke"),
        "code_challenge_methods_supported": ["S256"],
    }))
    .into_response()
}

/// A new client for every sign-in, as dynamic client registration does.
async fn register(Ax(s): Ax<Shared>, Json(body): Json<serde_json::Value>) -> Response {
    assert_eq!(body["redirect_uris"][0], crate::oauth::REDIRECT_URI);
    let mut s = s.lock().unwrap();
    s.clients += 1;
    let id = format!("cmc_test_{}", s.clients);
    let name = body["client_name"].as_str().unwrap_or_default().to_string();
    s.client_names.insert(id.clone(), name);
    (StatusCode::CREATED, Json(json!({ "client_id": id }))).into_response()
}

/// Stands in for the consent page: approves at once and goes back to the app.
async fn authorize(Ax(s): Ax<Shared>, Query(q): Query<HashMap<String, String>>) -> Response {
    let mut s = s.lock().unwrap();
    assert_eq!(q["code_challenge_method"], "S256");
    assert_eq!(q["resource"], mcp_url(&s.base));
    assert!(q["client_id"].starts_with("cmc_test_"));
    let code = crate::oauth::random_token(16);
    s.codes.insert(
        code.clone(),
        (q["code_challenge"].clone(), q["client_id"].clone()),
    );
    let mut back = reqwest::Url::parse(&q["redirect_uri"]).unwrap();
    back.query_pairs_mut()
        .append_pair("code", &code)
        .append_pair("state", &q["state"])
        .append_pair("iss", &s.base);
    let mut h = HeaderMap::new();
    h.insert(header::LOCATION, back.as_str().parse().unwrap());
    (StatusCode::FOUND, h).into_response()
}

fn issue(s: &mut State, family: u32) -> Response {
    let (access, refresh) = (
        format!("cmat_{}", crate::oauth::random_token(32)),
        format!("cmrt_{}", crate::oauth::random_token(32)),
    );
    s.access_tokens.insert(access.clone(), family);
    s.refresh_tokens.insert(refresh.clone(), (false, family));
    Json(json!({
        "access_token": access,
        "token_type": "Bearer",
        "expires_in": 3600,
        "refresh_token": refresh,
    }))
    .into_response()
}

async fn token(Ax(shared): Ax<Shared>, Form(f): Form<HashMap<String, String>>) -> Response {
    let mode = shared.lock().unwrap().refresh;
    if f["grant_type"] == "refresh_token" {
        match mode {
            Refresh::ServerError => {
                return (StatusCode::INTERNAL_SERVER_ERROR, "boom").into_response();
            }
            Refresh::Hang => {
                tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                return StatusCode::GATEWAY_TIMEOUT.into_response();
            }
            Refresh::Normal => {}
        }
    }
    let mut s = shared.lock().unwrap();
    assert_eq!(f["resource"], mcp_url(&s.base));
    match f["grant_type"].as_str() {
        "authorization_code" => {
            let Some((challenge, client)) = s.codes.remove(&f["code"]) else {
                return oauth_error(StatusCode::BAD_REQUEST, "invalid_grant", "Code used.");
            };
            let got = URL_SAFE_NO_PAD.encode(Sha256::digest(f["code_verifier"].as_bytes()));
            if got != challenge {
                return oauth_error(StatusCode::BAD_REQUEST, "invalid_grant", "PKCE failed.");
            }
            let family = s.families.len() as u32 + 1;
            s.families.insert(family, client);
            issue(&mut s, family)
        }
        "refresh_token" => match s.refresh_tokens.get(&f["refresh_token"]).copied() {
            Some((false, family)) => {
                s.refresh_tokens
                    .insert(f["refresh_token"].clone(), (true, family));
                s.refreshes += 1;
                issue(&mut s, family)
            }
            Some((true, family)) => {
                s.revoke_family(family);
                oauth_error(
                    StatusCode::BAD_REQUEST,
                    "invalid_grant",
                    "This refresh token was already used, so the whole grant was revoked. Connect again.",
                )
            }
            None => oauth_error(
                StatusCode::BAD_REQUEST,
                "invalid_grant",
                "The refresh token is invalid or expired.",
            ),
        },
        _ => oauth_error(StatusCode::BAD_REQUEST, "unsupported_grant_type", "No."),
    }
}

async fn revoke(Ax(s): Ax<Shared>, Form(f): Form<HashMap<String, String>>) -> Response {
    let mut s = s.lock().unwrap();
    // Only the client the grant was given to may revoke it.
    if let Some(&(_, family)) = s.refresh_tokens.get(&f["token"])
        && s.families.get(&family) == Some(&f["client_id"])
    {
        s.revoked += 1;
        s.revoke_family(family);
    }
    StatusCode::OK.into_response()
}

async fn home(Ax(s): Ax<Shared>, Query(q): Query<HashMap<String, String>>) -> Response {
    let s = s.lock().unwrap();
    if q.contains_key("feed") {
        let generator = s
            .feed_version
            .as_ref()
            .map(|v| format!("<generator>https://wordpress.org/?v={v}</generator>"))
            .unwrap_or_default();
        return format!("<?xml version=\"1.0\"?><rss><channel>{generator}</channel></rss>")
            .into_response();
    }
    let link = format!("<{}/wp-json/>; rel=\"https://api.w.org/\"", s.base);
    let body = if s.home_status >= 500 {
        "<html>There has been a critical error on this website.</html>"
    } else {
        "<html>home</html>"
    };
    (
        StatusCode::from_u16(s.home_status).unwrap(),
        [(header::LINK, link)],
        body,
    )
        .into_response()
}

/// The grant family of a token the request carries, if one is live.
fn bearer(s: &mut State, h: &HeaderMap) -> Option<u32> {
    let mut ok = None;
    for name in ["authorization", "x-cm-authorization"] {
        if name == "authorization" && s.strip_authorization {
            continue;
        }
        let Some(token) = h
            .get(name)
            .and_then(|v| v.to_str().ok())
            .and_then(|v| v.strip_prefix("Bearer "))
        else {
            continue;
        };
        if name == "x-cm-authorization" {
            s.seen_x_cm += 1;
        }
        ok = ok.or(s.access_tokens.get(token).copied());
    }
    ok
}

async fn mcp(Ax(s): Ax<Shared>, h: HeaderMap, Json(req): Json<serde_json::Value>) -> Response {
    let mut s = s.lock().unwrap();
    let Some(family) = bearer(&mut s, &h) else {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "code": "cm_mcp_unauthorized" })),
        )
            .into_response();
    };
    s.mcp_calls += 1;
    let agent = s.is_agent(family);
    let operator = if agent { s.agent_operator } else { s.operator };
    let result = match req["method"].as_str() {
        Some("tools/list") => {
            let mut tools = vec![
                json!({ "name": "get-posts", "annotations": { "readOnlyHint": true } }),
                json!({ "name": "update-post", "annotations": { "readOnlyHint": false, "destructiveHint": false } }),
            ];
            let content = CONTENT_TOOLS.iter().filter(|_| !s.no_content_tools);
            let people = PEOPLE_TOOLS
                .iter()
                .filter(|(n, _)| !s.released || RELEASED_PEOPLE_TOOLS.contains(n));
            let safe = SAFE_TOOLS.iter().filter(|_| !s.no_safe_tools);
            for (name, read_only) in PLUGIN_TOOLS.iter().chain(safe).chain(content).chain(people) {
                tools.push(json!({ "name": name, "annotations": { "readOnlyHint": read_only } }));
            }
            if !s.no_hq {
                tools.push(json!({ "name": "get-hq-status", "annotations": { "readOnlyHint": true } }));
            }
            json!({ "tools": tools })
        }
        Some("tools/call") if req["params"]["name"] == "get-hq-status" && !s.no_hq => {
            let status = json!({
                "plugin": { "version": "2.6.0-dev" },
                "wordpress": { "version": s.wp_version, "environment": "local" },
                "php": { "version": "8.4.26" },
                "mcp": { "approvals": true },
                "modules": { "ai": true, "woocommerce": true, "bricks": false },
                "connection": { "operator": operator, "scope": "full" },
                "pending_approvals": 0,
            });
            json!({ "content": [{ "type": "text", "text": status.to_string() }], "structuredContent": status })
        }
        Some("tools/call")
            if PLUGIN_TOOLS
                .iter()
                .chain(SAFE_TOOLS)
                .chain(CONTENT_TOOLS)
                .chain(PEOPLE_TOOLS)
                .chain(&[("get-posts", true), ("update-post", false)])
                .any(|(n, _)| req["params"]["name"] == *n) =>
        {
            let name = req["params"]["name"].as_str().unwrap_or_default().to_string();
            let args = req["params"]["arguments"].clone();
            let read_only = PLUGIN_TOOLS
                .iter()
                .chain(SAFE_TOOLS)
                .chain(CONTENT_TOOLS)
                .chain(PEOPLE_TOOLS)
                .any(|(n, r)| *n == name && *r)
                || name == "get-posts";
            // Classic Monks' approval gate: a change by a grant that isn't the operator waits.
            if !operator && !read_only {
                let call = (name.clone(), args.clone());
                if let Some(i) = s.approved.iter().position(|a| *a == call) {
                    s.approved.remove(i);
                } else {
                    let op = 40 + s.pending.len() as i64;
                    s.pending.push((op, name, args));
                    let url = format!("{}/wp-admin/admin.php?page=cm-ai-approve&op={op}", s.base);
                    let err = json!({
                        "error": format!("This change needs approval. Ask the user to open {url} and approve it, then call the same tool again with exactly the same arguments."),
                        "code": "cm_approval_required", "op_id": op, "approve_url": url,
                    });
                    return Json(json!({ "jsonrpc": "2.0", "id": req["id"], "result": {
                        "content": [{ "type": "text", "text": err.to_string() }], "structuredContent": err, "isError": true,
                    } })).into_response();
                }
            }
            s.calls.push((name.clone(), args.clone()));
            let out = if s.fail_tool.as_deref() == Some(name.as_str()) {
                Err("The update could not be installed.".to_string())
            } else if SAFE_TOOLS.iter().any(|(n, _)| *n == name) {
                Ok(safe_tool(&s, &name, &args))
            } else if PLUGIN_TOOLS.iter().any(|(n, _)| *n == name) {
                plugin_tool(&mut s, &name, &args)
            } else if PEOPLE_TOOLS.iter().any(|(n, _)| *n == name) {
                people_tool(&mut s, &name, &args)
            } else {
                content_tool(&mut s, &name, &args)
            };
            match out {
                Ok(v) => json!({ "content": [{ "type": "text", "text": v.to_string() }], "structuredContent": v }),
                Err(e) => {
                    let err = json!({ "error": e });
                    json!({ "content": [{ "type": "text", "text": err.to_string() }], "structuredContent": err, "isError": true })
                }
            }
        }
        Some("tools/call") => {
            let err = json!({ "error": "Unknown tool", "code": "x" });
            json!({ "content": [{ "type": "text", "text": err.to_string() }], "structuredContent": err, "isError": true })
        }
        _ => return Json(json!({ "jsonrpc": "2.0", "id": req["id"], "error": { "code": -32601, "message": "Method not found" } })).into_response(),
    };
    Json(json!({ "jsonrpc": "2.0", "id": req["id"], "result": result })).into_response()
}

fn basic_ok(s: &State, h: &HeaderMap) -> bool {
    let want = format!(
        "Basic {}",
        base64::engine::general_purpose::STANDARD.encode(format!("admin:{}", s.app_password))
    );
    !s.strip_authorization
        && h.get("authorization").and_then(|v| v.to_str().ok()) == Some(want.as_str())
}

fn not_logged_in() -> Response {
    (
        StatusCode::UNAUTHORIZED,
        Json(
            json!({ "code": "rest_not_logged_in", "message": "You are not currently logged in." }),
        ),
    )
        .into_response()
}

async fn users_me(Ax(s): Ax<Shared>, h: HeaderMap) -> Response {
    let s = s.lock().unwrap();
    if !basic_ok(&s, &h) {
        return not_logged_in();
    }
    Json(json!({
        "id": 1,
        "username": "admin",
        "name": "admin",
        "roles": ["administrator"],
        "capabilities": { "manage_options": true, "activate_plugins": true, "install_plugins": true, "edit_posts": true },
    }))
    .into_response()
}

async fn environment(Ax(s): Ax<Shared>, h: HeaderMap) -> Response {
    let s = s.lock().unwrap();
    if !basic_ok(&s, &h) {
        return not_logged_in();
    }
    Json(json!({ "environment": "local", "php_version": "8.4.26", "wp_version": s.wp_version }))
        .into_response()
}

async fn rest_index() -> Response {
    Json(json!({ "name": "Test Site", "namespaces": ["wp/v2", "wp-abilities/v1"] })).into_response()
}

/// The plugin tools the fake site has, and whether each only reads.
const PLUGIN_TOOLS: &[(&str, bool)] = &[
    ("get-site-snapshot", true),
    ("list-plugin-versions", true),
    ("update-plugin", false),
    ("rollback-plugin", false),
    ("activate-plugin", false),
    ("deactivate-plugin", false),
    ("uninstall-plugin", false),
    ("set-plugin-auto-update", false),
    ("install-plugin", false),
];

/// Classic Monks' safe update helpers (M10), all read-only.
const SAFE_TOOLS: &[(&str, bool)] = &[("get-http-status", true), ("get-error-log-since", true)];

fn safe_tool(s: &State, name: &str, args: &serde_json::Value) -> serde_json::Value {
    if name == "get-http-status" {
        let ok = s.home_status < 400;
        return json!({ "url": s.base, "status": s.home_status, "ok": ok, "ms": 40,
            "fatal": (!ok).then_some("PHP Fatal error: Uncaught Error in ABSPATH/wp-content/plugins/x/x.php on line 3"),
            "error": null, "maintenance": false });
    }
    let from = args["offset"]
        .as_u64()
        .map_or(s.error_log.len(), |o| o as usize);
    let lines = &s.error_log[from.min(s.error_log.len())..];
    json!({ "available": true, "offset": s.error_log.len(), "lines": lines,
        "fatal": lines.iter().filter(|l| l.contains("PHP Fatal error")).count(), "warnings": 0 })
}

fn plugin_tool(
    s: &mut State,
    name: &str,
    args: &serde_json::Value,
) -> Result<serde_json::Value, String> {
    let file = args["plugin_file"]
        .as_str()
        .or(args["plugin"].as_str())
        .unwrap_or_default()
        .to_string();
    if name == "get-site-snapshot" {
        return Ok(json!({
            "core": { "version": s.wp_version, "update": null },
            "plugins": s.plugins,
            "themes": [{ "stylesheet": "twentytwentyfive", "name": "Twenty Twenty-Five", "version": "1.2", "active": true, "auto_update": false, "update": null }],
            "updates": { "translations": [] },
            "filesystem": { "needs_credentials": s.needs_credentials },
        }));
    }
    if name == "install-plugin" {
        let slug = args["slug"]
            .as_str()
            .ok_or("Only WordPress.org slugs here.")?;
        s.plugins.push(json!({ "plugin": format!("{slug}/{slug}.php"), "name": slug, "version": "1.0", "active": args["activate"] == true, "auto_update": false, "update": null }));
        return Ok(json!({ "installed": true, "message": "Installed." }));
    }
    let i = s
        .plugins
        .iter()
        .position(|p| p["plugin"] == file.as_str())
        .ok_or("That plugin isn't installed.")?;
    let p = &mut s.plugins[i];
    Ok(match name {
        "list-plugin-versions" => json!({
            "plugin": file,
            "installed": p["version"],
            "versions": [{ "version": "10.3.0" }, { "version": "10.2.0" }, { "version": "10.1.0" }],
        }),
        "update-plugin" if p["update"].is_string() && args["safe"] == true && s.update_fatals => {
            s.update_fatals = false;
            let folder = file.split('/').next().unwrap_or_default();
            let reason = format!(
                "The home page answered 500 after the update: PHP Fatal error: Uncaught Error: Call to undefined function boom() in ABSPATH/wp-content/plugins/{folder}/{folder}.php on line 4"
            );
            json!({ "updated": false, "rolled_back": true, "reason": reason, "previous_version": p["version"], "version": p["version"],
                "message": format!("The update broke the site, so the previous version was put back. {reason}") })
        }
        "update-plugin" if p["update"].is_string() => {
            let previous = p["version"].clone();
            p["version"] = p["update"].take();
            let out = json!({ "updated": true, "previous_version": previous, "version": p["version"], "message": "Updated.",
                "checked": args["safe"] == true, "rolled_back": false });
            if s.update_breaks_home {
                s.home_status = 500;
            }
            if let Some(line) = s.log_on_update.take() {
                s.error_log.push(line);
            }
            out
        }
        "update-plugin" => json!({ "updated": false, "message": "This plugin is up to date." }),
        "rollback-plugin" => {
            let from = p["version"].clone();
            p["version"] = args["version"].clone();
            p["update"] = from.clone();
            if s.update_breaks_home {
                s.update_breaks_home = false;
                s.home_status = 200;
            }
            json!({ "plugin": file, "from": from, "to": args["version"], "message": "Rolled back." })
        }
        "activate-plugin" | "deactivate-plugin" => {
            p["active"] = json!(name == "activate-plugin");
            json!({ "active": p["active"] })
        }
        "set-plugin-auto-update" => {
            p["auto_update"] = args["enabled"].clone();
            json!({ "enabled": args["enabled"] })
        }
        "uninstall-plugin" => {
            s.plugins.remove(i);
            json!({ "uninstalled": true })
        }
        _ => unreachable!("not a plugin tool: {name}"),
    })
}

/// Core REST plugins: files without `.php`, status active or inactive.
async fn rest_plugins(Ax(s): Ax<Shared>, h: HeaderMap) -> Response {
    let s = s.lock().unwrap();
    if !basic_ok(&s, &h) {
        return not_logged_in();
    }
    let list: Vec<_> = s
        .plugins
        .iter()
        .map(|p| {
            json!({
                "plugin": p["plugin"].as_str().unwrap_or_default().trim_end_matches(".php"),
                "name": p["name"],
                "version": p["version"],
                "status": if p["active"] == true { "active" } else { "inactive" },
            })
        })
        .collect();
    Json(list).into_response()
}

async fn rest_themes(Ax(s): Ax<Shared>, h: HeaderMap) -> Response {
    if !basic_ok(&s.lock().unwrap(), &h) {
        return not_logged_in();
    }
    Json(json!([{ "stylesheet": "twentytwentyfive", "name": { "rendered": "Twenty Twenty-Five" }, "version": "1.2", "status": "active" }])).into_response()
}

async fn rest_install(
    Ax(s): Ax<Shared>,
    h: HeaderMap,
    Json(body): Json<serde_json::Value>,
) -> Response {
    let mut s = s.lock().unwrap();
    if !basic_ok(&s, &h) {
        return not_logged_in();
    }
    let slug = body["slug"].as_str().unwrap_or_default();
    s.plugins.push(json!({ "plugin": format!("{slug}/{slug}.php"), "name": slug, "version": "1.0", "active": body["status"] == "active" }));
    StatusCode::CREATED.into_response()
}

fn rest_find(s: &State, plugin: &str) -> Option<usize> {
    s.plugins
        .iter()
        .position(|p| p["plugin"] == format!("{plugin}.php"))
}

async fn rest_set_status(
    Ax(s): Ax<Shared>,
    axum::extract::Path(plugin): axum::extract::Path<String>,
    h: HeaderMap,
    Json(body): Json<serde_json::Value>,
) -> Response {
    let mut s = s.lock().unwrap();
    if !basic_ok(&s, &h) {
        return not_logged_in();
    }
    let Some(i) = rest_find(&s, &plugin) else {
        return StatusCode::NOT_FOUND.into_response();
    };
    s.plugins[i]["active"] = json!(body["status"] == "active");
    StatusCode::OK.into_response()
}

async fn rest_delete(
    Ax(s): Ax<Shared>,
    axum::extract::Path(plugin): axum::extract::Path<String>,
    h: HeaderMap,
) -> Response {
    let mut s = s.lock().unwrap();
    if !basic_ok(&s, &h) {
        return not_logged_in();
    }
    match rest_find(&s, &plugin) {
        Some(i) if s.plugins[i]["active"] == true => (
            StatusCode::BAD_REQUEST,
            Json(json!({ "code": "rest_cannot_delete_active_plugin", "message": "Deactivate the plugin before deleting it." })),
        )
            .into_response(),
        Some(i) => {
            s.plugins.remove(i);
            StatusCode::OK.into_response()
        }
        None => StatusCode::NOT_FOUND.into_response(),
    }
}

/// The content tools of Classic Monks with M6, and whether each only reads.
const CONTENT_TOOLS: &[(&str, bool)] = &[
    ("list-post-types", true),
    ("get-post-by-id", true),
    ("get-terms", true),
    ("get-media", true),
    ("create-post", false),
    ("delete-post", false),
    ("import-media-from-url", false),
];

/// (name, plural, singular, REST base, taxonomies)
const TYPES: &[(&str, &str, &str, &str, &[&str])] = &[
    ("post", "Posts", "Post", "posts", &["category"]),
    ("page", "Pages", "Page", "pages", &[]),
    ("cm_book", "Books", "Book", "books", &["cm_genre"]),
];
/// (name, label, REST base, hierarchical)
const TAXES: &[(&str, &str, &str, bool)] = &[
    ("category", "Categories", "categories", true),
    ("cm_genre", "Genres", "genres", false),
];

fn type_of_base(base: &str) -> Option<&'static str> {
    TYPES.iter().find(|t| t.3 == base).map(|t| t.0)
}

fn tax_of_base(base: &str) -> Option<&'static str> {
    TAXES.iter().find(|t| t.2 == base).map(|t| t.0)
}

const DOT_PNG: &[u8] = &[
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52,
];

async fn image() -> Response {
    ([(header::CONTENT_TYPE, "image/png")], DOT_PNG).into_response()
}

impl State {
    fn new_id(&mut self) -> i64 {
        self.next_id += 1;
        self.next_id
    }

    /// A term id for an id or a name, adding names that are new.
    fn term(&mut self, taxonomy: &str, r: &serde_json::Value) -> Result<i64, String> {
        if let Some(id) = r.as_i64() {
            return self
                .terms
                .iter()
                .any(|t| t["id"] == id && t["taxonomy"] == taxonomy)
                .then_some(id)
                .ok_or(format!("There is no term {id}."));
        }
        let name = r.as_str().unwrap_or_default();
        if let Some(t) = self
            .terms
            .iter()
            .find(|t| t["taxonomy"] == taxonomy && t["name"] == name)
        {
            return Ok(t["id"].as_i64().unwrap());
        }
        let id = self.new_id();
        self.terms
            .push(json!({ "id": id, "taxonomy": taxonomy, "name": name }));
        Ok(id)
    }

    /// Create (no id) or change an entry from Classic Monks' fields.
    fn save(&mut self, id: Option<i64>, ty: &str, f: &serde_json::Value) -> Result<i64, String> {
        let mut terms = serde_json::Map::new();
        for (tax, refs) in f["terms"].as_object().into_iter().flatten() {
            let ids = refs
                .as_array()
                .into_iter()
                .flatten()
                .map(|r| self.term(tax, r))
                .collect::<Result<Vec<_>, _>>()?;
            terms.insert(tax.clone(), json!(ids));
        }
        self.saves += 1;
        let modified = format!("2026-10-28 10:00:{:02}", self.saves);
        let id = match id {
            Some(id) => id,
            None => {
                let id = self.new_id();
                self.posts.push(json!({
                    "id": id, "type": ty, "title": "", "status": "draft", "content": "",
                    "date": modified, "terms": {}, "featured": 0, "builder": null,
                }));
                id
            }
        };
        let mangle = self.mangle_blocks;
        let p = self
            .posts
            .iter_mut()
            .find(|p| p["id"] == id)
            .ok_or("Post not found.")?;
        if !f["content"].is_null() && !p["builder"].is_null() {
            return Err(
                "This page is built with Elementor, which keeps the body in its own data.".into(),
            );
        }
        for (k, v) in [
            ("title", "title"),
            ("status", "status"),
            ("content", "content"),
            ("featured_image", "featured"),
        ] {
            if !f[k].is_null() {
                p[v] = f[k].clone();
            }
        }
        if mangle && let Some(c) = p["content"].as_str() {
            p["content"] = c.replace("wp:paragraph", "wp:html").into();
        }
        for (tax, ids) in terms {
            p["terms"][tax] = ids;
        }
        p["modified"] = modified.into();
        Ok(id)
    }

    fn named(&self, ids: &serde_json::Value) -> Vec<serde_json::Value> {
        ids.as_array()
            .into_iter()
            .flatten()
            .filter_map(|id| self.terms.iter().find(|t| t["id"] == *id))
            .map(|t| json!({ "id": t["id"], "name": t["name"], "slug": "" }))
            .collect()
    }

    fn cm_post(&self, p: &serde_json::Value) -> serde_json::Value {
        let ty = TYPES.iter().find(|t| p["type"] == t.0).unwrap();
        let terms: serde_json::Map<_, _> =
            ty.4.iter()
                .map(|tax| (tax.to_string(), json!(self.named(&p["terms"][*tax]))))
                .collect();
        let featured = p["featured"].as_i64().unwrap_or_default();
        json!({
            "id": p["id"], "type": p["type"], "title": p["title"], "status": p["status"], "content": p["content"],
            "date": p["date"], "modified": p["modified"], "permalink": format!("{}/?p={}", self.base, p["id"]),
            "featured_image_id": featured,
            "featured_image": (featured > 0).then(|| format!("{}/img.png", self.base)),
            "terms": terms, "builder": p["builder"],
        })
    }

    fn rest_post(&self, p: &serde_json::Value) -> serde_json::Value {
        let ty = TYPES.iter().find(|t| p["type"] == t.0).unwrap();
        let date = |v: &serde_json::Value| v.as_str().unwrap_or_default().replacen(' ', "T", 1);
        let rendered = if p["builder"] == "bricks" {
            "<div class=\"brxe-section\"></div>"
        } else {
            ""
        };
        let mut v = json!({
            "id": p["id"], "type": p["type"], "status": p["status"], "link": format!("{}/?p={}", self.base, p["id"]),
            "title": { "raw": p["title"], "rendered": p["title"] },
            "content": { "raw": p["content"], "rendered": rendered },
            "date": date(&p["date"]), "modified": date(&p["modified"]), "featured_media": p["featured"],
            "_embedded": { "author": [{ "name": "admin" }] },
        });
        for tax in ty.4 {
            let base = TAXES.iter().find(|t| t.0 == *tax).unwrap().2;
            v[base] = if p["terms"][*tax].is_array() {
                p["terms"][*tax].clone()
            } else {
                json!([])
            };
        }
        v
    }

    fn list(&self, ty: &str, status: &str, search: &str) -> Vec<serde_json::Value> {
        let statuses: Vec<&str> = status.split(',').collect();
        self.posts
            .iter()
            .rev()
            .filter(|p| p["type"] == ty && statuses.iter().any(|s| p["status"] == *s))
            .filter(|p| p["title"].as_str().unwrap_or_default().contains(search))
            .cloned()
            .collect()
    }

    fn add_media(&mut self, url: &str, mime: &str, alt: &str) -> serde_json::Value {
        let id = self.new_id();
        let m = json!({ "id": id, "title": format!("image-{id}"), "url": url, "mime_type": mime, "alt_text": alt, "date": "2026-10-28 10:00:00" });
        self.media.insert(0, m.clone());
        m
    }
}

fn content_tool(
    s: &mut State,
    name: &str,
    a: &serde_json::Value,
) -> Result<serde_json::Value, String> {
    let post = |s: &State| {
        s.posts
            .iter()
            .find(|p| p["id"] == a["post_id"])
            .cloned()
            .ok_or("Post not found.".to_string())
    };
    Ok(match name {
        "list-post-types" => json!({ "post_types": TYPES.iter().map(|t| json!({
            "name": t.0, "label": t.1, "singular": t.2, "hierarchical": t.0 == "page",
            "supports": ["title", "editor", "thumbnail"], "can_publish": true, "can_delete": true,
            "taxonomies": t.4.iter().map(|x| {
                let tax = TAXES.iter().find(|y| y.0 == *x).unwrap();
                json!({ "name": tax.0, "label": tax.1, "hierarchical": tax.3, "can_add": true })
            }).collect::<Vec<_>>(),
        })).collect::<Vec<_>>() }),
        "get-posts" => {
            let all = s.list(
                a["post_type"].as_str().unwrap_or("post"),
                a["status"].as_str().unwrap_or("publish,draft"),
                a["search"].as_str().unwrap_or_default(),
            );
            let (off, lim) = (
                a["offset"].as_u64().unwrap_or(0) as usize,
                a["limit"].as_u64().unwrap_or(10) as usize,
            );
            let posts: Vec<_> = all.iter().skip(off).take(lim).map(|p| json!({
                "id": p["id"], "title": p["title"], "status": p["status"], "type": p["type"], "date": p["date"],
                "modified": p["modified"], "author": "Joy", "permalink": format!("{}/?p={}", s.base, p["id"]),
            })).collect();
            json!({ "posts": posts, "total": all.len() })
        }
        "get-post-by-id" => s.cm_post(&post(s)?),
        "get-terms" => {
            let search = a["search"].as_str().unwrap_or_default();
            let terms: Vec<_> = s
                .terms
                .iter()
                .filter(|t| {
                    t["taxonomy"] == a["taxonomy"] && t["name"].as_str().unwrap().contains(search)
                })
                .cloned()
                .collect();
            json!({ "terms": terms })
        }
        "create-post" => {
            json!({ "id": s.save(None, a["post_type"].as_str().unwrap_or("post"), a)? })
        }
        "update-post" => {
            let ty = post(s)?["type"].as_str().unwrap().to_string();
            json!({ "post_id": s.save(a["post_id"].as_i64(), &ty, a)? })
        }
        "delete-post" => {
            s.save(a["post_id"].as_i64(), "", &json!({ "status": "trash" }))?;
            json!({ "deleted": true, "message": "Post moved to trash." })
        }
        "get-media" => {
            let images = a["mime_type"] == "image";
            let list: Vec<_> = s
                .media
                .iter()
                .filter(|m| !images || m["mime_type"].as_str().unwrap().starts_with("image/"))
                .cloned()
                .collect();
            json!({ "media": list, "total": list.len() })
        }
        "import-media-from-url" => {
            let m = s.add_media(
                a["url"].as_str().unwrap_or_default(),
                "image/png",
                a["alt"].as_str().unwrap_or_default(),
            );
            json!({ "attachment_id": m["id"], "url": m["url"], "mime_type": "image/png", "filename": "img.png" })
        }
        _ => unreachable!("not a content tool: {name}"),
    })
}

/// Core REST for content: types, taxonomies, posts by REST base, terms and media.
async fn rest_content(
    Ax(shared): Ax<Shared>,
    axum::extract::Path(path): axum::extract::Path<Vec<String>>,
    method: axum::http::Method,
    Query(q): Query<HashMap<String, String>>,
    h: HeaderMap,
    body: axum::body::Bytes,
) -> Response {
    let mut s = shared.lock().unwrap();
    if !basic_ok(&s, &h) {
        return not_logged_in();
    }
    let (base, id) = (
        path[0].as_str(),
        path.get(1).and_then(|i| i.parse::<i64>().ok()),
    );
    let json_body: serde_json::Value = serde_json::from_slice(&body).unwrap_or_default();
    let ok = |v: serde_json::Value| Json(v).into_response();
    let created = |v: serde_json::Value| (StatusCode::CREATED, Json(v)).into_response();
    let missing = || {
        (
            StatusCode::NOT_FOUND,
            Json(json!({ "code": "rest_post_invalid_id", "message": "Invalid post ID." })),
        )
            .into_response()
    };
    match (base, id, method.as_str()) {
        ("types", None, "GET") => {
            let mut out = serde_json::Map::new();
            out.insert(
                "attachment".into(),
                json!({ "name": "Media", "rest_base": "media", "taxonomies": [] }),
            );
            for t in TYPES.iter().filter(|t| t.0 != "cm_book") {
                out.insert(t.0.into(), json!({ "name": t.1, "labels": { "singular_name": t.2 }, "rest_base": t.3, "taxonomies": t.4, "hierarchical": t.0 == "page", "supports": { "title": true, "editor": true } }));
            }
            ok(out.into())
        }
        ("taxonomies", None, "GET") => ok(TAXES
            .iter()
            .map(|t| {
                (
                    t.0.to_string(),
                    json!({ "slug": t.0, "name": t.1, "rest_base": t.2, "hierarchical": t.3 }),
                )
            })
            .collect::<serde_json::Map<_, _>>()
            .into()),
        ("media", None, "GET") => {
            if q.get("page").is_some_and(|p| p != "1") {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(json!({ "code": "rest_post_invalid_page_number" })),
                )
                    .into_response();
            }
            let list: Vec<_> = s.media.iter().map(|m| json!({ "id": m["id"], "title": { "rendered": m["title"] }, "source_url": m["url"], "mime_type": m["mime_type"], "alt_text": m["alt_text"], "date": "2026-10-28T10:00:00" })).collect();
            ok(list.into())
        }
        ("media", None, "POST") => {
            let mime = h
                .get(header::CONTENT_TYPE)
                .and_then(|v| v.to_str().ok())
                .unwrap_or_default()
                .to_string();
            let named = h
                .get(header::CONTENT_DISPOSITION)
                .and_then(|v| v.to_str().ok())
                .is_some_and(|d| d.contains("filename=\""));
            if !named || body.as_ref() != DOT_PNG {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(json!({ "code": "rest_upload_no_data", "message": "No data supplied." })),
                )
                    .into_response();
            }
            let url = format!("{}/wp-content/uploads/img.png", s.base);
            let m = s.add_media(&url, &mime, q.get("alt_text").map_or("", String::as_str));
            created(
                json!({ "id": m["id"], "title": { "rendered": m["title"] }, "source_url": url, "mime_type": mime, "alt_text": m["alt_text"], "date": "2026-10-28T10:00:00" }),
            )
        }
        ("media", Some(id), "GET") => match s.media.iter().find(|m| m["id"] == id) {
            Some(m) => ok(json!({ "id": id, "source_url": m["url"] })),
            None => missing(),
        },
        (b, None, "GET") if tax_of_base(b).is_some() => {
            let tax = tax_of_base(b).unwrap();
            let search = q.get("search").cloned().unwrap_or_default();
            let include: Vec<String> = q
                .get("include")
                .map(|i| i.split(',').map(String::from).collect())
                .unwrap_or_default();
            let list: Vec<_> = s
                .terms
                .iter()
                .filter(|t| {
                    t["taxonomy"] == tax
                        && t["name"]
                            .as_str()
                            .unwrap()
                            .to_lowercase()
                            .contains(&search.to_lowercase())
                })
                .filter(|t| include.is_empty() || include.contains(&t["id"].to_string()))
                .map(|t| json!({ "id": t["id"], "name": t["name"] }))
                .collect();
            ok(list.into())
        }
        (b, None, "POST") if tax_of_base(b).is_some() => {
            let tax = tax_of_base(b).unwrap();
            let id = s.term(tax, &json_body["name"]).unwrap();
            created(json!({ "id": id, "name": json_body["name"] }))
        }
        ("users" | "comments", id, m) => rest_people(&mut s, base, id, m, &q, &json_body),
        (b, id, m) if type_of_base(b).is_some() => {
            let ty = type_of_base(b).unwrap();
            // Core REST fields to Classic Monks' (the store speaks those).
            let mut f = json!({ "title": json_body["title"], "status": json_body["status"], "content": json_body["content"], "featured_image": json_body["featured_media"], "terms": {} });
            for tax in TYPES.iter().find(|t| t.0 == ty).unwrap().4 {
                let base = TAXES.iter().find(|t| t.0 == *tax).unwrap().2;
                if json_body[base].is_array() {
                    f["terms"][*tax] = json_body[base].clone();
                }
            }
            match (id, m) {
                (None, "GET") => {
                    let all = s.list(
                        ty,
                        q.get("status").map_or("publish", String::as_str),
                        q.get("search").map_or("", String::as_str),
                    );
                    let page: Vec<_> = all.iter().take(20).map(|p| s.rest_post(p)).collect();
                    let mut r = Json(page).into_response();
                    r.headers_mut()
                        .insert("x-wp-total", all.len().to_string().parse().unwrap());
                    r
                }
                (None, "POST") => match s.save(None, ty, &f) {
                    Ok(id) => {
                        let p = s.posts.iter().find(|p| p["id"] == id).unwrap().clone();
                        created(s.rest_post(&p))
                    }
                    Err(e) => {
                        (StatusCode::BAD_REQUEST, Json(json!({ "message": e }))).into_response()
                    }
                },
                (Some(id), method) if s.posts.iter().any(|p| p["id"] == id && p["type"] == ty) => {
                    let saved = match method {
                        "POST" => s.save(Some(id), ty, &f),
                        "DELETE" => s.save(Some(id), ty, &json!({ "status": "trash" })),
                        _ => Ok(id),
                    };
                    if let Err(e) = saved {
                        return (StatusCode::BAD_REQUEST, Json(json!({ "message": e })))
                            .into_response();
                    }
                    let p = s.posts.iter().find(|p| p["id"] == id).unwrap().clone();
                    ok(s.rest_post(&p))
                }
                _ => missing(),
            }
        }
        _ => (
            StatusCode::NOT_FOUND,
            Json(json!({ "code": "rest_no_route", "message": "No route was found." })),
        )
            .into_response(),
    }
}

/// User, comment and Classic Monks tools, and whether each only reads.
const PEOPLE_TOOLS: &[(&str, bool)] = &[
    ("get-users", true),
    ("create-user", false),
    ("update-user", false),
    ("delete-user", false),
    ("send-password-reset", false),
    ("get-comments", true),
    ("moderate-comment", false),
    ("reply-to-comment", false),
    ("create-login-link", false),
    ("get-features", true),
    ("update-features", false),
    ("get-settings-schema", true),
    ("get-settings", true),
    ("update-settings", false),
    ("list-ai-activity", true),
    ("undo-operation", false),
    ("list-pending-approvals", true),
];
/// What Classic Monks 2.5.0 has of those.
const RELEASED_PEOPLE_TOOLS: &[&str] = &[
    "get-users",
    "create-user",
    "update-user",
    "delete-user",
    "get-comments",
    "moderate-comment",
    "reply-to-comment",
    "get-features",
    "update-features",
];

impl State {
    fn log(&mut self, tool: &str, input: serde_json::Value, undo: serde_json::Value) {
        let id = self.activity.len() as i64 + 1;
        self.activity.insert(0, json!({
            "id": id, "created_at": "2026-10-28 10:00:00", "user": "admin", "source": "mcp",
            "client_label": "Monks Central [operator]", "tool": tool, "status": "ok", "summary": "",
            "input": input, "can_undo": true, "undo": undo,
        }));
    }

    fn user(&self, id: &serde_json::Value) -> Option<usize> {
        self.users.iter().position(|u| u["id"] == *id)
    }
}

fn people_tool(
    s: &mut State,
    name: &str,
    a: &serde_json::Value,
) -> Result<serde_json::Value, String> {
    Ok(match name {
        "get-users" => {
            let search = a["search"].as_str().unwrap_or_default();
            let list: Vec<_> = s
                .users
                .iter()
                .filter(|u| u["username"].as_str().unwrap().contains(search))
                .map(|u| json!({ "id": u["id"], "username": u["username"], "email": u["email"], "display_name": u["name"], "role": u["role"], "registered_date": "2026-01-02 03:04:05" }))
                .collect();
            let mut out = json!({ "users": list, "total": list.len() });
            if !s.released {
                out["roles"] = json!([{ "id": "administrator", "name": "Administrator" }, { "id": "shop_manager", "name": "Shop manager" }, { "id": "subscriber", "name": "Subscriber" }]);
            }
            out
        }
        "create-user" => {
            if a["role"] == "administrator" && a["confirm_admin_role"] != true {
                return Err("Ask the user to confirm.".into());
            }
            if s.users.iter().any(|u| u["username"] == a["username"]) {
                return Err("Sorry, that username already exists!".into());
            }
            let id = s.new_id();
            let role = a["role"].as_str().unwrap_or("subscriber");
            s.users.push(json!({ "id": id, "username": a["username"], "email": a["email"], "name": a["username"], "role": role }));
            json!({ "id": id, "username": a["username"], "email": a["email"], "role": role })
        }
        "update-user" => {
            let i = s.user(&a["user_id"]).ok_or("User not found.")?;
            if a["user_id"] == 1 {
                return Err("You cannot change your own role.".into());
            }
            let before = s.users[i]["role"].clone();
            s.users[i]["role"] = a["role"].clone();
            s.log("update-user", a.clone(), json!({ "role": before }));
            json!({ "user_id": a["user_id"], "changed": ["role"] })
        }
        "delete-user" => {
            let i = s.user(&a["user_id"]).ok_or("User not found.")?;
            if s.user(&a["reassign"]).is_none() || a["reassign"] == a["user_id"] {
                return Err("Choose a different, existing user to receive the content.".into());
            }
            s.users.remove(i);
            json!({ "user_id": a["user_id"], "reassign": a["reassign"], "deleted": true })
        }
        "send-password-reset" => {
            let i = s.user(&a["user_id"]).ok_or("User not found.")?;
            s.resets.push(a["user_id"].as_i64().unwrap());
            json!({ "user_id": a["user_id"], "sent": true, "email": s.users[i]["email"] })
        }
        "get-comments" => {
            let want = match a["status"].as_str().unwrap_or("approve") {
                "approve" => "approved",
                other => other,
            };
            let list: Vec<_> = s
                .comments
                .iter()
                .filter(|c| c["status"] == want)
                .map(|c| {
                    let mut c = c.clone();
                    c["author_email"] = c["email"].take();
                    c["status"] = json!(match c["status"].as_str().unwrap() {
                        "hold" => "unapproved",
                        other => other,
                    });
                    c
                })
                .collect();
            json!({ "comments": list, "total": list.len(), "returned": list.len() })
        }
        "moderate-comment" => {
            let id = &a["comment_ids"][0];
            let status = match a["action"].as_str().unwrap() {
                "approve" => "approved",
                "unapprove" => "hold",
                other => other,
            };
            let found = s.comments.iter_mut().find(|c| c["id"] == *id);
            let success = found.is_some();
            if let Some(c) = found {
                c["status"] = status.into();
            }
            json!({ "action": a["action"], "results": [{ "id": id, "success": success }], "updated": success as i32 })
        }
        "reply-to-comment" => {
            let parent = s
                .comments
                .iter()
                .find(|c| c["id"] == a["comment_id"])
                .cloned()
                .ok_or("Comment not found.")?;
            let id = s.new_id();
            s.comments.push(json!({ "id": id, "post_id": parent["post_id"], "post_title": parent["post_title"], "author": "admin", "email": "admin@example.com", "content": a["content"], "date": "2026-10-28 11:00:00", "status": "approved", "parent": parent["id"] }));
            json!({ "comment_id": id, "parent_id": parent["id"], "post_id": parent["post_id"], "status": "approved" })
        }
        "create-login-link" => {
            let link = s.login_link.clone().unwrap_or_else(|| {
                format!("{}/wp-login.php?action=cm_login_link&token=cmll_x", s.base)
            });
            json!({ "url": link, "expires_in": 60 })
        }
        "get-features" => {
            json!({ "count": s.features.len(), "features": s.features, "locked": s.locked })
        }
        "update-features" => {
            let mut undo = serde_json::Map::new();
            for (k, v) in a["features"].as_object().unwrap() {
                if s.locked.contains(k) {
                    return Err(format!("{k} can't be changed over MCP."));
                }
                undo.insert(
                    k.clone(),
                    s.features.get(k).cloned().unwrap_or(json!(false)),
                );
                s.features.insert(k.clone(), v.clone());
            }
            s.log("update-features", a.clone(), json!({ "features": undo }));
            json!({ "updated": a["features"] })
        }
        "get-settings-schema" => json!({ "summary": {}, "unplaced": [], "tabs": [
            { "key": "security", "label": "Security", "subtabs": [{ "key": "s", "label": "Protection", "fields": [
                { "name": "enable_maintenance_mode", "section": "Site", "label": "Maintenance Mode", "control": "checkbox", "write_with": "update-features", "locked": true },
            ] }] },
            { "key": "performance", "label": "Performance", "subtabs": [{ "key": "m", "label": "Media", "fields": [
                { "name": "enable_svg_support", "section": "Media", "label": "SVG Support", "description": "Upload SVG files.", "control": "checkbox", "write_with": "update-features" },
                { "name": "limit_post_revisions", "section": "Heartbeat", "label": "Limit Post Revisions", "control": "select", "enum": ["default", "disable", "1", 2], "default": "default", "hq_editable": true, "write_with": "update-settings" },
                { "name": "auto_resize_quality", "section": "Media", "label": "Image Quality (%)", "control": "number", "min": 1, "max": 100, "step": 1, "default": 82, "hq_editable": true, "write_with": "update-settings" },
                { "name": "cm_api_key", "section": "Media", "label": "Key", "control": "password", "secret": true, "hq_editable": true },
            ] }] },
        ] }),
        "get-settings" => {
            let mut out = serde_json::Map::new();
            for n in a["names"].as_array().unwrap() {
                let n = n.as_str().unwrap();
                out.insert(n.into(), s.settings.get(n).cloned().unwrap_or_default());
            }
            json!({ "settings": out, "secrets": {} })
        }
        "update-settings" => {
            let mut undo = serde_json::Map::new();
            for (k, v) in a["settings"].as_object().unwrap() {
                undo.insert(k.clone(), s.settings.get(k).cloned().unwrap_or_default());
                s.settings.insert(k.clone(), v.clone());
            }
            s.log("update-settings", a.clone(), json!({ "settings": undo }));
            json!({ "updated": a["settings"] })
        }
        "list-ai-activity" => {
            let tool = a["tool"].as_str().unwrap_or_default();
            let rows: Vec<_> = s
                .activity
                .iter()
                .filter(|r| tool.is_empty() || r["tool"] == tool)
                .take(a["per_page"].as_u64().unwrap_or(20) as usize)
                .cloned()
                .collect();
            json!({ "total": s.activity.len(), "page": 1, "per_page": 25, "rows": rows })
        }
        "undo-operation" => {
            let i = s
                .activity
                .iter()
                .position(|r| r["id"] == a["id"] && r["can_undo"] == true)
                .ok_or("Nothing to undo.")?;
            let row = s.activity[i].clone();
            for (k, v) in row["undo"]["features"].as_object().into_iter().flatten() {
                s.features.insert(k.clone(), v.clone());
            }
            for (k, v) in row["undo"]["settings"].as_object().into_iter().flatten() {
                s.settings.insert(k.clone(), v.clone());
            }
            s.activity[i]["status"] = "undone".into();
            s.activity[i]["can_undo"] = false.into();
            json!({ "undone": a["id"], "tool": row["tool"] })
        }
        "list-pending-approvals" => {
            let base = s.base.clone();
            let list: Vec<_> = s
                .approvals
                .iter()
                .map(|x| {
                    let mut x = x.clone();
                    x["approve_url"] =
                        format!("{base}{}", x["approve_url"].as_str().unwrap()).into();
                    x
                })
                .collect();
            json!({ "count": list.len(), "approvals": list })
        }
        _ => unreachable!("not a people tool: {name}"),
    })
}

/// Core REST `/wp/v2/users` and `/wp/v2/comments`.
fn rest_people(
    s: &mut State,
    base: &str,
    id: Option<i64>,
    method: &str,
    q: &HashMap<String, String>,
    body: &serde_json::Value,
) -> Response {
    let refuse = |code: &str, message: &str| {
        (
            StatusCode::BAD_REQUEST,
            Json(json!({ "code": code, "message": message })),
        )
            .into_response()
    };
    let rest_user = |u: &serde_json::Value| json!({ "id": u["id"], "username": u["username"], "email": u["email"], "name": u["name"], "roles": [u["role"]], "registered_date": "2026-01-02T03:04:05+00:00" });
    let rest_comment = |c: &serde_json::Value| {
        json!({
            "id": c["id"], "post": c["post_id"], "parent": c["parent"], "author_name": c["author"], "author_email": c["email"],
            "content": { "raw": c["content"], "rendered": format!("<p>{}</p>", c["content"].as_str().unwrap_or_default()) },
            "date": c["date"].as_str().unwrap_or_default().replacen(' ', "T", 1), "status": c["status"],
            "_embedded": { "up": [{ "id": c["post_id"], "title": { "rendered": c["post_title"] } }] },
        })
    };
    let with_total = |list: Vec<serde_json::Value>| {
        let mut r = Json(&list).into_response();
        r.headers_mut()
            .insert("x-wp-total", list.len().to_string().parse().unwrap());
        r
    };
    match (base, id, method) {
        ("users", None, "GET") => with_total(s.users.iter().map(rest_user).collect()),
        ("users", None, "POST") => {
            if body["password"].as_str().is_none_or(|p| p.len() < 20) {
                return refuse(
                    "rest_missing_callback_param",
                    "Missing parameter(s): password",
                );
            }
            let id = s.new_id();
            let role = body["roles"][0].as_str().unwrap_or("subscriber");
            let u = json!({ "id": id, "username": body["username"], "email": body["email"], "name": body["username"], "role": role });
            s.users.push(u.clone());
            (StatusCode::CREATED, Json(rest_user(&u))).into_response()
        }
        ("users", Some(id), m) => {
            let Some(i) = s.user(&json!(id)) else {
                return refuse("rest_user_invalid_id", "Invalid user ID.");
            };
            if m == "DELETE" {
                if q.get("force").map(String::as_str) != Some("true")
                    || q.get("reassign")
                        .and_then(|r| s.user(&json!(r.parse::<i64>().ok()?)))
                        .is_none()
                {
                    return refuse(
                        "rest_user_invalid_reassign",
                        "Invalid user ID for reassignment.",
                    );
                }
                let u = s.users.remove(i);
                return Json(json!({ "deleted": true, "previous": rest_user(&u) })).into_response();
            }
            if let Some(r) = body["roles"][0].as_str() {
                s.users[i]["role"] = r.into();
            }
            Json(rest_user(&s.users[i])).into_response()
        }
        ("comments", None, "GET") => {
            let want = q.get("status").map_or("approved", String::as_str);
            with_total(
                s.comments
                    .iter()
                    .filter(|c| c["status"] == want)
                    .map(rest_comment)
                    .collect(),
            )
        }
        ("comments", None, "POST") => {
            let id = s.new_id();
            let c = json!({ "id": id, "post_id": body["post"], "post_title": "Hello world", "author": "admin", "email": "admin@example.com", "content": body["content"], "date": "2026-10-28 11:00:00", "status": "approved", "parent": body["parent"] });
            s.comments.push(c.clone());
            (StatusCode::CREATED, Json(rest_comment(&c))).into_response()
        }
        ("comments", Some(id), m) => {
            let Some(c) = s.comments.iter_mut().find(|c| c["id"] == id) else {
                return refuse("rest_comment_invalid_id", "Invalid comment ID.");
            };
            c["status"] = match m {
                "DELETE" => json!("trash"),
                _ => body["status"].clone(),
            };
            let c = c.clone();
            Json(rest_comment(&c)).into_response()
        }
        _ => refuse("rest_no_route", "No route was found."),
    }
}
