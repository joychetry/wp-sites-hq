// SPDX-License-Identifier: GPL-3.0-or-later
//! Live acceptance driver for Studio sites. Uses the same core API as the app.
//!
//!   MONKS_HOME=<data folder> cargo run -p monks-core --example acceptance -- <command>
//!
//! The data folder is the app's default (~/.local/share/com.classicmonks.monks-central)
//! for the sites that stay connected, or a throwaway folder for tests that break a
//! connection on purpose (corrupt, remove).
//!
//!   connect-oauth <url> <studio site path>   sign in as the site's admin, tick "operator"
//!   sign-in-again <url> <studio site path>
//!   connect-basic <url> <user> <password file>
//!   list | check
//!   burst <url>          expire the access token, then 20 parallel calls
//!   corrupt <url>        damage the saved secret
//!   remove <url>
//!   forget-key           delete this data folder's keychain item
//!   inventory            read every site's plugins and themes, list plugins
//!   update-plugin <plugin file> <url>...   one job: update the plugin on those sites
//!   versions <url> <plugin file>           versions the site can roll back to
//!   rollback <url> <plugin file> <version> a job that rolls the plugin back
//!   types <url>                            post types and their taxonomies (JSON)
//!   get <url> <post type> <id>             one entry with its blocks (JSON)
//!   create <url> <post type> <draft JSON>  add an entry (JSON back)
//!   edit <url> <post type> <id> <draft JSON>
//!   import <url> <image link> <alt text>   add an image to the media library
//!   users <url> [search]                   a page of users with the roles offered (JSON)
//!   add-user <url> <new user JSON>
//!   set-role <url> <user id> <role>
//!   delete-user <url> <user id> <reassign to id>
//!   reset <url> <user id>                  email a password reset (Classic Monks M7)
//!   comments <url> [pending|approved|spam|trash]
//!   moderate <url> <comment id> <approve|unapprove|spam|trash>
//!   reply <url> <comment id> <post id> <text>
//!   login-check <url>   make a login link and use it like a browser: who it signs in,
//!                       and that it works once (the link itself is never printed)
//!   agent <url> <tool>  the same tool called as an AI agent on the socket would
//!   features <url> [word]                  Classic Monks features matching a word
//!   set-feature <url> <option name> <on|off>   prints the activity row that undoes it
//!   undo <url> <activity row id>
//!   activity <url> | approvals <url> | settings <url>
//!   agent-access <url> <studio site path>  give AI agents their own connection:
//!                       the consent form with "operator" left unticked
//!   agent-access-off <url>
//!   plans | log        agents' plans waiting for a person; Monks Central's activity log
//!   confirm-plan <id> | decline-plan <id>  the person's Confirm or Decline, as the window
//!                       does; confirm waits for the job
//!   security [url]     scan one site (or all) for vulnerabilities, abandoned plugins
//!                      and changed files, and print what each scan found
//!   monitors           load every home page, look up domains, print each site's monitors
//!   pagespeed <url>    Google PageSpeed for a public site
//!   publish <title> <body file> <url>...   one job: publish the same post on those sites
//!   search <words>     posts and pages on every site
//!   client <name> <url>...                 make the client (or find it) and give it the sites
//!   report <month> <out dir> <client name> a client's monthly report as HTML and PDF
//!   cm-reports <url> | store <url>         Classic Monks' reports; the store and its products
//!   zip <url> <zip file> <plugin|theme>    stage a zip and install it (off) as a job
//!
//! These two need no core of their own, so they also run while the app is open:
//!   approve <studio site path> <approve url>   the person approves on the site's
//!                       own approve page, signed in as the site's admin
//!   socket <method> [params JSON]   call the running core's socket, as an agent does
//!
//! The browser step is played by this program: a login cookie made with
//! `studio wp` (no password is handled), then the site's real consent form,
//! submitted with every tool group, Full access and "This is my Monks Central app
//! (operator)" ticked when shown. Cookies
//! and tokens are never printed.

use std::path::Path;
use std::sync::Arc;
use std::sync::atomic::Ordering;

use monks_core::fleet::{Action, Change, Job};
use monks_core::oauth::Tokens;
use monks_core::{Core, Options, connect::SiteError, paths, vault};
use reqwest::header::{COOKIE, LOCATION};
use serde_json::json;

