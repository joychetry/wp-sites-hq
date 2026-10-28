//! Local socket for the CLI and `monks mcp`: a Unix socket in a 0700 folder, or
//! an owner-only Windows named pipe. One JSON object per line.
//!
//! Every socket client is an agent (plan D6). The app window is the only
//! operator, and it talks to the core through Tauri commands, never this socket.

use std::io;
use std::path::Path;
use std::sync::Weak;

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncRead, AsyncReadExt, AsyncWrite, AsyncWriteExt, BufReader};

/// Longest request line accepted from a client.
pub const MAX_LINE: usize = 1024 * 1024;

/// Methods the socket answers. There is no confirm method, and there must never
/// be one: only a human in the app window confirms a plan.
pub const SOCKET_METHODS: &[&str] = &[
    "status",
    "sites.list",
    "site.describe",
    "site.run",
    "plan.create",
    "plan.get",
    "core.shutdown",
];

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
pub fn status(core: &crate::Core, role: Role) -> Value {
    json!({
        "version": crate::VERSION,
        "pid": std::process::id(),
        "role": role,
        "headless": core.headless,
    })
}

async fn dispatch_socket(core: &crate::Core, req: &Request) -> Result<Value, RpcError> {
    match req.method.as_str() {
        "status" => Ok(status(core, Role::Agent)),
        // Agents may read (plan 5.6). Sites hold no secrets.
        "sites.list" => core
            .sites()
            .map(|s| json!(s))
            .map_err(|e| RpcError::new("store", e.to_string())),
        "site.describe" => {
            let Some(site) = req.params["site"].as_str() else {
                return Err(RpcError::new(
                    "invalid_request",
                    "site.describe needs a site.",
                ));
            };
            core.find_site(site).map(|s| json!(s)).map_err(agent_error)
        }
        // Changes an agent wants on many sites. They wait for a person in the app.
        "plan.create" => {
            #[derive(Deserialize)]
            struct Wanted {
                site: String,
                action: crate::fleet::Action,
            }
            let p = &req.params;
            let wanted: Vec<Wanted> =
                serde_json::from_value(p["changes"].clone()).map_err(|e| {
                    RpcError::new("invalid_request", format!("The changes don't read: {e}"))
                })?;
            // Before any site lookups, so a huge request costs nothing.
            if wanted.len() > crate::fleet::PLAN_MAX {
                return Err(RpcError::new(
                    "invalid_request",
                    format!(
                        "A plan can hold at most {} changes. Split it into smaller plans.",
                        crate::fleet::PLAN_MAX
                    ),
                ));
            }
            let mut changes = Vec::with_capacity(wanted.len());
            for w in wanted {
                let site = core.find_site(&w.site).map_err(agent_error)?;
                changes.push(crate::fleet::Change {
                    site_id: site.id,
                    action: w.action,
                });
            }
            let title = p["title"].as_str().unwrap_or_default();
            core.propose_plan(title, changes)
                .map(|j| json!(j))
                .map_err(agent_error)
        }
        "plan.get" => {
            let Some(id) = req.params["id"].as_i64() else {
                return Err(RpcError::new(
                    "invalid_request",
                    "plan.get needs the plan's id.",
                ));
            };
            core.job(id).map(|j| json!(j)).map_err(agent_error)
        }
        // One tool on one site: reads with the app's grant, changes with the
        // agents' own, which the site's approvals guard (plan 5.6).
        "site.run" => {
            let p = &req.params;
            let (Some(site), Some(tool)) = (p["site"].as_str(), p["tool"].as_str()) else {
                return Err(RpcError::new(
                    "invalid_request",
                    "site.run needs a site and a tool.",
                ));
            };
            let args = p.get("arguments").cloned().unwrap_or_else(|| json!({}));
            core.agent_call(site, tool, args).await.map_err(agent_error)
        }
        // Stopping is not a privilege (the same user can end the process), but
        // only a headless core stops: the app window stays until its user closes it.
        "core.shutdown" if core.headless => {
            core.request_shutdown();
            Ok(json!({ "stopping": true }))
        }
        "core.shutdown" => Err(RpcError::new(
            "app_open",
            "The Monks Central app is already open. Use it, or close it first.",
        )),
        m => Err(RpcError::new(
            "method_not_found",
            format!("Unknown method `{m}`."),
        )),
    }
}

/// A site error for an agent, with a code it can act on.
fn agent_error(e: crate::connect::SiteError) -> RpcError {
    use crate::connect::SiteError;
    let code = match &e {
        SiteError::NeedsApproval { .. } => "approval_required",
        SiteError::Plain(m) if m == crate::fleet::NO_AGENT_ACCESS => "no_agent_access",
        _ => "site",
    };
    RpcError::new(code, e.to_string())
}

