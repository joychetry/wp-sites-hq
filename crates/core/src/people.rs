//! Users and comments (plan Phase 4): list a site's users, add one, change a
//! role, delete one and hand their content to another user, and email a password
//! reset (Classic Monks M7); the comments waiting on a site, approve, unapprove,
//! spam, trash and reply.
//!
//! Classic Monks sites use its tools; Basic mode uses core REST.

use base64::Engine;
use reqwest::Method;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

use crate::Core;
use crate::connect::{SiteError, plain};
use crate::content::{Body, local, text};
use crate::fleet::has_tool;
use crate::sites::{Mode, Site};

pub const PER_PAGE: u32 = 50;
/// The roles every WordPress has, for sites that don't say which they have.
const CORE_ROLES: &[(&str, &str)] = &[
    ("administrator", "Administrator"),
    ("editor", "Editor"),
    ("author", "Author"),
    ("contributor", "Contributor"),
    ("subscriber", "Subscriber"),
];
const MODERATE: &[&str] = &["approve", "unapprove", "spam", "trash"];

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct User {
    pub id: i64,
    pub username: String,
    pub email: String,
    pub name: String,
    /// The role slug, or empty for a user with none.
    pub role: String,
    pub registered: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Role {
    pub id: String,
    pub name: String,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Users {
    pub users: Vec<User>,
    pub total: u64,
    /// Roles a user can be given here.
    pub roles: Vec<Role>,
    /// Whether this site can email a password reset (Classic Monks M7).
    pub can_reset: bool,
}

#[derive(Debug, Clone, Default, Deserialize)]
pub struct NewUser {
    pub username: String,
    pub email: String,
    pub role: String,
    #[serde(default)]
    pub first_name: String,
    #[serde(default)]
    pub last_name: String,
    /// Email them the link to set a password (Classic Monks M7).
    #[serde(default)]
    pub send_reset: bool,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Comment {
    pub id: i64,
    pub post_id: i64,
    pub post_title: String,
    pub author: String,
    pub email: String,
    /// As the commenter wrote it (HTML).
    pub content: String,
    pub date: String,
    /// `pending`, `approved`, `spam` or `trash`.
    pub status: String,
    pub parent: i64,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct Comments {
    pub comments: Vec<Comment>,
    pub total: u64,
}

fn role_name(id: &str) -> String {
    CORE_ROLES
        .iter()
        .find(|(r, _)| *r == id)
        .map(|(_, n)| (*n).to_string())
        .unwrap_or_else(|| {
            let mut words = id.replace(['_', '-'], " ");
            if let Some(f) = words.get_mut(0..1) {
                f.make_ascii_uppercase();
            }
            words
        })
}

fn user_from(u: &Value, rest: bool) -> User {
    User {
        id: u["id"].as_i64().unwrap_or_default(),
        username: text(&u["username"]),
        email: text(&u["email"]),
        name: text(if rest { &u["name"] } else { &u["display_name"] }),
        role: if rest {
            u["roles"][0].as_str().unwrap_or_default().to_string()
        } else {
            text(&u["role"]).replace("none", "")
        },
        registered: if rest {
            local(&u["registered_date"])
        } else {
            text(&u["registered_date"])
        },
    }
}

/// The core roles plus any other role a listed user has.
fn known_roles(users: &[User]) -> Vec<Role> {
    let mut roles: Vec<Role> = CORE_ROLES
        .iter()
        .map(|(id, name)| Role {
            id: (*id).into(),
            name: (*name).into(),
        })
        .collect();
    for u in users {
        if !u.role.is_empty() && !roles.iter().any(|r| r.id == u.role) {
            roles.push(Role {
                id: u.role.clone(),
                name: role_name(&u.role),
            });
        }
    }
    roles
}

/// Classic Monks says `unapproved`, core REST `hold`: both are pending here.
fn comment_status(s: &str) -> String {
    match s {
        "unapproved" | "hold" | "0" => "pending",
        "approve" | "1" => "approved",
        other => other,
    }
    .to_string()
}

fn comment_from(c: &Value, rest: bool) -> Comment {
    Comment {
        id: c["id"].as_i64().unwrap_or_default(),
        post_id: c[if rest { "post" } else { "post_id" }]
            .as_i64()
            .unwrap_or_default(),
        post_title: if rest {
            text(&c["_embedded"]["up"][0]["title"])
        } else {
            text(&c["post_title"])
        },
        author: text(&c[if rest { "author_name" } else { "author" }]),
        email: text(&c["author_email"]),
        content: text(&c["content"]),
        date: if rest {
            local(&c["date"])
        } else {
            text(&c["date"])
        },
        status: comment_status(&text(&c["status"])),
        parent: c["parent"].as_i64().unwrap_or_default(),
    }
}

fn total(reply: &crate::net::Reply) -> u64 {
    reply
        .headers
        .get("x-wp-total")
        .and_then(|h| h.to_str().ok()?.parse().ok())
        .unwrap_or_default()
}

/// A password nobody sees: the person sets their own with "Lost your password?".
fn throwaway_password() -> String {
    let mut bytes = [0u8; 24];
    getrandom::fill(&mut bytes).expect("the system has no random numbers");
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(bytes)
}

impl Core {
    /// The site, if it can use this Classic Monks tool (Basic mode passes: it uses REST).
    fn people_site(&self, id: i64, tool: &str) -> Result<Site, SiteError> {
        let site = self.site(id)?;
        if site.mode == Mode::ClassicMonks && !has_tool(&site, tool) {
            return Err(plain(
                "This connection can't do that on this site. Update Classic Monks on the site and check it again, or sign in again and tick the user and comment tool groups.",
            ));
        }
        Ok(site)
    }

    /// One page of a site's users, by name.
    pub async fn users(&self, id: i64, search: &str, page: u32) -> Result<Users, SiteError> {
        let _work = self.working().await;
        let site = self.people_site(id, "get-users")?;
        let page = page.max(1);
        let search = search.trim();
        match site.mode {
            Mode::ClassicMonks => {
                let mut args = json!({
                    "limit": PER_PAGE, "offset": (page - 1) * PER_PAGE,
                    "orderby": "display_name", "order": "ASC",
                });
                if !search.is_empty() {
                    args["search"] = search.into();
                }
                let v = self.call_ability_inner(id, "get-users", args).await?;
                let users: Vec<User> = v["users"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .map(|u| user_from(u, false))
                    .collect();
                // Classic Monks before M7 doesn't list the roles.
                let roles = match v["roles"].as_array() {
                    Some(r) => r
                        .iter()
                        .map(|r| Role {
                            id: text(&r["id"]),
                            name: text(&r["name"]),
                        })
                        .collect(),
                    None => known_roles(&users),
                };
                Ok(Users {
                    total: v["total"].as_u64().unwrap_or_default(),
                    users,
                    roles,
                    can_reset: has_tool(&site, "send-password-reset"),
                })
            }
            Mode::Basic => {
                let mut q = vec![
                    ("context", "edit".to_string()),
                    ("per_page", PER_PAGE.to_string()),
                    ("page", page.to_string()),
                    ("orderby", "name".into()),
                ];
                if !search.is_empty() {
                    q.push(("search", search.into()));
                }
                let (v, reply) = self
                    .rest_json(&site, Method::GET, "/wp/v2/users", &q, Body::None)
                    .await?;
                let users: Vec<User> = v
                    .as_array()
                    .into_iter()
                    .flatten()
                    .map(|u| user_from(u, true))
                    .collect();
                Ok(Users {
                    total: total(&reply),
                    roles: known_roles(&users),
                    users,
                    can_reset: false,
                })
            }
        }
    }

    /// Add a user. Nobody sees their password; on Classic Monks sites they can
    /// be emailed the link to set one.
    pub async fn create_user(&self, id: i64, new: NewUser) -> Result<User, SiteError> {
        let _work = self.working().await;
        let site = self.people_site(id, "create-user")?;
        let (username, email, role) = (new.username.trim(), new.email.trim(), new.role.trim());
        if username.is_empty() || !email.contains('@') {
            return Err(plain("Give the user a username and an email address."));
        }
        let user = match site.mode {
            Mode::ClassicMonks => {
                let mut args = json!({
                    "username": username, "email": email,
                    // The human picked the role in the window, warned when it runs the site.
                    "confirm_admin_role": true,
                });
                for (k, v) in [
                    ("role", role),
                    ("first_name", new.first_name.trim()),
                    ("last_name", new.last_name.trim()),
                ] {
                    if !v.is_empty() {
                        args[k] = v.into();
                    }
                }
                let v = self.call_ability_inner(id, "create-user", args).await?;
                User {
                    id: v["id"].as_i64().unwrap_or_default(),
                    username: text(&v["username"]),
                    email: text(&v["email"]),
                    name: text(&v["username"]),
                    role: text(&v["role"]),
                    registered: String::new(),
                }
            }
            Mode::Basic => {
                let mut body = json!({
                    "username": username, "email": email, "password": throwaway_password(),
                    "first_name": new.first_name.trim(), "last_name": new.last_name.trim(),
                });
                if !role.is_empty() {
                    body["roles"] = json!([role]);
                }
                let (v, _) = self
                    .rest_json(
                        &site,
                        Method::POST,
                        "/wp/v2/users",
                        &[("context", "edit".into())],
                        Body::Json(body),
                    )
                    .await?;
                user_from(&v, true)
            }
        };
        if new.send_reset {
            self.reset_inner(&site, user.id).await.map_err(|e| {
                plain(format!(
                    "{} was added, but the password email didn't go out: {e}",
                    user.username
                ))
            })?;
        }
        Ok(user)
    }

    /// Give a user another role.
    pub async fn set_role(&self, id: i64, user_id: i64, role: &str) -> Result<(), SiteError> {
        let _work = self.working().await;
        let site = self.people_site(id, "update-user")?;
        let role = role.trim();
        if role.is_empty() {
            return Err(plain("Pick a role."));
        }
        match site.mode {
            Mode::ClassicMonks => {
                self.call_ability_inner(
                    id,
                    "update-user",
                    json!({ "user_id": user_id, "role": role }),
                )
                .await?;
            }
            Mode::Basic => {
                let route = format!("/wp/v2/users/{user_id}");
                let body = Body::Json(json!({ "roles": [role] }));
                self.rest_json(&site, Method::POST, &route, &[], body)
                    .await?;
            }
        }
        Ok(())
    }

    /// Delete a user; their posts and pages go to `reassign`.
    pub async fn delete_user(&self, id: i64, user_id: i64, reassign: i64) -> Result<(), SiteError> {
        let _work = self.working().await;
        let site = self.people_site(id, "delete-user")?;
        if reassign == user_id || reassign <= 0 {
            return Err(plain("Pick another user to receive their posts and pages."));
        }
        match site.mode {
            Mode::ClassicMonks => {
                self.call_ability_inner(
                    id,
                    "delete-user",
                    json!({ "user_id": user_id, "reassign": reassign }),
                )
                .await?;
            }
            Mode::Basic => {
                let route = format!("/wp/v2/users/{user_id}");
                let q = [("force", "true".into()), ("reassign", reassign.to_string())];
                self.rest_json(&site, Method::DELETE, &route, &q, Body::None)
                    .await?;
            }
        }
        Ok(())
    }

    /// Email a user WordPress' link to set a new password (Classic Monks M7).
    pub async fn send_password_reset(&self, id: i64, user_id: i64) -> Result<String, SiteError> {
        let _work = self.working().await;
        let site = self.site(id)?;
        self.reset_inner(&site, user_id).await
    }

    async fn reset_inner(&self, site: &Site, user_id: i64) -> Result<String, SiteError> {
        if site.mode == Mode::Basic {
            return Err(plain(
                "A password reset email needs Classic Monks on the site. The person can use \"Lost your password?\" on the login screen.",
            ));
        }
        if !has_tool(site, "send-password-reset") {
            return Err(plain(
                "This site's Classic Monks is older and can't send a password reset. Update it, then check the site again.",
            ));
        }
        let v = self
            .call_ability_inner(
                site.id,
                "send-password-reset",
                json!({ "user_id": user_id }),
            )
            .await?;
        Ok(text(&v["email"]))
    }

    /// Up to 100 comments in one state, newest first: `pending` (the default),
    /// `approved`, `spam` or `trash`.
    pub async fn comments(&self, id: i64, status: &str) -> Result<Comments, SiteError> {
        let _work = self.working().await;
        let site = self.people_site(id, "get-comments")?;
        let (cm, rest) = match status {
            "" | "pending" => ("hold", "hold"),
            "approved" => ("approve", "approved"),
            "spam" => ("spam", "spam"),
            "trash" => ("trash", "trash"),
            other => return Err(plain(format!("There is no comment state {other}."))),
        };
        match site.mode {
            Mode::ClassicMonks => {
                let v = self
                    .call_ability_inner(id, "get-comments", json!({ "status": cm, "limit": 100 }))
                    .await?;
                Ok(Comments {
                    total: v["total"].as_u64().unwrap_or_default(),
                    comments: v["comments"]
                        .as_array()
                        .into_iter()
                        .flatten()
                        .map(|c| comment_from(c, false))
                        .collect(),
                })
            }
            Mode::Basic => {
                let q = [
                    ("context", "edit".to_string()),
                    ("status", rest.into()),
                    ("per_page", "100".into()),
                    ("_embed", "up".into()),
                ];
                let (v, reply) = self
                    .rest_json(&site, Method::GET, "/wp/v2/comments", &q, Body::None)
                    .await?;
                Ok(Comments {
                    total: total(&reply),
                    comments: v
                        .as_array()
                        .into_iter()
                        .flatten()
                        .map(|c| comment_from(c, true))
                        .collect(),
                })
            }
        }
    }

    /// `approve`, `unapprove`, `spam` or `trash` one comment.
    pub async fn moderate(&self, id: i64, comment_id: i64, action: &str) -> Result<(), SiteError> {
        let _work = self.working().await;
        let site = self.people_site(id, "moderate-comment")?;
        if !MODERATE.contains(&action) {
            return Err(plain(format!("Monks Central can't {action} a comment.")));
        }
        match site.mode {
            Mode::ClassicMonks => {
                let v = self
                    .call_ability_inner(
                        id,
                        "moderate-comment",
                        json!({ "comment_ids": [comment_id], "action": action }),
                    )
                    .await?;
                if v["results"][0]["success"] == false {
                    return Err(plain("The site didn't change that comment."));
                }
            }
            Mode::Basic => {
                let route = format!("/wp/v2/comments/{comment_id}");
                if action == "trash" {
                    self.rest_json(&site, Method::DELETE, &route, &[], Body::None)
                        .await?;
                } else {
                    let status = match action {
                        "approve" => "approved",
                        "unapprove" => "hold",
                        _ => "spam",
                    };
                    let body = Body::Json(json!({ "status": status }));
                    self.rest_json(&site, Method::POST, &route, &[], body)
                        .await?;
                }
            }
        }
        Ok(())
    }

    /// Answer a comment as the connected user.
    pub async fn reply(
        &self,
        id: i64,
        comment_id: i64,
        post_id: i64,
        text: &str,
    ) -> Result<(), SiteError> {
        let _work = self.working().await;
        let site = self.people_site(id, "reply-to-comment")?;
        let text = text.trim();
        if text.is_empty() {
            return Err(plain("Write a reply first."));
        }
        match site.mode {
            Mode::ClassicMonks => {
                self.call_ability_inner(
                    id,
                    "reply-to-comment",
                    json!({ "comment_id": comment_id, "content": text }),
                )
                .await?;
            }
            Mode::Basic => {
                let body =
                    Body::Json(json!({ "post": post_id, "parent": comment_id, "content": text }));
                self.rest_json(&site, Method::POST, "/wp/v2/comments", &[], body)
                    .await?;
            }
        }
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Options;
    use crate::testsite::TestSite;
    use std::sync::Arc;

    async fn core() -> (tempfile::TempDir, Arc<Core>) {
        let home = tempfile::tempdir().unwrap();
        let opts = Options {
            keychain: Ok(keyring_core::mock::Store::new().unwrap()),
            ..Default::default()
        };
        let core = Core::start(home.path(), opts).await.unwrap();
        (home, core)
    }

    fn browser(url: &str) -> std::io::Result<()> {
        let url = url.to_string();
        tokio::spawn(async move { reqwest::get(url).await });
        Ok(())
    }

    fn new_user(name: &str, role: &str, send_reset: bool) -> NewUser {
        NewUser {
            username: name.into(),
            email: format!("{name}@example.com"),
            role: role.into(),
            send_reset,
            ..Default::default()
        }
    }

    #[tokio::test]
    async fn classic_monks_manages_users_and_comments() {
        let (_h, core) = core().await;
        let site = TestSite::start().await;
        let s = core.add_site_oauth(&site.url, browser).await.unwrap();

        let list = core.users(s.id, "", 1).await.unwrap();
        assert_eq!(
            (list.total, list.users[1].role.as_str()),
            (2, "shop_manager")
        );
        assert_eq!(list.roles[1].name, "Shop manager", "the site's own roles");
        assert!(list.can_reset);
        assert_eq!(core.users(s.id, "sam", 1).await.unwrap().users.len(), 1);

        // Added with the reset email; an administrator is confirmed by the window.
        let u = core
            .create_user(s.id, new_user("lee", "administrator", true))
            .await
            .unwrap();
        assert_eq!(
            (u.username.as_str(), u.role.as_str()),
            ("lee", "administrator")
        );
        assert_eq!(site.state().resets, [u.id]);
        let e = core
            .create_user(s.id, new_user("lee", "subscriber", false))
            .await
            .unwrap_err();
        assert!(e.to_string().contains("already exists"));
        assert!(
            core.create_user(s.id, new_user("", "", false))
                .await
                .is_err()
        );

        core.set_role(s.id, u.id, "subscriber").await.unwrap();
        assert_eq!(site.state().users[2]["role"], "subscriber");
        assert!(core.set_role(s.id, u.id, " ").await.is_err());
        assert_eq!(
            core.send_password_reset(s.id, 2).await.unwrap(),
            "sam@example.com"
        );
        assert!(core.delete_user(s.id, u.id, u.id).await.is_err());
        core.delete_user(s.id, u.id, 1).await.unwrap();
        assert_eq!(site.state().users.len(), 2);

        // Comments: the pending one, approved; a reply; spam and trash.
        let c = core.comments(s.id, "pending").await.unwrap();
        assert_eq!((c.total, c.comments[0].status.as_str()), (1, "pending"));
        assert_eq!(c.comments[0].post_title, "Hello world");
        core.moderate(s.id, 7, "approve").await.unwrap();
        assert!(core.comments(s.id, "").await.unwrap().comments.is_empty());
        assert_eq!(core.comments(s.id, "approved").await.unwrap().total, 2);
        core.reply(s.id, 7, 5, "Thank you!").await.unwrap();
        assert!(core.reply(s.id, 7, 5, "  ").await.is_err());
        assert_eq!(site.state().comments[2]["parent"], 7);
        core.moderate(s.id, 8, "spam").await.unwrap();
        assert_eq!(core.comments(s.id, "spam").await.unwrap().total, 1);
        core.moderate(s.id, 8, "trash").await.unwrap();
        assert_eq!(core.comments(s.id, "trash").await.unwrap().total, 1);
        assert!(core.moderate(s.id, 8, "delete").await.is_err());
        assert!(core.moderate(s.id, 99, "approve").await.is_err());
        assert!(core.comments(s.id, "weird").await.is_err());
    }

    #[tokio::test]
    async fn released_classic_monks_offers_core_roles_and_no_reset() {
        let (_h, core) = core().await;
        let site = TestSite::start().await;
        site.state().released = true;
        let s = core.add_site_oauth(&site.url, browser).await.unwrap();
        let list = core.users(s.id, "", 1).await.unwrap();
        assert!(!list.can_reset);
        let roles: Vec<&str> = list.roles.iter().map(|r| r.name.as_str()).collect();
        assert_eq!(
            roles,
            [
                "Administrator",
                "Editor",
                "Author",
                "Contributor",
                "Subscriber",
                "Shop manager"
            ]
        );
        let e = core.send_password_reset(s.id, 2).await.unwrap_err();
        assert!(e.to_string().contains("older"));
        // Added, but the reset email can't go: said plainly.
        let e = core
            .create_user(s.id, new_user("kim", "subscriber", true))
            .await
            .unwrap_err();
        assert!(e.to_string().starts_with("kim was added, but"));
    }

    #[tokio::test]
    async fn basic_mode_manages_users_and_comments_over_rest() {
        let (_h, core) = core().await;
        let site = TestSite::start().await;
        let s = core
            .add_site_basic(&site.url, "admin", "abcd efgh ijkl mnop qrst uvwx")
            .await
            .unwrap();
        let list = core.users(s.id, "", 1).await.unwrap();
        assert_eq!(list.total, 2);
        assert_eq!(list.users[0].registered, "2026-01-02 03:04:05+00:00");
        assert_eq!(list.roles.last().unwrap().name, "Shop manager");
        assert!(!list.can_reset);

        let u = core
            .create_user(s.id, new_user("lee", "editor", false))
            .await
            .unwrap();
        assert_eq!(u.role, "editor");
        let e = core
            .create_user(s.id, new_user("kim", "", true))
            .await
            .unwrap_err();
        assert!(e.to_string().contains("Lost your password"));
        core.set_role(s.id, u.id, "author").await.unwrap();
        assert_eq!(site.state().users[2]["role"], "author");
        assert!(core.delete_user(s.id, u.id, 999).await.is_err());
        core.delete_user(s.id, u.id, 1).await.unwrap();
        assert!(site.state().users.iter().all(|x| x["id"] != u.id));

        let c = core.comments(s.id, "pending").await.unwrap();
        assert_eq!(c.comments[0].post_title, "Hello world");
        assert_eq!(c.comments[0].content, "Lovely <b>bread</b>.");
        assert_eq!(c.comments[0].date, "2026-10-28 09:00:00");
        core.moderate(s.id, 7, "approve").await.unwrap();
        assert_eq!(site.state().comments[0]["status"], "approved");
        core.moderate(s.id, 7, "unapprove").await.unwrap();
        core.moderate(s.id, 7, "spam").await.unwrap();
        assert_eq!(site.state().comments[0]["status"], "spam");
        core.moderate(s.id, 7, "trash").await.unwrap();
        assert_eq!(site.state().comments[0]["status"], "trash");
        core.reply(s.id, 8, 5, "Thanks").await.unwrap();
        assert_eq!(site.state().comments[2]["parent"], 8);
    }

    #[tokio::test]
    async fn a_connection_without_the_tools_is_told_why() {
        let (_h, core) = core().await;
        let site = TestSite::start().await;
        let s = core.add_site_oauth(&site.url, browser).await.unwrap();
        core.db(|c| {
            c.execute(
                "UPDATE sites SET capabilities = json_set(capabilities, '$.abilities', json('[]')) WHERE id = ?1",
                [s.id],
            )
        })
        .unwrap();
        let e = core.users(s.id, "", 1).await.unwrap_err();
        assert!(e.to_string().contains("Update Classic Monks"));
    }

    #[test]
    fn small_helpers() {
        assert_eq!(role_name("shop_manager"), "Shop manager");
        assert_eq!(role_name("editor"), "Editor");
        assert_eq!(comment_status("unapproved"), "pending");
        assert_eq!(comment_status("1"), "approved");
        assert_eq!(comment_status("spam"), "spam");
        assert_eq!(throwaway_password().len(), 32);
        let u = user_from(&json!({ "id": 3, "role": "none" }), false);
        assert_eq!(u.role, "");
    }
}
