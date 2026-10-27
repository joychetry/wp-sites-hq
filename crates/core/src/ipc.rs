//! Local socket for the CLI and `monks mcp`: a Unix socket in a 0700 folder, or
//! an owner-only Windows named pipe. One JSON object per line.
//!
//! Every socket client is an agent (plan D6). The app window is the only
//! operator, and it talks to the core through Tauri commands, never this socket.

use std::io;
use std::path::Path;

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt, BufReader};

/// Longest request line accepted from a client.
pub const MAX_LINE: usize = 1024 * 1024;

/// Methods the socket answers. There is no confirm method, and there must never
/// be one: only a human in the app window confirms a plan.
pub const SOCKET_METHODS: &[&str] = &["status"];

#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum Role {
    /// The human in the app window.
    Operator,
    /// Anything that came in over the socket: the CLI, `monks mcp`, scripts.
    Agent,
}

#[derive(Debug, Deserialize)]
pub struct Request {
    #[serde(default)]
    pub id: Value,
    pub method: String,
    #[serde(default)]
    pub params: Value,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct Response {
    pub id: Value,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub result: Option<Value>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub error: Option<RpcError>,
}

#[derive(Debug, Clone, Serialize, Deserialize, thiserror::Error)]
#[error("{message}")]
pub struct RpcError {
    pub code: String,
    pub message: String,
}

impl RpcError {
    fn new(code: &str, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
        }
    }
}

/// What `status` answers, for either role.
pub fn status(role: Role) -> Value {
    json!({ "version": crate::VERSION, "pid": std::process::id(), "role": role })
}

fn dispatch_socket(req: &Request) -> Result<Value, RpcError> {
    match req.method.as_str() {
        "status" => Ok(status(Role::Agent)),
        m => Err(RpcError::new(
            "method_not_found",
            format!("Unknown method `{m}`."),
        )),
    }
}

async fn serve_conn<S: AsyncRead + AsyncWrite>(stream: S) -> io::Result<()> {
    let (r, mut w) = tokio::io::split(stream);
    let mut r = BufReader::new(r);
    let mut line = Vec::new();
    loop {
        line.clear();
        let n = (&mut r)
            .take(MAX_LINE as u64 + 1)
            .read_until(b'\n', &mut line)
            .await?;
        if n == 0 {
            return Ok(());
        }
        let too_long = n > MAX_LINE && !line.ends_with(b"\n");
        let resp = if too_long {
            Response {
                id: Value::Null,
                result: None,
                error: Some(RpcError::new("too_large", "Request is too large.")),
            }
        } else {
            match serde_json::from_slice::<Request>(&line) {
                Ok(req) => match dispatch_socket(&req) {
                    Ok(result) => Response {
                        id: req.id,
                        result: Some(result),
                        error: None,
                    },
                    Err(e) => Response {
                        id: req.id,
                        result: None,
                        error: Some(e),
                    },
                },
                Err(e) => Response {
                    id: Value::Null,
                    result: None,
                    error: Some(RpcError::new("invalid_request", e.to_string())),
                },
            }
        };
        let mut out = serde_json::to_vec(&resp)?;
        out.push(b'\n');
        w.write_all(&out).await?;
        if too_long {
            return Ok(());
        }
    }
}

