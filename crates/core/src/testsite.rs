//! A fake WordPress site for tests: Classic Monks' OAuth server as the plugin
//! runs it (rotating refresh tokens, reuse revokes the grant), its MCP endpoint,
//! the home page and feed, and the core REST routes Basic mode uses.

use std::collections::HashMap;
use std::sync::{Arc, Mutex, MutexGuard};

use axum::extract::{Form, Query, State as Ax};
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::{delete, get, post};
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
    /// Every tool called, with its arguments.
    pub calls: Vec<(String, serde_json::Value)>,
    /// Code -> (PKCE challenge, client).
    codes: HashMap<String, (String, String)>,
    clients: u32,
    /// Grant (token family) -> the client it was given to.
    families: HashMap<u32, String>,
    /// Refresh token -> (spent, family).
    refresh_tokens: HashMap<String, (bool, u32)>,
    /// Access token -> family.
    pub access_tokens: HashMap<String, u32>,
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
            calls: Vec::new(),
            codes: HashMap::new(),
            clients: 0,
            families: HashMap::new(),
            refresh_tokens: HashMap::new(),
            access_tokens: HashMap::new(),
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
    (
        StatusCode::CREATED,
        Json(json!({ "client_id": format!("cmc_test_{}", s.clients) })),
    )
        .into_response()
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
        ok |= s.access_tokens.contains_key(token);
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
            for (name, read_only) in PLUGIN_TOOLS {
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
                "connection": { "operator": s.operator, "scope": "full" },
                "pending_approvals": 0,
            });
            json!({ "content": [{ "type": "text", "text": status.to_string() }], "structuredContent": status })
        }
        Some("tools/call") if req["params"]["name"] == "get-posts" => {
            json!({ "content": [{ "type": "text", "text": "[]" }], "structuredContent": { "posts": [] } })
        }
        Some("tools/call")
            if PLUGIN_TOOLS
                .iter()
                .any(|(n, _)| req["params"]["name"] == *n) =>
        {
            let name = req["params"]["name"].as_str().unwrap_or_default().to_string();
            let args = req["params"]["arguments"].clone();
            s.calls.push((name.clone(), args.clone()));
            let out = if s.fail_tool.as_deref() == Some(name.as_str()) {
                Err("The update could not be installed.".to_string())
            } else {
                plugin_tool(&mut s, &name, &args)
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
        "update-plugin" if p["update"].is_string() => {
            let previous = p["version"].clone();
            p["version"] = p["update"].take();
            json!({ "updated": true, "previous_version": previous, "version": p["version"], "message": "Updated." })
        }
        "update-plugin" => json!({ "updated": false, "message": "This plugin is up to date." }),
        "rollback-plugin" => {
            let from = p["version"].clone();
            p["version"] = args["version"].clone();
            p["update"] = from.clone();
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
