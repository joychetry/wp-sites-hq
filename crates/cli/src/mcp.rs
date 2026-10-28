//! `monks mcp`: an MCP server on stdin and stdout for Claude, Cursor, VS Code and
//! other AI apps. A few general tools for every site, never one tool per site
//! ability (plan 5.6). Each call goes to the core over the socket, as an agent:
//! there is no tool, and no socket method, that confirms a plan.

use std::future::Future;

use monks_core::ipc::ClientError;
use serde_json::{Value, json};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

const PROTOCOLS: &[&str] = &["2025-11-25", "2025-06-18", "2025-03-26", "2024-11-05"];

const INSTRUCTIONS: &str = "Monks Central manages the person's WordPress sites. Start with sites_list. \
Reading is always allowed. A change on one site runs only where the person gave AI agents access in the \
Monks Central app, and the site asks them to approve it first: give them the approval link, and after they \
approve, call run_ability again with exactly the same arguments. For changes on many sites, use plan_changes: \
the plan waits until the person confirms it in the Monks Central app. You cannot confirm a plan yourself.";

fn tools() -> Value {
    let site = json!({ "type": "string", "description": "The site's number, address or name, from sites_list." });
    json!([
        {
            "name": "sites_list",
            "title": "List sites",
            "description": "Every site in Monks Central: its number, name, address, health, WordPress and Classic Monks versions, and whether AI agents may change it.",
            "inputSchema": { "type": "object", "properties": {}, "additionalProperties": false },
            "annotations": { "readOnlyHint": true, "openWorldHint": false },
        },
        {
            "name": "site_describe",
            "title": "Describe a site",
            "description": "One site in full, with the Classic Monks tools run_ability can use there and which of them only read.",
            "inputSchema": { "type": "object", "properties": { "site": site }, "required": ["site"], "additionalProperties": false },
            "annotations": { "readOnlyHint": true, "openWorldHint": false },
        },
        {
            "name": "run_ability",
            "title": "Run a Classic Monks tool on one site",
            "description": "Run one Classic Monks tool (from site_describe) on one site. Tools that only read run at once. A change runs only where the person gave AI agents access in the Monks Central app, and the site asks them to approve it first: you get a link to give them; after they approve, call again with exactly the same arguments.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "site": site,
                    "tool": { "type": "string", "description": "The tool's name, e.g. get-posts or update-post." },
                    "arguments": { "type": "object", "description": "The tool's arguments, as its schema on the site asks." },
                },
                "required": ["site", "tool"],
                "additionalProperties": false,
            },
            "annotations": { "readOnlyHint": false, "destructiveHint": true, "openWorldHint": false },
        },
        {
            "name": "plan_changes",
            "title": "Plan changes on many sites",
            "description": "Propose plugin, theme or WordPress changes on one or more sites, as one plan. Any connected site can be in a plan, with or without AI agent access: once confirmed, it runs as the person. Nothing changes until the person confirms the plan in the Monks Central app (AI); you cannot confirm it. Tell them it is waiting there, then follow it with plan_status.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "title": { "type": "string", "description": "What the plan does, e.g. Update WooCommerce on 3 sites." },
                    "changes": {
                        "type": "array",
                        "minItems": 1,
                        "maxItems": 200,
                        "items": {
                            "type": "object",
                            "properties": {
                                "site": site,
                                "action": {
                                    "type": "object",
                                    "description": "One change. plugin is the plugin's folder (woocommerce), file (woocommerce/woocommerce.php) or name; theme is its folder or name; source is a WordPress.org slug.",
                                    "properties": {
                                        "do": { "type": "string", "enum": [
                                            "update_plugin", "rollback_plugin", "activate_plugin", "deactivate_plugin",
                                            "delete_plugin", "auto_update_plugin", "install_plugin", "update_theme",
                                            "activate_theme", "delete_theme", "update_core", "update_translations",
                                        ] },
                                        "plugin": { "type": "string" },
                                        "theme": { "type": "string" },
                                        "version": { "type": "string", "description": "rollback_plugin: the version to go back to." },
                                        "on": { "type": "boolean", "description": "auto_update_plugin: on or off." },
                                        "source": { "type": "string", "description": "install_plugin: a WordPress.org slug." },
                                        "activate": { "type": "boolean", "description": "install_plugin: activate it too." },
                                    },
                                    "required": ["do"],
                                },
                            },
                            "required": ["site", "action"],
                        },
                    },
                },
                "required": ["title", "changes"],
                "additionalProperties": false,
            },
            "annotations": { "readOnlyHint": false, "destructiveHint": false, "openWorldHint": false },
        },
        {
            "name": "plan_status",
            "title": "Follow a plan",
            "description": "Whether a plan from plan_changes is still waiting for the person, was declined, expired (unanswered for 7 days), is running, or finished, with each change's result.",
            "inputSchema": { "type": "object", "properties": { "plan_id": { "type": "integer" } }, "required": ["plan_id"], "additionalProperties": false },
            "annotations": { "readOnlyHint": true, "openWorldHint": false },
        },
    ])
}

