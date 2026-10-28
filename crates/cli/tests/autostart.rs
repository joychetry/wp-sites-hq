// SPDX-License-Identifier: GPL-3.0-or-later
//! `monks status` starts a headless core when none runs; the app can stop it.

use std::process::Command;
use std::time::Duration;

use monks_core::ipc::{self, ClientError};
use serde_json::Value;

fn monks_status(home: &std::path::Path) -> std::process::Output {
    Command::new(env!("CARGO_BIN_EXE_monks"))
        .arg("status")
        .env("MONKS_HOME", home)
        .output()
        .unwrap()
}

#[tokio::test]
async fn status_starts_a_headless_core_once() {
    let home = tempfile::tempdir().unwrap();

    let first = monks_status(home.path());
    assert!(first.status.success(), "{first:?}");
    assert!(String::from_utf8_lossy(&first.stderr).contains("Started a Monks Central core"));
    assert!(String::from_utf8_lossy(&first.stdout).contains("This client is an agent"));

    let second = monks_status(home.path());
    assert!(second.status.success(), "{second:?}");
    assert!(second.stderr.is_empty(), "{second:?}");

    let status = ipc::call(home.path(), "status", Value::Null).await.unwrap();
    assert_eq!(status["headless"], true);

    // What the app does before taking over.
    ipc::call(home.path(), "core.shutdown", Value::Null)
        .await
        .unwrap();
    for _ in 0..100 {
        if matches!(
            ipc::call(home.path(), "status", Value::Null).await,
            Err(ClientError::NotRunning)
        ) {
            return;
        }
        tokio::time::sleep(Duration::from_millis(100)).await;
    }
    panic!("the headless core did not stop");
}

// Multi-thread: the core answers on the socket while this thread waits for `monks`.
#[tokio::test(flavor = "multi_thread")]
async fn run_asks_the_core_and_says_why_it_failed() {
    let home = tempfile::tempdir().unwrap();
    let _core = monks_core::Core::start(home.path(), Default::default())
        .await
        .unwrap();
    let run = |args: &[&str]| {
        Command::new(env!("CARGO_BIN_EXE_monks"))
            .arg("run")
            .args(args)
            .env("MONKS_HOME", home.path())
            .output()
            .unwrap()
    };
    let out = run(&["https://nowhere.local", "update-plugin"]);
    assert!(!out.status.success());
    assert!(String::from_utf8_lossy(&out.stderr).contains("No site called https://nowhere.local"));
    let out = run(&["x", "get-posts", "not json"]);
    assert!(
        String::from_utf8_lossy(&out.stderr).contains("aren't JSON"),
        "{out:?}"
    );
}