type Res<T> = Result<T, Box<dyn std::error::Error + Send + Sync>>;

#[tokio::main]
async fn main() -> Res<()> {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let home = paths::data_dir()?;
    if std::env::var_os("MONKS_HOME").is_none() {
        return Err("set MONKS_HOME to the data folder to use".into());
    }
    match args.first().map(String::as_str) {
        Some("approve") => return approve(&args[1], &args[2]).await,
        Some("socket") => {
            let params = match args.get(2) {
                Some(p) => serde_json::from_str(p)?,
                None => serde_json::Value::Null,
            };
            match monks_core::ipc::call(&home, &args[1], params).await {
                Ok(v) => println!("{}", serde_json::to_string_pretty(&v)?),
                Err(monks_core::ipc::ClientError::Rpc(e)) => {
                    println!("refused: {} ({})", e.message, e.code)
                }
                Err(e) => println!("failed: {e}"),
            }
            return Ok(());
        }
        _ => {}
    }
    let keychain = vault::os_keychain().map_err(|e| e.to_string());
    if args.first().map(String::as_str) == Some("forget-key") {
        paths::ensure_private_dir(&home)?;
        let account = vault::keychain_account(&home.canonicalize()?);
        let kc = keychain?;
        kc.build(vault::KEYCHAIN_SERVICE, &account, None)?
            .delete_credential()?;
        println!("deleted keychain item {account}");
        return Ok(());
    }
    let core = Core::start(
        &home,
        Options {
            headless: true,
            keychain,
            ..Default::default()
        },
    )
    .await?;
    let arg = |i: usize| args.get(i).map(String::as_str).ok_or("missing argument");
    match arg(0)? {
        "connect-oauth" => {
            let browser = browser(&core, arg(2)?)?;
            report(core.add_site_oauth(arg(1)?, browser).await)
        }
        "sign-in-again" => {
            let id = site_id(&core, arg(1)?)?;
            let browser = browser(&core, arg(2)?)?;
            report(core.sign_in_again_oauth(id, browser).await)
        }
        "connect-basic" => {
            let password = std::fs::read_to_string(arg(3)?)?;
            report(core.add_site_basic(arg(1)?, arg(2)?, password.trim()).await)
        }
        "list" => {
            list(&core)?;
            Ok(())
        }
        "check" => {
            core.check_all().await;
            list(&core)?;
            Ok(())
        }
        "burst" => {
            let id = site_id(&core, arg(1)?)?;
            expire(&core, id)?;
            let before = core.refreshes.load(Ordering::SeqCst);
            let calls: Vec<_> = (0..20)
                .map(|_| {
                    let core = core.clone();
                    tokio::spawn(
                        async move { core.call_ability(id, "get-hq-status", json!({})).await },
                    )
                })
                .collect();
            let mut ok = 0;
            for c in calls {
                match c.await? {
                    Ok(_) => ok += 1,
                    Err(e) => println!("call failed: {e}"),
                }
            }
            let n = core.refreshes.load(Ordering::SeqCst) - before;
            println!(
                "20 parallel get-hq-status calls with an expired access token: {ok} ok, {n} refresh(es) sent"
            );
            Ok(())
        }
        "corrupt" => {
            let id = site_id(&core, arg(1)?)?;
            {
                let store = core.store.lock().unwrap();
                let name = format!("site:{id}");
                let mut blob: Vec<u8> = store.conn().query_row(
                    "SELECT blob FROM credentials WHERE name = ?1",
                    [&name],
                    |r| r.get(0),
                )?;
                blob[31] ^= 0xff;
                store.conn().execute(
                    "UPDATE credentials SET blob = ?1 WHERE name = ?2",
                    rusqlite::params![blob, name],
                )?;
            }
            println!("damaged the saved secret (one byte flipped)");
            match core.call_ability(id, "get-hq-status", json!({})).await {
                Err(e @ SiteError::SignInAgain) => println!("call: {e}"),
                other => println!("call: unexpected {other:?}"),
            }
            list(&core)?;
            Ok(())
        }
        "remove" => {
            let id = site_id(&core, arg(1)?)?;
            let removed = core.remove_site(id).await?;
            println!(
                "signed out on the site: {}. {}",
                removed.signed_out, removed.message
            );
            Ok(())
        }
        "inventory" => {
            for s in core.sites()? {
                match core.refresh_inventory(s.id).await {
                    Ok(inv) => {
                        let updates = inv.plugins.iter().filter(|p| p.update.is_some()).count();
                        println!(
                            "{}: {} plugins ({} active, {} with an update), {} themes, WordPress update {}, updates known {}",
                            s.name,
                            inv.plugins.len(),
                            inv.plugins.iter().filter(|p| p.active).count(),
                            updates,
                            inv.themes.len(),
                            inv.wordpress_update.as_deref().unwrap_or("none"),
                            inv.updates_known
                        );
                        for p in inv
                            .plugins
                            .iter()
                            .filter(|p| p.id.starts_with("woocommerce/"))
                        {
                            println!(
                                "  {} {} active {} update {}",
                                p.id,
                                p.version,
                                p.active,
                                p.update.as_deref().unwrap_or("none")
                            );
                        }
                    }
                    Err(e) => println!("{}: not read: {e}", s.name),
                }
            }
            Ok(())
        }
        "update-plugin" => {
            let plugin = arg(1)?.to_string();
            let mut changes = Vec::new();
            for url in &args[2..] {
                changes.push(Change {
                    site_id: site_id(&core, url)?,
                    action: Action::UpdatePlugin {
                        plugin: plugin.clone(),
                    },
                });
            }
            let job = core
                .start_job(
                    &format!("Update {plugin} on {} sites", changes.len()),
                    changes,
                )
                .await?;
            print_job(&wait(&core, job.id).await?);
            Ok(())
        }
        "versions" => {
            let id = site_id(&core, arg(1)?)?;
            let v = core.plugin_versions(id, arg(2)?).await?;
            let list: Vec<&str> = v["versions"]
                .as_array()
                .into_iter()
                .flatten()
                .filter_map(|v| v["version"].as_str())
                .take(8)
                .collect();
            println!(
                "installed {}, newest versions offered: {}",
                v["installed"].as_str().unwrap_or("?"),
                list.join(", ")
            );
            Ok(())
        }
        "rollback" => {
            let id = site_id(&core, arg(1)?)?;
            let job = core
                .start_job(
                    "Roll back",
                    vec![Change {
                        site_id: id,
                        action: Action::RollbackPlugin {
                            plugin: arg(2)?.into(),
                            version: arg(3)?.into(),
                        },
                    }],
                )
                .await?;
            print_job(&wait(&core, job.id).await?);
            Ok(())
        }
        "types" => show(&core.post_types(site_id(&core, arg(1)?)?).await?),
        "get" => show(
            &core
                .post(site_id(&core, arg(1)?)?, arg(2)?, arg(3)?.parse()?)
                .await?,
        ),
        "create" => show(
            &core
                .create_post(
                    site_id(&core, arg(1)?)?,
                    arg(2)?,
                    serde_json::from_str(arg(3)?)?,
                )
                .await?,
        ),
        "edit" => show(
            &core
                .edit_post(
                    site_id(&core, arg(1)?)?,
                    arg(2)?,
                    arg(3)?.parse()?,
                    serde_json::from_str(arg(4)?)?,
                )
                .await?,
        ),
        "import" => show(
            &core
                .import_media(site_id(&core, arg(1)?)?, arg(2)?, arg(3)?)
                .await?,
        ),
        "users" => show(
            &core
                .users(
                    site_id(&core, arg(1)?)?,
                    args.get(2).map_or("", String::as_str),
                    1,
                )
                .await?,
        ),
        "add-user" => show(
            &core
                .create_user(site_id(&core, arg(1)?)?, serde_json::from_str(arg(2)?)?)
                .await?,
        ),
        "set-role" => {
            core.set_role(site_id(&core, arg(1)?)?, arg(2)?.parse()?, arg(3)?)
                .await?;
            println!("role set");
            Ok(())
        }
        "delete-user" => {
            core.delete_user(site_id(&core, arg(1)?)?, arg(2)?.parse()?, arg(3)?.parse()?)
                .await?;
            println!("deleted");
            Ok(())
        }
        "reset" => {
            let to = core
                .send_password_reset(site_id(&core, arg(1)?)?, arg(2)?.parse()?)
                .await?;
            println!("reset email sent to {to}");
            Ok(())
        }
        "comments" => show(
            &core
                .comments(
                    site_id(&core, arg(1)?)?,
                    args.get(2).map_or("pending", String::as_str),
                )
                .await?,
        ),
        "moderate" => {
            core.moderate(site_id(&core, arg(1)?)?, arg(2)?.parse()?, arg(3)?)
                .await?;
            println!("{} done", arg(3)?);
            Ok(())
        }
        "reply" => {
            core.reply(
                site_id(&core, arg(1)?)?,
                arg(2)?.parse()?,
                arg(3)?.parse()?,
                arg(4)?,
            )
            .await?;
            println!("replied");
            Ok(())
        }
        "login-check" => login_check(&core, arg(1)?).await,
        "agent-access" => {
            let id = site_id(&core, arg(1)?)?;
            let s = core
                .add_agent_access(id, browser_as(&core, arg(2)?, false)?)
                .await?;
            println!("{}: AI agent access {}", s.name, s.agent_access);
            Ok(())
        }
        "agent-access-off" => {
            let s = core.remove_agent_access(site_id(&core, arg(1)?)?).await?;
            println!("{}: AI agent access {}", s.name, s.agent_access);
            Ok(())
        }
        "plans" => show(&core.waiting_plans()?),
        "confirm-plan" => {
            let job = core.confirm_plan(arg(1)?.parse()?).await?;
            print_job(&wait(&core, job.id).await?);
            Ok(())
        }
        "decline-plan" => {
            let job = core.decline_plan(arg(1)?.parse()?)?;
            println!("declined \"{}\"", job.title);
            Ok(())
        }
        "security" => {
            match args.get(1) {
                Some(url) => drop(core.scan_security(site_id(&core, url)?).await?),
                None => core.scan_all_security(false).await,
            }
            for r in core.security_reports()? {
                let name = core.site(r.site_id)?.name;
                println!(
                    "{name}: {} vulnerabilities, {} abandoned, checksums {}",
                    r.vulnerabilities.len(),
                    r.abandoned.len(),
                    r.checksums
                        .as_ref()
                        .map_or("not compared".into(), |c| format!(
                            "{} compared, {} differ, {} not verifiable",
                            c.checked,
                            c.changed.len(),
                            c.not_verifiable.len()
                        ))
                );
                for v in &r.vulnerabilities {
                    println!(
                        "  {} {} {}: {} ({}; fixed in {})",
                        v.kind,
                        v.name,
                        v.installed,
                        v.title,
                        v.severity.as_deref().unwrap_or("not rated"),
                        v.fixed_in.as_deref().unwrap_or("no fix yet")
                    );
                }
                for a in &r.abandoned {
                    println!(
                        "  abandoned {} {}: closed {} last release {:?}",
                        a.name, a.version, a.closed, a.last_updated
                    );
                }
                for c in r.checksums.iter().flat_map(|c| &c.changed) {
                    println!(
                        "  differs {}: {:?} {:?} {:?}",
                        c.name, c.modified, c.missing, c.added
                    );
                }
                for n in &r.notes {
                    println!("  note: {n}");
                }
            }
            Ok(())
        }
        "monitors" => {
            core.check_monitors(true).await;
            for m in core.monitors()? {
                println!(
                    "{}: up {:?} status {} in {} ms, uptime 24h {:?}, certificate expires {:?}, domain {:?} expires {:?} {}",
                    core.site(m.site_id)?.name,
                    m.up,
                    m.status,
                    m.ms,
                    m.uptime_day,
                    m.cert_expires,
                    m.domain,
                    m.domain_expires,
                    m.domain_note
                );
            }
            Ok(())
        }
        "pagespeed" => show(&core.run_pagespeed(site_id(&core, arg(1)?)?).await?),
        "log" => {
            for e in core.activity_log(None)?.iter().rev() {
                println!(
                    "  #{:<4} {:<16} {:<20} {:<9} {}{}",
                    e.id,
                    format!("{:?}", e.actor),
                    if e.site_name.is_empty() {
                        "-"
                    } else {
                        &e.site_name
                    },
                    format!("{:?}", e.outcome),
                    e.what,
                    if e.detail.is_empty() {
                        String::new()
                    } else {
                        format!("  ({})", e.detail)
                    }
                );
            }
            Ok(())
        }
        "agent" => {
            match core.agent_call(arg(1)?, arg(2)?, json!({})).await {
                Ok(_) => println!("agent call ran"),
                Err(e) => println!("agent call refused: {e}"),
            }
            Ok(())
        }
        "features" => {
            let word = args.get(2).map_or("", String::as_str);
            for g in core.features(site_id(&core, arg(1)?)?).await? {
                for t in g.toggles.iter().filter(|t| t.name.contains(word)) {
                    println!(
                        "{} / {}: {} ({}){}",
                        g.label,
                        t.label,
                        if t.on { "on" } else { "off" },
                        t.name,
                        if t.locked { ", locked" } else { "" }
                    );
                }
            }
            Ok(())
        }
        "set-feature" => {
            let undo = core
                .set_feature(site_id(&core, arg(1)?)?, arg(2)?, arg(3)? == "on")
                .await?;
            println!("set {} {}; undo row {:?}", arg(2)?, arg(3)?, undo);
            Ok(())
        }
        "undo" => {
            core.undo(site_id(&core, arg(1)?)?, arg(2)?.parse()?)
                .await?;
            println!("undone");
            Ok(())
        }
        "activity" => show(&core.activity(site_id(&core, arg(1)?)?, 1).await?),
        "approvals" => show(&core.approvals(site_id(&core, arg(1)?)?).await?),
        "settings" => show(&core.settings(site_id(&core, arg(1)?)?).await?),
        "publish" => {
            let body = std::fs::read_to_string(arg(2)?)?;
            let action = Action::PublishPost {
                post_type: "post".into(),
                title: arg(1)?.into(),
                body,
                status: "publish".into(),
                date: None,
                terms: Default::default(),
            };
            let mut changes = Vec::new();
            for url in &args[3..] {
                changes.push(Change {
                    site_id: site_id(&core, url)?,
                    action: action.clone(),
                });
            }
            let job = core
                .start_job(
                    &format!("Publish {} on {} sites", arg(1)?, changes.len()),
                    changes,
                )
                .await?;
            print_job(&wait(&core, job.id).await?);
            Ok(())
        }
        "search" => show(&core.search_content(arg(1)?).await?),
        "client" => {
            let name = arg(1)?;
            let c = match core
                .clients()?
                .into_iter()
                .find(|c| c.name.eq_ignore_ascii_case(name))
            {
                Some(c) => c,
                None => core.save_client(&monks_core::business::Client {
                    id: 0,
                    name: name.into(),
                    email: String::new(),
                    notes: String::new(),
                })?,
            };
            for url in &args[2..] {
                core.set_site_client(site_id(&core, url)?, Some(c.id))?;
            }
            println!(
                "client {} has {} sites",
                c.name,
                core.sites()?
                    .iter()
                    .filter(|s| s.client_id == Some(c.id))
                    .count()
            );
            Ok(())
        }
        "report" => {
            let name = arg(3)?;
            let c = core
                .clients()?
                .into_iter()
                .find(|c| c.name.eq_ignore_ascii_case(name))
                .ok_or("no such client")?;
            let ask = monks_core::report::ReportAsk {
                client_id: Some(c.id),
                site_ids: vec![],
                month: arg(1)?.into(),
            };
            let r = core.client_report(&ask, Path::new(arg(2)?)).await?;
            println!(
                "sites {}\nhtml {}\npdf {}\nnotes {:?}",
                r.sites, r.html, r.pdf, r.notes
            );
            Ok(())
        }
        "cm-reports" => show(&core.cm_reports(site_id(&core, arg(1)?)?, 30).await?),
        "store" => {
            let id = site_id(&core, arg(1)?)?;
            show(&core.store_overview(id, 30, None).await?)?;
            show(&core.products(id, &Default::default()).await?)
        }
        "zip" => {
            let file = Path::new(arg(2)?);
            let name = file
                .file_name()
                .and_then(|n| n.to_str())
                .ok_or("bad file name")?;
            let staged = core.stage_zip(name, &std::fs::read(file)?)?;
            let change = Change {
                site_id: site_id(&core, arg(1)?)?,
                action: Action::InstallZip {
                    file: staged.file,
                    name: name.into(),
                    kind: arg(3)?.into(),
                    activate: false,
                    overwrite: false,
                },
            };
            let job = core
                .start_job(&format!("Install {name}"), vec![change])
                .await?;
            print_job(&wait(&core, job.id).await?);
            Ok(())
        }
        other => Err(format!("unknown command {other}").into()),
    }
}

