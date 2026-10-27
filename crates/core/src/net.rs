//! HTTP client that trusts exactly what the OS trusts.
//!
//! reqwest's `rustls` backend verifies with `rustls-platform-verifier`, so sites
//! signed by a locally trusted CA (WordPress Studio, Local, mkcert) work with no
//! flags or environment variables.

use std::error::Error as _;
use std::time::Duration;

use rustls::CertificateError;

pub fn client() -> reqwest::Result<reqwest::Client> {
    reqwest::Client::builder()
        .user_agent(concat!("MonksCentral/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(30))
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

    #[tokio::test]
    async fn closed_port_says_could_not_reach() {
        let port = TcpListener::bind("127.0.0.1:0")
            .await
            .unwrap()
            .local_addr()
            .unwrap()
            .port();
        let err = get_status(&client().unwrap(), &format!("http://127.0.0.1:{port}/"))
            .await
            .unwrap_err();
        assert!(err.message.starts_with("Couldn't reach this site"), "{err}");
    }
}
