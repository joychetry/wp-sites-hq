//! `monks mcp` speaks MCP on stdio and asks the running core, as an agent.

use std::io::{BufRead, BufReader, Write};
use std::process::{Command, Stdio};

use serde_json::{Value, json};

// Multi-thread: the core answers on the socket while this thread waits for `monks`.
#[tokio::test(flavor = "multi_thread")]
async fn an_ai_app_lists_sites_and_its_plans_reach_the_core() {
    let home = tempfile::tempdir().unwrap();
    let _core = monks_core::Core::start(home.path(), Default::default())
        .await
        .unwrap();
    let mut child = Command::new(env!("CARGO_BIN_EXE_monks"))
        .arg("mcp")
        .env("MONKS_HOME", home.path())
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    let mut stdin = child.stdin.take().unwrap();
    let mut stdout = BufReader::new(child.stdout.take().unwrap());
    let mut ask = |id: i64, method: &str, params: Value| -> Value {
        let msg = json!({ "jsonrpc": "2.0", "id": id, "method": method, "params": params });
        writeln!(stdin, "{msg}").unwrap();
        // A notification in between gets no answer.
        writeln!(
            stdin,
            r#"{{"jsonrpc":"2.0","method":"notifications/initialized"}}"#
        )
        .unwrap();
        let mut line = String::new();
        stdout.read_line(&mut line).unwrap();
        let reply: Value = serde_json::from_str(&line).unwrap();
        assert_eq!(reply["id"], id);
        reply
    };
    let init = ask(
        1,
        "initialize",
        json!({ "protocolVersion": "2025-06-18", "capabilities": {} }),
    );
    assert_eq!(init["result"]["serverInfo"]["name"], "monks-central");
    let tools = ask(2, "tools/list", json!({}));
    assert_eq!(tools["result"]["tools"].as_array().unwrap().len(), 5);
    let sites = ask(
        3,
        "tools/call",
        json!({ "name": "sites_list", "arguments": {} }),
    );
    assert_eq!(sites["result"]["structuredContent"], json!({ "sites": [] }));
    let plan = ask(
        4,
        "tools/call",
        json!({ "name": "plan_changes", "arguments": { "title": "x", "changes": [
            { "site": "nowhere", "action": { "do": "update_core" } }
        ] } }),
    );
    assert_eq!(plan["result"]["isError"], true);
    assert_eq!(
        plan["result"]["content"][0]["text"],
        "No site called nowhere in Monks Central."
    );
    drop(stdin);
    assert!(child.wait().unwrap().success());
}