/// Use a login link as a browser would, with no cookies of its own: a GET only
/// shows the form, the POST signs in, the dashboard says who, a second use fails.
async fn login_check(core: &Core, url: &str) -> Res<()> {
    let link = core.login_link(site_id(core, url)?).await?;
    let parsed = reqwest::Url::parse(&link)?;
    println!(
        "link: {}://{}{} (single-use token not shown)",
        parsed.scheme(),
        parsed.host_str().unwrap_or_default(),
        parsed.path()
    );
    let http = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()?;
    let get = http.get(&link).send().await?;
    // Every WordPress auth cookie the answer sets, as one Cookie header.
    let signed = |r: &reqwest::Response| {
        let all: Vec<String> = r
            .headers()
            .get_all(reqwest::header::SET_COOKIE)
            .iter()
            .filter_map(|c| c.to_str().ok())
            .filter(|c| c.starts_with("wordpress_") && !c.contains("=deleted"))
            .map(|c| c.split(';').next().unwrap_or_default().to_string())
            .collect();
        all.iter()
            .any(|c| c.starts_with("wordpress_logged_in_"))
            .then(|| all.join("; "))
    };
    println!(
        "GET: {} {}",
        get.status(),
        if signed(&get).is_some() {
            "signed in (wrong)"
        } else {
            "only the form, not signed in"
        }
    );
    let referrer = get
        .headers()
        .get("referrer-policy")
        .and_then(|v| v.to_str().ok())
        .unwrap_or("none")
        .to_string();
    let token = parsed
        .query_pairs()
        .find(|(k, _)| k == "token")
        .map(|(_, v)| v.into_owned())
        .ok_or("no token")?;
    let post = http
        .post(&link)
        .form(&[("token", token.as_str())])
        .send()
        .await?;
    let to = post
        .headers()
        .get(LOCATION)
        .and_then(|l| l.to_str().ok())
        .unwrap_or_default()
        .to_string();
    let cookie = signed(&post).ok_or("the POST didn't sign in")?;
    println!(
        "POST: {} to {to} (Referrer-Policy: {referrer})",
        post.status()
    );
    let profile = http
        .get(absolute(&link, "/wp-admin/profile.php")?)
        .header(COOKIE, &cookie)
        .send()
        .await?
        .text()
        .await?;
    let login = profile
        .split("id=\"user_login\"")
        .nth(1)
        .and_then(|rest| attr(rest, "value"))
        .unwrap_or_else(|| "nobody".into());
    println!("dashboard profile says: signed in as {login}");
    let again = http
        .post(&link)
        .form(&[("token", token.as_str())])
        .send()
        .await?;
    println!(
        "second use: {} {}",
        again.status(),
        if signed(&again).is_some() {
            "signed in again (wrong)"
        } else {
            "refused"
        }
    );
    Ok(())
}

