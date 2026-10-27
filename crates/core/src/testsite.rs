//! A fake WordPress site for tests: Classic Monks' OAuth server as the plugin
//! runs it (rotating refresh tokens, reuse revokes the grant), its MCP endpoint,
//! the home page and feed, and the core REST routes Basic mode uses.

use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex, MutexGuard};

use axum::extract::{Form, Query, State as Ax};
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::{get, post};
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
    codes: HashMap<String, String>,
    refresh_tokens: HashMap<String, bool>,
    pub access_tokens: HashSet<String>,
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
            codes: HashMap::new(),
            refresh_tokens: HashMap::new(),
            access_tokens: HashSet::new(),
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
            .with_state(state.clone());
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        Self { url, state }
    }

    pub fn state(&self) -> MutexGuard<'_, State> {
        self.state.lock().unwrap()
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

async fn register(Json(body): Json<serde_json::Value>) -> Response {
    assert_eq!(body["redirect_uris"][0], crate::oauth::REDIRECT_URI);
    (
        StatusCode::CREATED,
        Json(json!({ "client_id": "cmc_test" })),
    )
        .into_response()
}

/// Stands in for the consent page: approves at once and goes back to the app.
async fn authorize(Ax(s): Ax<Shared>, Query(q): Query<HashMap<String, String>>) -> Response {
    let mut s = s.lock().unwrap();
    assert_eq!(q["code_challenge_method"], "S256");
    assert_eq!(q["resource"], mcp_url(&s.base));
    assert_eq!(q["client_id"], "cmc_test");
    let code = crate::oauth::random_token(16);
    s.codes.insert(code.clone(), q["code_challenge"].clone());
    let mut back = reqwest::Url::parse(&q["redirect_uri"]).unwrap();
    back.query_pairs_mut()
        .append_pair("code", &code)
        .append_pair("state", &q["state"])
        .append_pair("iss", &s.base);
    let mut h = HeaderMap::new();
    h.insert(header::LOCATION, back.as_str().parse().unwrap());
    (StatusCode::FOUND, h).into_response()
}

fn issue(s: &mut State) -> Response {
    let (access, refresh) = (
        format!("cmat_{}", crate::oauth::random_token(32)),
        format!("cmrt_{}", crate::oauth::random_token(32)),
    );
    s.access_tokens.insert(access.clone());
    s.refresh_tokens.insert(refresh.clone(), false);
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
            let Some(challenge) = s.codes.remove(&f["code"]) else {
                return oauth_error(StatusCode::BAD_REQUEST, "invalid_grant", "Code used.");
            };
            let got = URL_SAFE_NO_PAD.encode(Sha256::digest(f["code_verifier"].as_bytes()));
            if got != challenge {
                return oauth_error(StatusCode::BAD_REQUEST, "invalid_grant", "PKCE failed.");
            }
            issue(&mut s)
        }
        "refresh_token" => match s.refresh_tokens.get(&f["refresh_token"]).copied() {
            Some(false) => {
                s.refresh_tokens.insert(f["refresh_token"].clone(), true);
                s.refreshes += 1;
                issue(&mut s)
            }
            Some(true) => {
                s.refresh_tokens.clear();
                s.access_tokens.clear();
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
    if s.refresh_tokens.contains_key(&f["token"]) && f["client_id"] == "cmc_test" {
        s.revoked += 1;
        s.refresh_tokens.clear();
        s.access_tokens.clear();
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
    (
        StatusCode::from_u16(s.home_status).unwrap(),
        [(header::LINK, link)],
        "<html>home</html>",
    )
        .into_response()
}

fn bearer(s: &mut State, h: &HeaderMap) -> bool {
    let mut ok = false;
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
        ok |= s.access_tokens.contains(token);
    }
    ok
}

async fn mcp(Ax(s): Ax<Shared>, h: HeaderMap, Json(req): Json<serde_json::Value>) -> Response {
    let mut s = s.lock().unwrap();
    if !bearer(&mut s, &h) {
        return (
            StatusCode::UNAUTHORIZED,
            Json(json!({ "code": "cm_mcp_unauthorized" })),
        )
            .into_response();
    }
    s.mcp_calls += 1;
    let result = match req["method"].as_str() {
        Some("tools/list") => {
            let mut tools = vec![
                json!({ "name": "get-posts", "annotations": { "readOnlyHint": true } }),
                json!({ "name": "update-post", "annotations": { "readOnlyHint": false, "destructiveHint": false } }),
            ];
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
                "connection": { "operator": s.operator, "scope": "full" },
                "pending_approvals": 0,
            });
            json!({ "content": [{ "type": "text", "text": status.to_string() }], "structuredContent": status })
        }
        Some("tools/call") if req["params"]["name"] == "get-posts" => {
            json!({ "content": [{ "type": "text", "text": "[]" }], "structuredContent": { "posts": [] } })
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
