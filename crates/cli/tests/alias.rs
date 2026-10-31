// SPDX-License-Identifier: GPL-3.0-or-later
//! Installers ship the command twice: `wpshq`, and `monks` (its old name) until 1.0.

use std::process::Command;

#[test]
fn monks_works_and_says_its_new_name_except_for_mcp() {
    let dir = tempfile::tempdir().unwrap();
    let monks = dir
        .path()
        .join(format!("monks{}", std::env::consts::EXE_SUFFIX));
    std::fs::copy(env!("CARGO_BIN_EXE_wpshq"), &monks).unwrap();

    let old = Command::new(&monks).arg("--version").output().unwrap();
    assert!(old.status.success(), "{old:?}");
    assert!(String::from_utf8_lossy(&old.stdout).starts_with("wpshq "));
    assert!(String::from_utf8_lossy(&old.stderr).contains("`monks` is now `wpshq`"));

    let new = Command::new(env!("CARGO_BIN_EXE_wpshq"))
        .arg("--version")
        .output()
        .unwrap();
    assert!(new.stderr.is_empty(), "{new:?}");

    // mcp with an empty stdin ends at once; its stderr must stay clean.
    let mcp = Command::new(&monks)
        .arg("mcp")
        .env("MONKS_HOME", dir.path())
        .output()
        .unwrap();
    assert!(
        !String::from_utf8_lossy(&mcp.stderr).contains("is now"),
        "{mcp:?}"
    );
}