fn show(v: &impl serde::Serialize) -> Res<()> {
    println!("{}", serde_json::to_string_pretty(v)?);
    Ok(())
}

async fn wait(core: &Core, job: i64) -> Res<Job> {
    for _ in 0..600 {
        let j = core.job(job)?;
        if j.finished_at.is_some() {
            return Ok(j);
        }
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
    }
    Err("the job didn't finish in 5 minutes".into())
}

fn print_job(job: &Job) {
    println!(
        "job {} \"{}\": {} changes",
        job.id,
        job.title,
        job.items.len()
    );
    for i in &job.items {
        println!(
            "  {:?}  {}, {}  {} -> {}  ({})",
            i.state,
            i.site_name,
            i.label,
            i.from_version.as_deref().unwrap_or("?"),
            i.to_version.as_deref().unwrap_or("?"),
            i.message
        );
    }
}

/// Plays the person in the browser: signed in as the site's admin, ticks operator.
fn browser(core: &Arc<Core>, wp_path: &str) -> Res<impl FnOnce(&str) -> std::io::Result<()>> {
    browser_as(core, wp_path, true)
}

/// The same, ticking "operator" or (for AI agents' connection) leaving it unticked.
fn browser_as(
    core: &Arc<Core>,
    wp_path: &str,
    operator: bool,
) -> Res<impl FnOnce(&str) -> std::io::Result<()> + use<>> {
    let cookie = login_cookie(wp_path)?;
    let c = core.clone();
    Ok(move |auth_url: &str| {
        let auth_url = auth_url.to_string();
        tokio::spawn(async move {
            if let Err(e) = consent(&auth_url, &cookie, operator).await {
                eprintln!("consent failed: {e}");
                c.cancel_sign_in();
            }
        });
        Ok(())
    })
}

