//! HTTP client that trusts exactly what the OS trusts.
//!
//! reqwest's `rustls` backend verifies with `rustls-platform-verifier`, so sites
//! signed by a locally trusted CA (WordPress Studio, Local, mkcert) work with no
//! flags or environment variables.

use std::collections::HashMap;
use std::error::Error as _;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use reqwest::header::HeaderMap;
use rustls::CertificateError;
use tokio::sync::{OwnedSemaphorePermit, Semaphore};

/// At most this many requests to one site at a time (plan 5.3).
pub const PER_SITE: usize = 2;
/// At most this many requests overall.
pub const GLOBAL: usize = 8;
/// Tries for a read-only request: the first and two retries.
const TRIES: u32 = 3;
const MAX_WAIT: Duration = Duration::from_secs(10);
/// A change may download and unpack a zip on the site, and is never sent
/// twice, so it gets far longer to answer than a read.
const WRITE_WAIT: Duration = Duration::from_secs(300);

/// The client for sites: it carries tokens, app passwords and sign-in codes, so it
/// follows a redirect only on the same host (http may move to https). reqwest drops
/// `Authorization` on another host but not `X-CM-Authorization`, and a 307 replays a
/// token request's body. Requests with no credentials use [`probe`].
pub fn client() -> reqwest::Result<reqwest::Client> {
    reqwest::Client::builder()
        .user_agent(concat!("MonksCentral/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(30))
        .redirect(reqwest::redirect::Policy::custom(|a| {
            let (to, from) = (a.url(), &a.previous()[0]);
            if a.previous().len() > 10 {
                a.error("too many redirects")
            } else if to.host_str() == from.host_str()
                && (to.origin() == from.origin() || to.scheme() == "https")
            {
                a.follow()
            } else {
                a.stop()
            }
        }))
        .build()
}

/// For monitoring: a visitor's request, which also hands back the certificate.
pub fn probe() -> reqwest::Result<reqwest::Client> {
    reqwest::Client::builder()
        .user_agent(concat!(
            "MonksCentral/",
            env!("CARGO_PKG_VERSION"),
            " (uptime)"
        ))
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(20))
        .tls_info(true)
        .build()
}

/// A request failure in plain words. The cause stays in `source`.
#[derive(Debug, thiserror::Error)]
#[error("{message}")]
pub struct NetError {
    pub message: &'static str,
    #[source]
    pub source: reqwest::Error,
}

impl NetError {
    /// The request never reached the site, so the site can't have acted on it.
    pub fn never_sent(&self) -> bool {
        self.source.is_connect() && rustls_error(&self.source).is_none()
    }
}

/// Per-site and global request limits. Waiting callers queue in turn.
pub struct Limits {
    global: Arc<Semaphore>,
    per_site: Mutex<HashMap<String, Arc<Semaphore>>>,
    site_max: usize,
}

impl Default for Limits {
    fn default() -> Self {
        Self::new(PER_SITE, GLOBAL)
    }
}

impl Limits {
    pub fn new(per_site: usize, global: usize) -> Self {
        Self {
            global: Arc::new(Semaphore::new(global)),
            per_site: Mutex::new(HashMap::new()),
            site_max: per_site,
        }
    }

    /// Site first, then global: a site at its limit never holds a global slot.
    pub async fn acquire(&self, site: &str) -> (OwnedSemaphorePermit, OwnedSemaphorePermit) {
        let sem = self
            .per_site
            .lock()
            .unwrap()
            .entry(site.to_string())
            .or_insert_with(|| Arc::new(Semaphore::new(self.site_max)))
            .clone();
        let site = sem.acquire_owned().await.expect("never closed");
        let global = self
            .global
            .clone()
            .acquire_owned()
            .await
            .expect("never closed");
        (site, global)
    }
}

/// Whether a request may be sent again after a failure (plan 5.3). Every MCP
/// call is a POST, so the caller says what it is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Retry {
    /// Reads: retried on timeouts, dropped connections, 429 and 5xx.
    ReadOnly,
    /// Writes: retried only when the request never left the machine.
    Write,
}

/// An answer with its body already read, so the limit covers the whole exchange.
#[derive(Debug)]
pub struct Reply {
    pub status: u16,
    pub headers: HeaderMap,
    pub body: Vec<u8>,
}

impl Reply {
    pub fn json<T: serde::de::DeserializeOwned>(&self) -> Option<T> {
        serde_json::from_slice(&self.body).ok()
    }
}

