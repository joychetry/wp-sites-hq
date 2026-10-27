//! End-to-end: a real core on a temp data folder, clients over the socket.

use monks_core::ipc::{self, ClientError};
use monks_core::{Core, CoreError, Options, lock::LockError};
use serde_json::json;

#[tokio::test]
async fn socket_client_is_an_agent() {
    let home = tempfile::tempdir().unwrap();
    let _core = Core::start(home.path(), Default::default()).await.unwrap();
    let status = ipc::call(home.path(), "status", json!({ "role": "operator" }))
        .await
        .unwrap();
    assert_eq!(status["role"], "agent");
    assert_eq!(status["pid"], std::process::id());
    assert_eq!(status["version"], monks_core::VERSION);
}

#[tokio::test]
async fn socket_has_no_confirm() {
    let home = tempfile::tempdir().unwrap();
    let _core = Core::start(home.path(), Default::default()).await.unwrap();
    for method in ["plan.confirm", "confirm", "plans.confirm"] {
        match ipc::call(home.path(), method, json!({ "plan": 1 })).await {
            Err(ClientError::Rpc(e)) => assert_eq!(e.code, "method_not_found", "{method}"),
            other => panic!("{method}: {other:?}"),
        }
    }
}

#[tokio::test]
async fn second_core_is_refused() {
    let home = tempfile::tempdir().unwrap();
    let _core = Core::start(home.path(), Default::default()).await.unwrap();
    match Core::start(home.path(), Default::default()).await {
        Err(CoreError::Lock(LockError::AlreadyRunning { .. })) => {}
        Err(e) => panic!("{e}"),
        Ok(_) => panic!("second core started"),
    }
    // The first core still answers.
    ipc::call(home.path(), "status", json!(null)).await.unwrap();
}

#[tokio::test]
async fn no_core_means_not_running() {
    let home = tempfile::tempdir().unwrap();
    assert!(matches!(
        ipc::call(home.path(), "status", json!(null)).await,
        Err(ClientError::NotRunning)
    ));
}

#[tokio::test]
async fn bad_and_oversized_requests_are_answered_not_crashed() {
    use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
    let home = tempfile::tempdir().unwrap();
    let core = Core::start(home.path(), Default::default()).await.unwrap();

    let mut conn = raw_connect(&core.home).await;
    conn.write_all(b"not json\n").await.unwrap();
    let mut line = String::new();
    let mut reader = BufReader::new(conn);
    reader.read_line(&mut line).await.unwrap();
    assert!(line.contains("invalid_request"), "{line}");

    let mut conn = raw_connect(&core.home).await;
    let big = vec![b'x'; ipc::MAX_LINE + 10];
    conn.write_all(&big).await.unwrap();
    let mut line = String::new();
    BufReader::new(conn).read_line(&mut line).await.unwrap();
    assert!(line.contains("too_large"), "{line}");

    ipc::call(home.path(), "status", json!(null)).await.unwrap();
}

#[cfg(unix)]
#[tokio::test]
async fn unix_socket_folder_is_owner_only() {
    use std::os::unix::fs::PermissionsExt;
    let home = tempfile::tempdir().unwrap();
    let core = Core::start(home.path(), Default::default()).await.unwrap();
    let mode = std::fs::metadata(core.home.join("run"))
        .unwrap()
        .permissions()
        .mode();
    assert_eq!(mode & 0o777, 0o700);
}

#[cfg(unix)]
async fn raw_connect(home: &std::path::Path) -> tokio::net::UnixStream {
    tokio::net::UnixStream::connect(home.join("run/core.sock"))
        .await
        .unwrap()
}

#[cfg(windows)]
async fn raw_connect(home: &std::path::Path) -> tokio::net::windows::named_pipe::NamedPipeClient {
    tokio::net::windows::named_pipe::ClientOptions::new()
        .open(monks_core::ipc::pipe_name(home))
        .unwrap()
}

#[tokio::test]
async fn app_takes_over_from_a_headless_core() {
    let home = tempfile::tempdir().unwrap();
    let headless = Core::start(
        home.path(),
        Options {
            headless: true,
            ..Default::default()
        },
    )
    .await
    .unwrap();
    let status = ipc::call(home.path(), "status", json!(null)).await.unwrap();
    assert_eq!(status["headless"], true);
    // What `monks core` does when asked: finish, then let go of the lock.
    let stopped = tokio::spawn(async move {
        headless.shutdown_requested().await;
        headless.finish().await;
        drop(headless);
    });
    let app = Core::start_or_take_over(home.path(), Options::default())
        .await
        .unwrap();
    stopped.await.unwrap();
    assert!(!app.headless);
    let status = ipc::call(home.path(), "status", json!(null)).await.unwrap();
    assert_eq!(status["headless"], false);
}

#[tokio::test]
async fn an_open_app_is_never_stopped_over_the_socket() {
    let home = tempfile::tempdir().unwrap();
    let _app = Core::start(home.path(), Options::default()).await.unwrap();
    match ipc::call(home.path(), "core.shutdown", json!(null)).await {
        Err(ClientError::Rpc(e)) => assert_eq!(e.code, "app_open"),
        other => panic!("{other:?}"),
    }
    let err = Core::start_or_take_over(home.path(), Options::default())
        .await
        .err()
        .unwrap();
    assert!(err.to_string().contains("already open"), "{err}");
    ipc::call(home.path(), "status", json!(null)).await.unwrap();
}

#[tokio::test]
async fn agents_may_list_sites() {
    let home = tempfile::tempdir().unwrap();
    let _core = Core::start(home.path(), Default::default()).await.unwrap();
    let sites = ipc::call(home.path(), "sites.list", json!(null))
        .await
        .unwrap();
    assert_eq!(sites, json!([]));
}