fn report(r: Result<monks_core::sites::Site, SiteError>) -> Res<()> {
    match r {
        Ok(s) => {
            println!(
                "added {} ({}): {:?}, WordPress {}, Classic Monks {}, operator {}, degraded {}, {} abilities, health {:?} ({})",
                s.name,
                s.url,
                s.mode,
                s.wp_version.as_deref().unwrap_or("?"),
                s.cm_version.as_deref().unwrap_or("-"),
                s.capabilities["operator"],
                s.capabilities["degraded"],
                s.capabilities["abilities"].as_array().map_or(0, Vec::len),
                s.health,
                s.health_detail
            );
            Ok(())
        }
        Err(e) => {
            println!("refused: {e}");
            Ok(())
        }
    }
}

fn list(core: &Core) -> Res<()> {
    for s in core.sites()? {
        println!(
            "{:<22} {:<38} {:<13} WP {:<6} health {:<8} {}{}",
            s.name,
            s.url,
            format!("{:?}", s.mode),
            s.wp_version.as_deref().unwrap_or("?"),
            format!("{:?}", s.health),
            s.health_detail,
            if s.sign_in_again {
                "  [Sign in again]"
            } else {
                ""
            }
        );
    }
    Ok(())
}

fn site_id(core: &Core, url: &str) -> Res<i64> {
    let url = url.trim_end_matches('/');
    core.sites()?
        .into_iter()
        .find(|s| s.url == url)
        .map(|s| s.id)
        .ok_or_else(|| format!("{url} is not added").into())
}