/// What sites_list shows of a site: enough to pick one, without the tool lists.
fn site_summary(s: &Value) -> Value {
    json!({
        "id": s["id"],
        "name": s["name"],
        "url": s["url"],
        "mode": s["mode"],
        "health": s["health"],
        "health_detail": s["health_detail"],
        "wordpress": s["wp_version"],
        "classic_monks": s["cm_version"],
        "group": s["group"],
        "tags": s["tags"],
        "agents_may_change": s["agent_access"],
        "tools": s["capabilities"]["abilities"].as_array().map_or(0, Vec::len),
    })
}

fn plan_summary(p: &Value) -> Value {
    let state = if !p["declined_at"].is_null() {
        "declined: the person turned it down, nothing changed"
    } else if p["expired"] == true {
        "expired: nobody confirmed it within 7 days, it will never run; plan it again if still needed"
    } else if p["confirmed_at"].is_null() {
        "waiting for the person to confirm it in the Monks Central app"
    } else if p["finished_at"].is_null() {
        "confirmed by the person, running"
    } else {
        "finished"
    };
    let items: Vec<Value> = p["items"]
        .as_array()
        .map(Vec::as_slice)
        .unwrap_or_default()
        .iter()
        .map(|i| {
            json!({
                "site": i["site_name"], "change": i["label"], "from": i["from_version"],
                "to": i["to_version"], "state": i["state"], "message": i["message"],
            })
        })
        .collect();
    json!({ "plan_id": p["id"], "title": p["title"], "state": state, "changes": items })
}

fn text_result(v: Value, is_error: bool) -> Value {
    let text = match &v {
        Value::String(s) => s.clone(),
        v => serde_json::to_string_pretty(v).unwrap_or_default(),
    };
    let mut r = json!({ "content": [{ "type": "text", "text": text }], "isError": is_error });
    if v.is_object() {
        r["structuredContent"] = v;
    }
    r
}