/// Send under the site's limits, retrying as `retry` allows.
pub async fn send(
    limits: &Limits,
    site: &str,
    retry: Retry,
    build: impl Fn() -> reqwest::RequestBuilder,
) -> Result<Reply, NetError> {
    let mut attempt = 1;
    loop {
        let outcome = {
            let _permits = limits.acquire(site).await;
            match with_wait(build(), retry).send().await {
                Ok(resp) => {
                    let status = resp.status().as_u16();
                    let headers = resp.headers().clone();
                    resp.bytes().await.map(|body| Reply {
                        status,
                        headers,
                        body: body.to_vec(),
                    })
                }
                Err(e) => Err(e),
            }
        };
        let wait = match &outcome {
            Ok(reply) if should_retry_status(retry, reply.status) => retry_after(&reply.headers),
            Err(e) if should_retry_error(retry, e) => None,
            _ => return outcome.map_err(NetError::from),
        };
        if attempt >= TRIES {
            return outcome.map_err(NetError::from);
        }
        tokio::time::sleep(wait.unwrap_or(Duration::from_millis(300 * u64::from(attempt)))).await;
        attempt += 1;
    }
}

fn with_wait(req: reqwest::RequestBuilder, retry: Retry) -> reqwest::RequestBuilder {
    match retry {
        Retry::ReadOnly => req,
        Retry::Write => req.timeout(WRITE_WAIT),
    }
}

fn should_retry_status(retry: Retry, status: u16) -> bool {
    retry == Retry::ReadOnly && matches!(status, 429 | 500 | 502 | 503 | 504)
}

fn should_retry_error(retry: Retry, err: &reqwest::Error) -> bool {
    let never_sent = err.is_connect() && rustls_error(err).is_none();
    match retry {
        Retry::ReadOnly => never_sent || err.is_timeout() || err.is_request(),
        Retry::Write => never_sent,
    }
}

fn retry_after(headers: &HeaderMap) -> Option<Duration> {
    let secs: u64 = headers
        .get(reqwest::header::RETRY_AFTER)?
        .to_str()
        .ok()?
        .trim()
        .parse()
        .ok()?;
    Some(Duration::from_secs(secs).min(MAX_WAIT))
}

/// A refusal in plain words: rate limits, firewalls, sign-in. None for others.
pub fn explain_status(reply: &Reply) -> Option<&'static str> {
    let html = reply
        .headers
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|v| v.to_str().ok())
        .is_some_and(|v| v.contains("text/html"));
    match reply.status {
        429 => Some(
            "The site is limiting requests right now. Monks Central slowed down; try again in a minute.",
        ),
        403 | 503 if html => Some(
            "A firewall or security check in front of the site blocked the request. Allow Monks Central in it, or try again later.",
        ),
        500..=599 => Some("The site had an error answering. Try again in a minute."),
        _ => None,
    }
}

impl From<reqwest::Error> for NetError {
    fn from(source: reqwest::Error) -> Self {
        Self {
            message: explain(&source),
            source,
        }
    }
}

/// GET `url` and return the HTTP status.
pub async fn get_status(client: &reqwest::Client, url: &str) -> Result<u16, NetError> {
    Ok(client.get(url).send().await?.status().as_u16())
}

fn explain(err: &reqwest::Error) -> &'static str {
    if let Some(tls) = rustls_error(err) {
        return match tls {
            rustls::Error::InvalidCertificate(
                CertificateError::Expired | CertificateError::ExpiredContext { .. },
            ) => "This site's certificate has expired.",
            rustls::Error::InvalidCertificate(
                CertificateError::NotValidForName | CertificateError::NotValidForNameContext { .. },
            ) => "This site's certificate is for a different address.",
            rustls::Error::InvalidCertificate(_) => {
                "This site's certificate isn't trusted by your computer. For a local site (Studio, Local, mkcert), add its certificate authority to your system's trusted certificates."
            }
            _ => "Couldn't make a secure connection to this site.",
        };
    }
    if err.is_timeout() {
        "The site took too long to answer."
    } else if err.is_connect() {
        "Couldn't reach this site. Check the address and that the site is running."
    } else if err.is_builder() {
        "That address isn't a valid web address."
    } else {
        "The request to this site failed."
    }
}