/// Rewrite the saved grant with an expiry in the past (the vault API, so the
/// record stays sealed).
fn expire(core: &Arc<Core>, id: i64) -> Res<()> {
    let kc = vault::os_keychain()?;
    let v = vault::Vault::new(&vault::load_or_create_master_key(&*kc, &core.home)?);
    let store = core.store.lock().unwrap();
    let name = format!("site:{id}");
    let bytes = v.get(store.conn(), &name)?.ok_or("no secret")?;
    let mut t: Tokens = serde_json::from_slice(&bytes)?;
    t.expires_at = 0;
    v.put(store.conn(), &name, &serde_json::to_vec(&t)?)?;
    println!("access token marked expired");
    Ok(())
}

/// A WordPress login cookie for the site's first administrator, made by WP-CLI.
fn login_cookie(wp_path: &str) -> Res<String> {
    let php = r#"$u = get_users( array( 'role' => 'administrator', 'number' => 1, 'orderby' => 'ID' ) )[0];
$exp = time() + 900;
$t = WP_Session_Tokens::get_instance( $u->ID )->create( $exp );
echo "\n", SECURE_AUTH_COOKIE, '=', wp_generate_auth_cookie( $u->ID, $exp, 'secure_auth', $t ), "\n";
echo LOGGED_IN_COOKIE, '=', wp_generate_auth_cookie( $u->ID, $exp, 'logged_in', $t ), "\n";"#;
    let out = std::process::Command::new("studio")
        .args(["wp", "--path", wp_path, "eval", php])
        .output()?;
    let text = String::from_utf8_lossy(&out.stdout);
    let cookies: Vec<&str> = text
        .lines()
        .filter(|l| l.starts_with("wordpress_"))
        .collect();
    if cookies.len() != 2 {
        return Err(format!("no login cookie from {}", Path::new(wp_path).display()).into());
    }
    Ok(cookies.join("; "))
}