/// Run one tool. Its failures are results the model reads, not protocol errors.
async fn call_tool<F, Fut>(name: &str, args: &Value, call: &F) -> Value
where
    F: Fn(&'static str, Value) -> Fut,
    Fut: Future<Output = Result<Value, ClientError>>,
{
    let site = || args["site"].as_str().unwrap_or_default().to_string();
    let out = match name {
        "sites_list" => call("sites.list", Value::Null).await.map(|v| {
            let sites: Vec<Value> = v.as_array().into_iter().flatten().map(site_summary).collect();
            json!({ "sites": sites })
        }),
        "site_describe" => call("site.describe", json!({ "site": site() }))
            .await
            .map(|mut s| {
                let caps = s["capabilities"].take();
                let read_only = caps["read_only"].as_array().cloned().unwrap_or_default();
                let tools: Vec<Value> = caps["abilities"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .map(|t| json!({ "name": t, "read_only": read_only.contains(t) }))
                    .collect();
                let mut out = site_summary(&s);
                out["tools"] = json!(tools);
                out["php"] = s["php_version"].take();
                out["notes"] = s["notes"].take();
                out
            }),
        "run_ability" => {
            let params = json!({
                "site": site(),
                "tool": args["tool"],
                "arguments": args.get("arguments").cloned().unwrap_or_else(|| json!({})),
            });
            call("site.run", params).await
        }
        "plan_changes" => call("plan.create", args.clone()).await.map(|p| {
            let mut s = plan_summary(&p);
            s["next"] = json!("Tell the person the plan is waiting in the Monks Central app under AI. It runs only after they confirm it there. Follow it with plan_status.");
            s
        }),
        "plan_status" => call("plan.get", json!({ "id": args["plan_id"] }))
            .await
            .map(|p| plan_summary(&p)),
        other => return text_result(json!(format!("There is no tool called {other}.")), true),
    };
    match out {
        Ok(v) => text_result(v, false),
        Err(e) => text_result(json!(e.to_string()), true),
    }
}

/// Answer one JSON-RPC message; notifications get no answer.
pub async fn handle<F, Fut>(msg: &Value, call: &F) -> Option<Value>
where
    F: Fn(&'static str, Value) -> Fut,
    Fut: Future<Output = Result<Value, ClientError>>,
{
    let id = msg.get("id")?.clone();
    let p = &msg["params"];
    let result = match msg["method"].as_str().unwrap_or_default() {
        "initialize" => {
            let asked = p["protocolVersion"].as_str().unwrap_or_default();
            let version = PROTOCOLS
                .iter()
                .find(|v| **v == asked)
                .unwrap_or(&PROTOCOLS[0]);
            json!({
                "protocolVersion": version,
                "capabilities": { "tools": { "listChanged": false } },
                "serverInfo": { "name": "monks-central", "title": "Monks Central", "version": monks_core::VERSION },
                "instructions": INSTRUCTIONS,
            })
        }
        "ping" => json!({}),
        "tools/list" => json!({ "tools": tools() }),
        "tools/call" => {
            let name = p["name"].as_str().unwrap_or_default();
            let args = p.get("arguments").cloned().unwrap_or_else(|| json!({}));
            call_tool(name, &args, call).await
        }
        m => {
            return Some(json!({
                "jsonrpc": "2.0", "id": id,
                "error": { "code": -32601, "message": format!("Method not found: {m}") },
            }));
        }
    };
    Some(json!({ "jsonrpc": "2.0", "id": id, "result": result }))
}

/// Serve MCP on stdin and stdout until stdin closes.
pub async fn serve<F, Fut>(call: F) -> std::io::Result<()>
where
    F: Fn(&'static str, Value) -> Fut,
    Fut: Future<Output = Result<Value, ClientError>>,
{
    let mut lines = BufReader::new(tokio::io::stdin()).lines();
    let mut out = tokio::io::stdout();
    while let Some(line) = lines.next_line().await? {
        if line.trim().is_empty() {
            continue;
        }
        let reply = match serde_json::from_str::<Value>(&line) {
            Ok(msg) => handle(&msg, &call).await,
            Err(e) => Some(json!({
                "jsonrpc": "2.0", "id": null,
                "error": { "code": -32700, "message": format!("Parse error: {e}") },
            })),
        };
        if let Some(reply) = reply {
            let mut bytes = serde_json::to_vec(&reply)?;
            bytes.push(b'\n');
            out.write_all(&bytes).await?;
            out.flush().await?;
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    #[tokio::test]
    async fn tools_reach_the_socket_as_an_agent_and_none_confirms() {
        let seen = Mutex::new(Vec::new());
        let call = |method: &'static str, params: Value| {
            seen.lock().unwrap().push((method, params.clone()));
            async move {
                match method {
                    "sites.list" => Ok(json!([{ "id": 1, "name": "MC A", "agent_access": true,
                        "capabilities": { "abilities": ["get-posts", "update-post"] } }])),
                    "site.describe" => Ok(json!({ "id": 1, "name": "MC A",
                        "capabilities": { "abilities": ["get-posts", "update-post"], "read_only": ["get-posts"] } })),
                    "plan.create" => Ok(json!({ "id": 9, "title": "Update", "confirmed_at": null, "declined_at": null,
                        "items": [{ "site_name": "MC A", "label": "Update WooCommerce", "state": "waiting" }] })),
                    "plan.get" => Ok(json!({ "id": 9, "confirmed_at": 5, "finished_at": 6, "declined_at": null, "items": [] })),
                    _ => Err(ClientError::Rpc(monks_core::ipc::RpcError {
                        code: "approval_required".into(),
                        message: "This change needs approval. Ask the user to open https://a/x then call again.".into(),
                    })),
                }
            }
        };
        let rpc = |method: &str, params: Value| json!({ "jsonrpc": "2.0", "id": 1, "method": method, "params": params });

        let init = handle(
            &rpc("initialize", json!({ "protocolVersion": "2025-06-18" })),
            &call,
        )
        .await
        .unwrap();
        assert_eq!(init["result"]["protocolVersion"], "2025-06-18");
        let odd = handle(
            &rpc("initialize", json!({ "protocolVersion": "1999" })),
            &call,
        )
        .await
        .unwrap();
        assert_eq!(odd["result"]["protocolVersion"], PROTOCOLS[0]);
        assert!(
            handle(
                &json!({ "jsonrpc": "2.0", "method": "notifications/initialized" }),
                &call
            )
            .await
            .is_none()
        );

        let list = handle(&rpc("tools/list", json!({})), &call).await.unwrap();
        let names: Vec<&str> = list["result"]["tools"]
            .as_array()
            .unwrap()
            .iter()
            .map(|t| t["name"].as_str().unwrap())
            .collect();
        assert_eq!(
            names,
            [
                "sites_list",
                "site_describe",
                "run_ability",
                "plan_changes",
                "plan_status"
            ]
        );
        assert!(!names.iter().any(|n| n.contains("confirm")));

        let tool =
            |name: &str, args: Value| rpc("tools/call", json!({ "name": name, "arguments": args }));
        let sites = handle(&tool("sites_list", json!({})), &call).await.unwrap();
        assert_eq!(sites["result"]["structuredContent"]["sites"][0]["tools"], 2);
        assert_eq!(
            sites["result"]["structuredContent"]["sites"][0]["agents_may_change"],
            true
        );
        let d = handle(&tool("site_describe", json!({ "site": "MC A" })), &call)
            .await
            .unwrap();
        assert_eq!(
            d["result"]["structuredContent"]["tools"][1],
            json!({ "name": "update-post", "read_only": false })
        );
        let run = handle(
            &tool(
                "run_ability",
                json!({ "site": "MC A", "tool": "update-post", "arguments": { "id": 3 } }),
            ),
            &call,
        )
        .await
        .unwrap();
        assert_eq!(run["result"]["isError"], true);
        assert!(
            run["result"]["content"][0]["text"]
                .as_str()
                .unwrap()
                .contains("https://a/x")
        );
        let plan = handle(
            &tool("plan_changes", json!({ "title": "Update", "changes": [] })),
            &call,
        )
        .await
        .unwrap();
        assert!(
            plan["result"]["structuredContent"]["state"]
                .as_str()
                .unwrap()
                .starts_with("waiting")
        );
        let status = handle(&tool("plan_status", json!({ "plan_id": 9 })), &call)
            .await
            .unwrap();
        assert_eq!(status["result"]["structuredContent"]["state"], "finished");
        let none = handle(&tool("confirm_plan", json!({ "plan_id": 9 })), &call)
            .await
            .unwrap();
        assert_eq!(none["result"]["isError"], true);
        let bad = handle(&rpc("plans/confirm", json!({})), &call)
            .await
            .unwrap();
        assert_eq!(bad["error"]["code"], -32601);

        let methods: Vec<&str> = seen.lock().unwrap().iter().map(|(m, _)| *m).collect();
        assert_eq!(
            methods,
            [
                "sites.list",
                "site.describe",
                "site.run",
                "plan.create",
                "plan.get"
            ]
        );
        assert_eq!(seen.lock().unwrap()[2].1["arguments"]["id"], 3);
    }

    #[test]
    fn an_expired_plan_says_it_never_runs() {
        let p = json!({ "expired": true, "confirmed_at": null, "declined_at": null, "items": [] });
        assert!(
            plan_summary(&p)["state"]
                .as_str()
                .unwrap()
                .starts_with("expired")
        );
    }
}