async fn serve_conn<S: AsyncRead + AsyncWrite>(
    stream: S,
    core: Weak<crate::Core>,
) -> io::Result<()> {
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
            let Some(core) = core.upgrade() else {
                return Ok(());
            };
            match serde_json::from_slice::<Request>(&line) {
                Ok(req) => match dispatch_socket(&core, &req).await {
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
pub async fn bind(home: &Path, core: Weak<crate::Core>) -> io::Result<tokio::task::JoinHandle<()>> {
    sys::bind(home, core).await
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

    pub async fn bind(
        home: &Path,
        core: Weak<crate::Core>,
    ) -> io::Result<tokio::task::JoinHandle<()>> {
        let path = socket_path(home);
        crate::paths::ensure_private_dir(path.parent().expect("socket has a parent"))?;
        // The caller holds the core lock, so a socket file here is stale.
        match std::fs::remove_file(&path) {
            Err(e) if e.kind() != io::ErrorKind::NotFound => return Err(e),
            _ => {}
        }
        let listener = UnixListener::bind(&path)?;
        Ok(tokio::spawn(async move {
            loop {
                match listener.accept().await {
                    Ok((stream, _)) => {
                        tokio::spawn(serve_conn(stream, core.clone()));
                    }
                    // Out of file handles, say: wait and keep serving, never stop for good.
                    Err(_) => tokio::time::sleep(std::time::Duration::from_millis(100)).await,
                }
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

    pub async fn bind(
        home: &Path,
        core: Weak<crate::Core>,
    ) -> io::Result<tokio::task::JoinHandle<()>> {
        let name = pipe_name(home);
        let sa = owner_only()?;
        // first_pipe_instance: fail if anyone else already owns this name.
        let mut server = create(&name, &sa, true)?;
        Ok(tokio::spawn(async move {
            loop {
                let connected = server.connect().await.is_ok();
                // Make the next instance before releasing this one, so the name
                // always has a live instance and can't be taken over.
                let next = loop {
                    match create(&name, &sa, false) {
                        Ok(next) => break next,
                        // Out of handles, say: wait and keep serving, never stop for good.
                        Err(_) => tokio::time::sleep(std::time::Duration::from_millis(100)).await,
                    }
                };
                let done = std::mem::replace(&mut server, next);
                if connected {
                    tokio::spawn(serve_conn(done, core.clone()));
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

    #[tokio::test]
    async fn socket_dispatch_is_always_agent() {
        let home = tempfile::tempdir().unwrap();
        let core = crate::Core::start(home.path(), Default::default())
            .await
            .unwrap();
        let req = Request {
            id: json!(1),
            method: "status".into(),
            params: json!({ "role": "operator" }),
        };
        assert_eq!(dispatch_socket(&core, &req).await.unwrap()["role"], "agent");
        let run = Request {
            id: json!(2),
            method: "site.run".into(),
            params: json!({ "tool": "update-plugin" }),
        };
        assert_eq!(
            dispatch_socket(&core, &run).await.unwrap_err().code,
            "invalid_request"
        );
    }

    #[tokio::test]
    async fn agents_read_a_site_but_a_change_is_refused_without_agent_access() {
        let home = tempfile::tempdir().unwrap();
        let opts = crate::Options {
            keychain: Ok(keyring_core::mock::Store::new().unwrap()),
            ..Default::default()
        };
        let core = crate::Core::start(home.path(), opts).await.unwrap();
        let site = crate::testsite::TestSite::start().await;
        core.add_site_oauth(&site.url, |url| {
            let url = url.to_string();
            tokio::spawn(async move { reqwest::get(url).await });
            Ok(())
        })
        .await
        .unwrap();
        let run = |tool: &str| Request {
            id: json!(1),
            method: "site.run".into(),
            params: json!({ "site": site.url, "tool": tool, "arguments": {} }),
        };
        let read = dispatch_socket(&core, &run("get-site-snapshot"))
            .await
            .unwrap();
        assert!(read["plugins"].is_array());
        let calls = site.state().calls.len();
        let err = dispatch_socket(&core, &run("update-plugin"))
            .await
            .unwrap_err();
        assert_eq!(err.code, "no_agent_access");
        assert_eq!(site.state().calls.len(), calls);
        let err = dispatch_socket(&core, &run("nope")).await.unwrap_err();
        assert_eq!(err.code, "site");
    }

    #[tokio::test]
    async fn an_agents_plan_waits_for_a_person_and_the_socket_cannot_confirm_it() {
        use crate::activity::{Actor, Outcome};
        let home = tempfile::tempdir().unwrap();
        let opts = crate::Options {
            keychain: Ok(keyring_core::mock::Store::new().unwrap()),
            ..Default::default()
        };
        let core = crate::Core::start(home.path(), opts).await.unwrap();
        let mut sites = Vec::new();
        for _ in 0..3 {
            let site = crate::testsite::TestSite::start().await;
            core.add_site_oauth(&site.url, |url| {
                let url = url.to_string();
                tokio::spawn(async move { reqwest::get(url).await });
                Ok(())
            })
            .await
            .unwrap();
            sites.push(site);
        }
        let call = |method: &str, params: Value| Request {
            id: json!(1),
            method: method.into(),
            params,
        };
        let changes: Vec<Value> = sites
            .iter()
            .map(|s| json!({ "site": s.url, "action": { "do": "update_plugin", "plugin": "woocommerce" } }))
            .collect();
        let plan = dispatch_socket(
            &core,
            &call(
                "plan.create",
                json!({ "title": "Update WooCommerce", "changes": changes }),
            ),
        )
        .await
        .unwrap();
        let id = plan["id"].as_i64().unwrap();
        assert_eq!(plan["proposed_by"], "agent");
        assert!(plan["confirmed_at"].is_null());
        assert_eq!(plan["items"].as_array().unwrap().len(), 3);
        assert_eq!(plan["items"][0]["label"], "Update WooCommerce");
        assert_eq!(
            plan["items"][0]["action"]["plugin"],
            "woocommerce/woocommerce.php"
        );

        // Everything an agent could try to make it run.
        for method in [
            "plan.confirm",
            "job.start",
            "jobs.start",
            "plan.run",
            "confirm",
        ] {
            let err = dispatch_socket(&core, &call(method, json!({ "id": id })))
                .await
                .unwrap_err();
            assert_eq!(err.code, "method_not_found", "{method}");
        }
        let again = dispatch_socket(
            &core,
            &call(
                "plan.create",
                json!({ "title": "x", "changes": [], "confirmed": true, "id": id }),
            ),
        )
        .await
        .unwrap_err();
        assert_eq!(again.code, "site");
        // A restart keeps it waiting.
        core.close_unfinished_jobs().unwrap();
        tokio::time::sleep(std::time::Duration::from_millis(200)).await;
        let got = dispatch_socket(&core, &call("plan.get", json!({ "id": id })))
            .await
            .unwrap();
        assert!(got["finished_at"].is_null() && got["confirmed_at"].is_null());
        assert_eq!(got["items"][2]["state"], "waiting");
        for s in &sites {
            assert!(!s.state().calls.iter().any(|(t, _)| t == "update-plugin"));
        }
        assert_eq!(core.waiting_plans().unwrap().len(), 1);

        // The person in the app confirms it.
        core.confirm_plan(id).await.unwrap();
        for _ in 0..200 {
            if core.job(id).unwrap().finished_at.is_some() {
                break;
            }
            tokio::time::sleep(std::time::Duration::from_millis(20)).await;
        }
        let job = core.job(id).unwrap();
        assert!(
            job.items
                .iter()
                .all(|i| i.state == crate::fleet::ItemState::Done)
        );
        for s in &sites {
            let n = s
                .state()
                .calls
                .iter()
                .filter(|(t, _)| t == "update-plugin")
                .count();
            assert_eq!(n, 1);
        }
        assert!(core.confirm_plan(id).await.is_err());
        assert!(core.waiting_plans().unwrap().is_empty());

        let log = core.activity_log(None).unwrap();
        let by = |a: Actor| log.iter().filter(|e| e.actor == a).count();
        assert_eq!(by(Actor::AgentConfirmed), 3);
        let proposed = log.iter().find(|e| e.actor == Actor::Agent).unwrap();
        assert_eq!(proposed.outcome, Outcome::Waiting);
        assert!(proposed.detail.starts_with("3 changes on 3 sites."));
        assert!(
            log.iter()
                .any(|e| e.actor == Actor::Human && e.what.starts_with("Confirmed"))
        );
        assert!(
            log.iter()
                .all(|e| e.site_id.is_none() || !e.site_name.is_empty())
        );

        let described = dispatch_socket(
            &core,
            &call("site.describe", json!({ "site": sites[0].url })),
        )
        .await
        .unwrap();
        assert_eq!(described["agent_access"], false);
        assert!(described["capabilities"]["abilities"].is_array());
    }
}