/// Load the consent page as the signed-in admin, tick every tool group and
/// operator, press Connect,
/// then follow the redirect back to the app's loopback.
async fn consent(auth_url: &str, cookie: &str, tick_operator: bool) -> Res<()> {
    let http = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()?;
    let mut url = auth_url.to_string();
    let page = loop {
        let r = http.get(&url).header(COOKIE, cookie).send().await?;
        match r.headers().get(LOCATION) {
            Some(l) => url = absolute(&url, l.to_str()?)?,
            None => break r.text().await?,
        }
    };
    let shown = page.contains("name=\"operator\"");
    let operator = shown && tick_operator;
    if operator {
        println!("consent page: shows \"This is my Monks Central app (operator)\"; ticking it");
    } else if shown {
        println!(
            "consent page: shows \"This is my Monks Central app (operator)\"; leaving it unticked"
        );
    } else {
        println!("consent page: no operator checkbox (this Classic Monks predates it)");
    }
    let action =
        attr(&page[page.find("<form").ok_or("no form")?..], "action").ok_or("no form action")?;
    let fields = inputs(&page);
    let mut form: Vec<(String, String)> = fields
        .iter()
        .filter(|(t, _, _)| t == "hidden")
        .map(|(_, n, v)| (n.clone(), v.clone()))
        .collect();
    // Like a person who wants everything: every tool group and the widest access.
    let groups: Vec<_> = fields
        .iter()
        .filter(|(t, n, _)| t == "checkbox" && n == "toolsets[]")
        .map(|(_, n, v)| (n.clone(), v.clone()))
        .collect();
    println!("consent page: ticking all {} tool groups", groups.len());
    form.extend(groups);
    if fields
        .iter()
        .any(|(t, n, v)| t == "radio" && n == "scope" && v == "full")
    {
        form.push(("scope".into(), "full".into()));
    }
    if operator {
        form.push(("operator".into(), "1".into()));
    }
    form.push(("decision".into(), "approve".into()));
    let r = http
        .post(absolute(&url, &action)?)
        .header(COOKIE, cookie)
        .form(&form)
        .send()
        .await?;
    let back = r
        .headers()
        .get(LOCATION)
        .ok_or_else(|| format!("consent answered {} without a redirect", r.status()))?
        .to_str()?
        .to_string();
    // Back to the app, without the site's cookie.
    reqwest::get(back).await?;
    Ok(())
}

