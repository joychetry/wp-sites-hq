//! A fake Classic Monks site for tests: the OAuth server as the plugin runs it
//! (rotating refresh tokens, reuse revokes the grant).

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

#[derive(Default)]
pub struct State {
    pub base: String,
    pub refreshes: usize,
    pub revoked: usize,
    pub refresh: Refresh,
    pub mcp_off: bool,
    codes: HashMap<String, String>,
    refresh_tokens: HashMap<String, bool>,
    access_tokens: HashSet<String>,
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