/// Walk the error chain to the rustls error, if there is one.
fn rustls_error(err: &reqwest::Error) -> Option<&rustls::Error> {
    let mut cur: Option<&(dyn std::error::Error + 'static)> = err.source();
    while let Some(e) = cur {
        if let Some(tls) = e.downcast_ref::<rustls::Error>() {
            return Some(tls);
        }
        // io::Error::source() skips the wrapped error, so step into it directly.
        cur = match e.downcast_ref::<std::io::Error>() {
            Some(io) => io
                .get_ref()
                .map(|inner| inner as &(dyn std::error::Error + 'static)),
            None => e.source(),
        };
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Arc;
    use tokio::io::AsyncWriteExt;
    use tokio::net::TcpListener;
    use tokio_rustls::TlsAcceptor;
    use tokio_rustls::rustls::ServerConfig;
    use tokio_rustls::rustls::pki_types::{PrivateKeyDer, PrivatePkcs8KeyDer};

    #[test]
    fn a_change_waits_longer_than_a_read() {
        let http = client().unwrap();
        let wait = |retry| {
            with_wait(http.post("https://example.test/"), retry)
                .build()
                .unwrap()
                .timeout()
                .copied()
        };
        assert_eq!(wait(Retry::Write), Some(WRITE_WAIT));
        assert_eq!(wait(Retry::ReadOnly), None, "reads keep the client's 30 s");
    }

    #[tokio::test]
    async fn self_signed_site_is_not_trusted_in_plain_words() {
        let ck = rcgen::generate_simple_self_signed(vec!["localhost".to_string()]).unwrap();
        let key = PrivateKeyDer::Pkcs8(PrivatePkcs8KeyDer::from(ck.signing_key.serialize_der()));
        let provider = Arc::new(rustls::crypto::aws_lc_rs::default_provider());
        let config = ServerConfig::builder_with_provider(provider)
            .with_safe_default_protocol_versions()
            .unwrap()
            .with_no_client_auth()
            .with_single_cert(vec![ck.cert.der().clone()], key)
            .unwrap();
        let acceptor = TlsAcceptor::from(Arc::new(config));
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        tokio::spawn(async move {
            let (tcp, _) = listener.accept().await.unwrap();
            if let Ok(mut tls) = acceptor.accept(tcp).await {
                let _ = tls.write_all(b"HTTP/1.1 200 OK\r\n\r\n").await;
            }
        });

        let err = get_status(&client().unwrap(), &format!("https://localhost:{port}/"))
            .await
            .unwrap_err();
        assert!(
            err.message
                .starts_with("This site's certificate isn't trusted"),
            "{err} / {:?}",
            err.source
        );
    }

    /// A local server that answers `status` and records how many requests ran at once.
    async fn server(
        status: u16,
        delay: Duration,
    ) -> (
        String,
        Arc<std::sync::atomic::AtomicUsize>,
        Arc<std::sync::atomic::AtomicUsize>,
    ) {
        use std::sync::atomic::{AtomicUsize, Ordering};
        let (now, peak, total) = (
            Arc::new(AtomicUsize::new(0)),
            Arc::new(AtomicUsize::new(0)),
            Arc::new(AtomicUsize::new(0)),
        );
        let (p, t) = (peak.clone(), total.clone());
        let app = axum::Router::new().fallback(move || {
            let (now, peak, total) = (now.clone(), peak.clone(), total.clone());
            async move {
                total.fetch_add(1, Ordering::SeqCst);
                let n = now.fetch_add(1, Ordering::SeqCst) + 1;
                peak.fetch_max(n, Ordering::SeqCst);
                tokio::time::sleep(delay).await;
                now.fetch_sub(1, Ordering::SeqCst);
                (axum::http::StatusCode::from_u16(status).unwrap(), "x")
            }
        });
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}/", listener.local_addr().unwrap());
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        (url, p, t)
    }

    #[tokio::test]
    async fn two_per_site_and_eight_overall() {
        use std::sync::atomic::Ordering;
        let (url, peak, _) = server(200, Duration::from_millis(50)).await;
        let limits = Arc::new(Limits::default());
        let http = client().unwrap();
        let one_site: Vec<_> = (0..10)
            .map(|_| {
                let (l, h, u) = (limits.clone(), http.clone(), url.clone());
                tokio::spawn(async move { send(&l, "a", Retry::ReadOnly, || h.get(&u)).await })
            })
            .collect();
        for t in one_site {
            assert_eq!(t.await.unwrap().unwrap().status, 200);
        }
        assert_eq!(peak.load(Ordering::SeqCst), PER_SITE);

        peak.store(0, Ordering::SeqCst);
        let many: Vec<_> = (0..40)
            .map(|i| {
                let (l, h, u) = (limits.clone(), http.clone(), url.clone());
                tokio::spawn(async move {
                    send(&l, &format!("site{}", i % 20), Retry::ReadOnly, || {
                        h.get(&u)
                    })
                    .await
                })
            })
            .collect();
        for t in many {
            t.await.unwrap().unwrap();
        }
        assert_eq!(peak.load(Ordering::SeqCst), GLOBAL);
    }

    #[tokio::test]
    async fn only_reads_are_retried() {
        use std::sync::atomic::Ordering;
        let (url, _, total) = server(503, Duration::ZERO).await;
        let limits = Limits::default();
        let http = client().unwrap();

        let reply = send(&limits, "a", Retry::Write, || http.post(&url))
            .await
            .unwrap();
        assert_eq!((reply.status, total.load(Ordering::SeqCst)), (503, 1));

        total.store(0, Ordering::SeqCst);
        let reply = send(&limits, "a", Retry::ReadOnly, || http.post(&url))
            .await
            .unwrap();
        assert_eq!(
            (reply.status, total.load(Ordering::SeqCst)),
            (503, TRIES as usize)
        );
        assert!(explain_status(&reply).unwrap().contains("had an error"));
    }

    #[tokio::test]
    async fn redirects_to_another_host_are_not_followed() {
        use axum::{Router, http::HeaderMap, response::Redirect, routing::get};
        use std::future::IntoFuture;
        use std::sync::atomic::{AtomicUsize, Ordering};
        let other = TcpListener::bind("127.0.0.1:0").await.unwrap();
        // Another host: localhost is not 127.0.0.1 to the redirect policy.
        let away = format!("http://localhost:{}/", other.local_addr().unwrap().port());
        let seen = Arc::new(AtomicUsize::new(0));
        let s = seen.clone();
        tokio::spawn(
            axum::serve(
                other,
                Router::new().route(
                    "/",
                    get(move |h: HeaderMap| async move {
                        if h.contains_key("x-cm-authorization") {
                            s.fetch_add(1, Ordering::SeqCst);
                        }
                        "away"
                    }),
                ),
            )
            .into_future(),
        );
        let site = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let base = format!("http://{}", site.local_addr().unwrap());
        tokio::spawn(
            axum::serve(
                site,
                Router::new()
                    .route(
                        "/away",
                        get(move || async move { Redirect::temporary(&away) }),
                    )
                    .route("/here", get(|| async { Redirect::temporary("/ok") }))
                    .route("/ok", get(|| async { "ok" })),
            )
            .into_future(),
        );
        let http = client().unwrap();
        let get = |path: &str| {
            http.get(format!("{base}{path}"))
                .header("X-CM-Authorization", "Bearer secret")
                .send()
        };
        assert_eq!(get("/here").await.unwrap().text().await.unwrap(), "ok");
        assert_eq!(get("/away").await.unwrap().status(), 307);
        assert_eq!(seen.load(Ordering::SeqCst), 0);
    }

    /// A port that refuses connections. Bound but never listening, so it stays ours and no
    /// other test can take it while the socket lives (a dropped listener could be reused).
    fn closed_port() -> (tokio::net::TcpSocket, u16) {
        let socket = tokio::net::TcpSocket::new_v4().unwrap();
        socket.bind("127.0.0.1:0".parse().unwrap()).unwrap();
        let port = socket.local_addr().unwrap().port();
        (socket, port)
    }

    #[tokio::test]
    async fn a_write_that_never_left_is_marked_so() {
        let (_socket, port) = closed_port();
        let http = client().unwrap();
        let err = send(&Limits::default(), "a", Retry::Write, || {
            http.post(format!("http://127.0.0.1:{port}/"))
        })
        .await
        .unwrap_err();
        assert!(err.never_sent());
    }

    #[test]
    fn rate_limits_and_firewalls_in_plain_words() {
        let reply = |status, ct: &str| {
            let mut headers = HeaderMap::new();
            headers.insert(reqwest::header::CONTENT_TYPE, ct.parse().unwrap());
            Reply {
                status,
                headers,
                body: Vec::new(),
            }
        };
        assert!(
            explain_status(&reply(429, "text/plain"))
                .unwrap()
                .contains("limiting")
        );
        assert!(
            explain_status(&reply(403, "text/html"))
                .unwrap()
                .contains("firewall")
        );
        assert!(explain_status(&reply(403, "application/json")).is_none());
        assert!(explain_status(&reply(200, "text/html")).is_none());
    }

    #[tokio::test]
    async fn closed_port_says_could_not_reach() {
        let (_socket, port) = closed_port();
        let err = get_status(&client().unwrap(), &format!("http://127.0.0.1:{port}/"))
            .await
            .unwrap_err();
        assert!(err.message.starts_with("Couldn't reach this site"), "{err}");
    }
}