/// The person opens the site's approve page, signed in as the admin, and presses Approve.
async fn approve(wp_path: &str, approve_url: &str) -> Res<()> {
    let cookie = login_cookie(wp_path)?;
    let http = reqwest::Client::builder()
        .redirect(reqwest::redirect::Policy::none())
        .build()?;
    let page = http
        .get(approve_url)
        .header(COOKIE, &cookie)
        .send()
        .await?
        .text()
        .await?;
    let at = page
        .find("value=\"cm_ai_decide\"")
        .ok_or("the approve page has no decision form (already decided, or expired?)")?;
    let start = page[..at].rfind("<form").ok_or("no form")?;
    let form_html = &page[start..start + page[start..].find("</form>").ok_or("no form end")?];
    let action = attr(form_html, "action").ok_or("no form action")?;
    let mut form: Vec<(String, String)> = inputs(form_html)
        .into_iter()
        .filter(|(t, _, _)| t == "hidden")
        .map(|(_, n, v)| (n, v))
        .collect();
    let what = page
        .find("cm-ai-approve__json")
        .map(|i| &page[i..])
        .and_then(|p| p.find('>').map(|j| &p[j + 1..]))
        .and_then(|p| p.find("</pre>").map(|k| unescape(&p[..k])))
        .unwrap_or_default();
    println!(
        "approve page: asks to approve {}",
        what.split_whitespace().collect::<Vec<_>>().join(" ")
    );
    form.push(("decision".into(), "approve".into()));
    let r = http
        .post(absolute(approve_url, &action)?)
        .header(COOKIE, &cookie)
        .form(&form)
        .send()
        .await?;
    println!(
        "approve page: pressed Approve, the site answered {}",
        r.status()
    );
    Ok(())
}

fn absolute(base: &str, href: &str) -> Res<String> {
    Ok(reqwest::Url::parse(base)?.join(&unescape(href))?.into())
}

fn unescape(s: &str) -> String {
    s.replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&#039;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
}

fn attr(tag: &str, name: &str) -> Option<String> {
    let tag = &tag[..tag.find('>')?];
    let start = tag.find(&format!(" {name}=\""))? + name.len() + 3;
    let end = start + tag[start..].find('"')?;
    Some(unescape(&tag[start..end]))
}

/// (type, name, value) of every `<input>`.
fn inputs(html: &str) -> Vec<(String, String, String)> {
    html.match_indices("<input")
        .filter_map(|(i, _)| {
            let tag = &html[i..];
            Some((
                attr(tag, "type")?,
                attr(tag, "name")?,
                attr(tag, "value").unwrap_or_default(),
            ))
        })
        .collect()
}