#[derive(Debug, thiserror::Error)]
pub enum ClientError {
    #[error("Monks Central isn't running. Start it with `monks core` or open the app.")]
    NotRunning,
    #[error("{0}")]
    Rpc(RpcError),
    #[error("lost the connection to Monks Central: {0}")]
    Io(#[from] io::Error),
    #[error("Monks Central sent an answer this version can't read: {0}")]
    Protocol(#[from] serde_json::Error),
}

/// Call one method on the running core.
pub async fn call(home: &Path, method: &str, params: Value) -> Result<Value, ClientError> {
    // The core names its pipe from the canonical path; no folder means no core.
    let home = home.canonicalize().map_err(not_running)?;
    let stream = sys::connect(&home).await?;
    let (r, mut w) = tokio::io::split(stream);
    let mut req = serde_json::to_vec(&json!({ "id": 1, "method": method, "params": params }))?;
    req.push(b'\n');
    w.write_all(&req).await?;
    let mut line = String::new();
    BufReader::new(r).read_line(&mut line).await?;
    let resp: Response = serde_json::from_str(&line)?;
    match (resp.result, resp.error) {
        (_, Some(e)) => Err(ClientError::Rpc(e)),
        (Some(v), None) => Ok(v),
        (None, None) => Ok(Value::Null),
    }
}

/// Bind the socket and answer clients until the task is dropped.
/// Call only while holding the core lock.
pub async fn bind(home: &Path) -> io::Result<tokio::task::JoinHandle<()>> {
    sys::bind(home).await
}

#[cfg(windows)]
pub use sys::pipe_name;

fn not_running(e: io::Error) -> ClientError {
    match e.kind() {
        io::ErrorKind::NotFound | io::ErrorKind::ConnectionRefused => ClientError::NotRunning,
        _ => ClientError::Io(e),
    }
}

#[cfg(unix)]
mod sys {
    use super::*;
    use std::path::PathBuf;
    use tokio::net::{UnixListener, UnixStream};

    pub fn socket_path(home: &Path) -> PathBuf {
        home.join("run").join("core.sock")
    }

    pub async fn bind(home: &Path) -> io::Result<tokio::task::JoinHandle<()>> {
        let path = socket_path(home);
        crate::paths::ensure_private_dir(path.parent().expect("socket has a parent"))?;
        // The caller holds the core lock, so a socket file here is stale.
        match std::fs::remove_file(&path) {
            Err(e) if e.kind() != io::ErrorKind::NotFound => return Err(e),
            _ => {}
        }
        let listener = UnixListener::bind(&path)?;
        Ok(tokio::spawn(async move {
            while let Ok((stream, _)) = listener.accept().await {
                tokio::spawn(serve_conn(stream));
            }
        }))
    }

    pub async fn connect(home: &Path) -> Result<UnixStream, ClientError> {
        UnixStream::connect(socket_path(home))
            .await
            .map_err(not_running)
    }
}

#[cfg(windows)]
mod sys {
    use super::*;
    use std::ffi::c_void;
    use tokio::net::windows::named_pipe::{ClientOptions, NamedPipeClient, ServerOptions};
    use windows_sys::Win32::Foundation::{CloseHandle, ERROR_PIPE_BUSY, HANDLE, LocalFree};
    use windows_sys::Win32::Security::Authorization::{
        ConvertSidToStringSidW, ConvertStringSecurityDescriptorToSecurityDescriptorW,
        SDDL_REVISION_1,
    };
    use windows_sys::Win32::Security::{
        GetTokenInformation, PSECURITY_DESCRIPTOR, SECURITY_ATTRIBUTES, TOKEN_QUERY, TOKEN_USER,
        TokenUser,
    };
    use windows_sys::Win32::System::Threading::{GetCurrentProcess, OpenProcessToken};

    /// One pipe per data folder: FNV-1a of the folder path (stable across builds).
    pub fn pipe_name(home: &Path) -> String {
        let mut h: u64 = 0xcbf2_9ce4_8422_2325;
        for b in home.to_string_lossy().bytes() {
            h = (h ^ u64::from(b)).wrapping_mul(0x0100_0000_01b3);
        }
        format!(r"\\.\pipe\monks-central-{h:016x}")
    }

    /// Security attributes that grant the pipe to the current user only (the
    /// default descriptor lets Everyone read).
    struct OwnerOnly {
        attrs: SECURITY_ATTRIBUTES,
    }

    // The descriptor is immutable after creation and only read by the OS.
    unsafe impl Send for OwnerOnly {}
    unsafe impl Sync for OwnerOnly {}

    impl Drop for OwnerOnly {
        fn drop(&mut self) {
            unsafe { LocalFree(self.attrs.lpSecurityDescriptor) };
        }
    }

    fn owner_only() -> io::Result<OwnerOnly> {
        unsafe {
            let mut token: HANDLE = std::ptr::null_mut();
            if OpenProcessToken(GetCurrentProcess(), TOKEN_QUERY, &mut token) == 0 {
                return Err(io::Error::last_os_error());
            }
            let mut len = 0u32;
            GetTokenInformation(token, TokenUser, std::ptr::null_mut(), 0, &mut len);
            let mut buf = vec![0u8; len as usize];
            let ok = GetTokenInformation(token, TokenUser, buf.as_mut_ptr().cast(), len, &mut len);
            CloseHandle(token);
            if ok == 0 {
                return Err(io::Error::last_os_error());
            }
            let user = &*(buf.as_ptr() as *const TOKEN_USER);
            let mut sid_w = std::ptr::null_mut();
            if ConvertSidToStringSidW(user.User.Sid, &mut sid_w) == 0 {
                return Err(io::Error::last_os_error());
            }
            let sid = String::from_utf16_lossy(std::slice::from_raw_parts(
                sid_w,
                (0..).take_while(|&i| *sid_w.add(i) != 0).count(),
            ));
            LocalFree(sid_w.cast());
            // Protected DACL with one entry: full access for this user's SID.
            let sddl: Vec<u16> = format!("D:P(A;;GA;;;{sid})")
                .encode_utf16()
                .chain(Some(0))
                .collect();
            let mut sd: PSECURITY_DESCRIPTOR = std::ptr::null_mut();
            if ConvertStringSecurityDescriptorToSecurityDescriptorW(
                sddl.as_ptr(),
                SDDL_REVISION_1,
                &mut sd,
                std::ptr::null_mut(),
            ) == 0
            {
                return Err(io::Error::last_os_error());
            }
            Ok(OwnerOnly {
                attrs: SECURITY_ATTRIBUTES {
                    nLength: size_of::<SECURITY_ATTRIBUTES>() as u32,
                    lpSecurityDescriptor: sd,
                    bInheritHandle: 0,
                },
            })
        }
    }

    fn create(
        name: &str,
        sa: &OwnerOnly,
        first: bool,
    ) -> io::Result<tokio::net::windows::named_pipe::NamedPipeServer> {
        let attrs = &sa.attrs as *const SECURITY_ATTRIBUTES as *mut c_void;
        unsafe {
            ServerOptions::new()
                .first_pipe_instance(first)
                .reject_remote_clients(true)
                .create_with_security_attributes_raw(name, attrs)
        }
    }

    pub async fn bind(home: &Path) -> io::Result<tokio::task::JoinHandle<()>> {
        let name = pipe_name(home);
        let sa = owner_only()?;
        // first_pipe_instance: fail if anyone else already owns this name.
        let mut server = create(&name, &sa, true)?;
        Ok(tokio::spawn(async move {
            loop {
                let connected = server.connect().await.is_ok();
                // Make the next instance before releasing this one, so the name
                // always has a live instance and can't be taken over.
                let Ok(next) = create(&name, &sa, false) else {
                    return;
                };
                let done = std::mem::replace(&mut server, next);
                if connected {
                    tokio::spawn(serve_conn(done));
                }
            }
        }))
    }

    pub async fn connect(home: &Path) -> Result<NamedPipeClient, ClientError> {
        let name = pipe_name(home);
        for _ in 0..50 {
            match ClientOptions::new().open(&name) {
                Ok(client) => return Ok(client),
                Err(e) if e.raw_os_error() == Some(ERROR_PIPE_BUSY as i32) => {
                    tokio::time::sleep(std::time::Duration::from_millis(20)).await;
                }
                Err(e) => return Err(not_running(e)),
            }
        }
        Err(ClientError::Io(io::Error::other("the core is busy")))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn socket_has_no_confirm_method() {
        assert!(!SOCKET_METHODS.iter().any(|m| m.contains("confirm")));
    }

    #[test]
    fn socket_dispatch_is_always_agent() {
        let req = Request {
            id: json!(1),
            method: "status".into(),
            params: json!({ "role": "operator" }),
        };
        assert_eq!(dispatch_socket(&req).unwrap()["role"], "agent");
    }
}
