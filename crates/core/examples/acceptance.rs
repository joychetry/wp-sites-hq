//! Live acceptance driver for Studio sites. Uses the same core API as the app.
//!
//!   MONKS_HOME=<private test folder> cargo run -p monks-core --example acceptance -- <command>
//!
//!   connect-oauth <url> <studio site path>   sign in as the site's admin, tick "operator"
//!   connect-basic <url> <user> <password file>
//!   list | check
//!   burst <url>          expire the access token, then 20 parallel calls
//!   corrupt <url>        damage the saved secret
//!   remove <url>
//!   forget-key           delete this data folder's keychain item
//!
//! The browser step is played by this program: a login cookie made with
//! `studio wp` (no password is handled), then the site's real consent form,
//! submitted with "This is my Monks Central app (operator)" ticked. Cookies
//! and tokens are never printed.

use std::path::Path;
use std::sync::Arc;
use std::sync::atomic::Ordering;

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
        return Err("set MONKS_HOME to a private test folder".into());
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
        },
    )
    .await?;
    let arg = |i: usize| args.get(i).map(String::as_str).ok_or("missing argument");
    match arg(0)? {
        "connect-oauth" => {
            let (url, wp_path) = (arg(1)?.to_string(), arg(2)?.to_string());
            let cookie = login_cookie(&wp_path)?;
            let c = core.clone();
            let site = core
                .add_site_oauth(&url, move |auth_url| {
                    let auth_url = auth_url.to_string();
                    tokio::spawn(async move {
                        if let Err(e) = consent(&auth_url, &cookie).await {
                            eprintln!("consent failed: {e}");
                            c.cancel_sign_in();
                        }
                    });
                    Ok(())
                })
                .await;
            report(site)
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
            let n = core.store.lock().unwrap().conn().execute(
                "UPDATE credentials SET blob = substr(blob, 1, 30) || x'00' || substr(blob, 32) WHERE name = ?1",
                [format!("site:{id}")],
            )?;
            println!("damaged {n} saved secret (one byte flipped to 0)");
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
        other => Err(format!("unknown command {other}").into()),
    }
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

/// Load the consent page as the signed-in admin, tick operator, press Connect,
/// then follow the redirect back to the app's loopback.
async fn consent(auth_url: &str, cookie: &str) -> Res<()> {
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
    if !page.contains("name=\"operator\"") {
        return Err("the consent page has no operator checkbox".into());
    }
    println!("consent page: shows \"This is my Monks Central app (operator)\"; ticking it");
    let action =
        attr(&page[page.find("<form").ok_or("no form")?..], "action").ok_or("no form action")?;
    let mut form: Vec<(String, String)> = inputs(&page)
        .into_iter()
        .filter(|(t, _, _)| t == "hidden")
        .map(|(_, n, v)| (n, v))
        .collect();
    form.push(("operator".into(), "1".into()));
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
