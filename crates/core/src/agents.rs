//! AI agents on the socket (plan 5.6). They read every Classic Monks site with
//! the app's grant. A change on one site goes through the agents' own grant,
//! which the human gives per site with "operator" left unticked, so the site's
//! approvals stop it until a person approves it there. Without that grant the
//! change is refused before anything is sent.

use serde_json::{Value, json};

use crate::connect::{Grant, SiteError, plain, tool_output};
use crate::fleet::{NO_AGENT_ACCESS, has_tool};
use crate::net::Retry;
use crate::sites::{self, Mode, Site};
use crate::{Core, oauth};

/// The human ticked "This is my Monks Central app" while giving agents access.
pub const AGENT_IS_OPERATOR: &str = "That sign-in was marked \"This is my Monks Central app (operator)\", which would let AI agents change the site without asking you. Monks Central gave it back. Turn on AI agent access again and leave that box unticked.";

impl Core {
    /// A site by its number, address or name, as an agent names it.
    pub fn find_site(&self, wanted: &str) -> Result<Site, SiteError> {
        let wanted = wanted.trim().trim_end_matches('/');
        self.sites()?
            .into_iter()
            .find(|s| {
                s.id.to_string() == wanted
                    || s.url == wanted
                    || s.url
                        .split_once("://")
                        .is_some_and(|(_, host)| host == wanted)
                    || s.name.eq_ignore_ascii_case(wanted)
            })
            .ok_or_else(|| plain(format!("No site called {wanted} in Monks Central.")))
    }

    /// Give AI agents their own grant on a Classic Monks site. `open` shows the
    /// site's consent page, where the human leaves "operator" unticked.
    pub async fn add_agent_access(
        &self,
        id: i64,
        open: impl FnOnce(&str) -> std::io::Result<()>,
    ) -> Result<Site, SiteError> {
        let _work = self.working().await;
        let site = self.site(id)?;
        if site.mode != Mode::ClassicMonks {
            return Err(plain(
                "AI agents can work only with sites that have Classic Monks, which asks you before each change.",
            ));
        }
        if site.sign_in_again {
            return Err(SiteError::SignInAgain);
        }
        let url = sites::normalize_url(&site.url).map_err(plain)?;
        let (d, client, tokens) = self
            .oauth_sign_in(&url, oauth::AGENT_CLIENT_NAME, open)
            .await?;
        let checked = self
            .check_agent_grant(&site, &d.resource, &tokens.access_token)
            .await;
        if let Err(e) = checked {
            self.revoke_fresh(&site.url, &client, &tokens).await;
            return Err(e);
        }
        // The grant this one replaces, if agents had one already.
        let old = site
            .agent_oauth
            .clone()
            .zip(self.tokens(id, Grant::Agent).ok());
        self.save_named(&Grant::Agent.secret(id), &tokens)?;
        self.db(|c| sites::set_agent(c, id, Some(&client)))?;
        if let Some((c, t)) = old {
            self.revoke_fresh(&site.url, &c, &t).await;
        }
        self.notify();
        self.site(id)
    }

    /// The new grant is for this site's MCP endpoint and is not an operator.
    async fn check_agent_grant(
        &self,
        site: &Site,
        resource: &str,
        token: &str,
    ) -> Result<(), SiteError> {
        if resource != site.api_url {
            return Err(plain(
                "The site answered from a different Classic Monks address than before. Check the site, then try again.",
            ));
        }
        let url = sites::normalize_url(&site.url).map_err(plain)?;
        let caps = self
            .describe_cm(&site.url, resource, token, &url)
            .await?
            .capabilities;
        if caps["operator"] == true {
            return Err(plain(AGENT_IS_OPERATOR));
        }
        Ok(())
    }

    /// Take AI agents' grant away: signed out on the site, then forgotten here.
    pub async fn remove_agent_access(&self, id: i64) -> Result<Site, SiteError> {
        let _work = self.working().await;
        let site = self.site(id)?;
        if site.agent_access {
            // Forgotten here even if the site can't be told: it ends within 30 days.
            let _ = self.revoke_grant(&site, Grant::Agent).await;
        }
        self.db(|c| {
            self.delete_named(c, &Grant::Agent.secret(id))?;
            sites::set_agent(c, id, None)
        })?;
        self.notify();
        self.site(id)
    }

    /// A tool call from an agent on the socket. Reads use the app's grant;
    /// changes use the agents' grant, so the site's approvals decide.
    pub async fn agent_call(
        &self,
        site: &str,
        tool: &str,
        args: Value,
    ) -> Result<Value, SiteError> {
        let site = self.find_site(site)?;
        if site.mode != Mode::ClassicMonks || !has_tool(&site, tool) {
            return Err(plain(format!("{} has no {tool} tool.", site.name)));
        }
        let read_only = site.capabilities["read_only"]
            .as_array()
            .is_some_and(|r| r.iter().any(|t| t == tool));
        if read_only {
            return self.call_ability(site.id, tool, args).await;
        }
        if !site.agent_access {
            return Err(plain(NO_AGENT_ACCESS));
        }
        let _work = self.working().await;
        // A change is never sent twice: the site may have made it.
        let reply = self
            .mcp(
                &site,
                Grant::Agent,
                "tools/call",
                json!({ "name": tool, "arguments": args }),
                Retry::Write,
            )
            .await?;
        tool_output(reply)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::Options;
    use crate::connect::AGENT_ACCESS_ENDED;
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

    fn called(site: &TestSite, tool: &str) -> usize {
        site.state().calls.iter().filter(|(t, _)| t == tool).count()
    }

    #[tokio::test]
    async fn a_change_waits_for_the_sites_approval_then_runs_once() {
        let (_h, core) = core().await;
        let site = TestSite::start().await;
        let s = core.add_site_oauth(&site.url, browser).await.unwrap();
        let edit = json!({ "plugin_file": "woocommerce/woocommerce.php" });

        let err = core
            .agent_call(&s.url, "activate-plugin", edit.clone())
            .await
            .unwrap_err();
        assert_eq!(err.to_string(), NO_AGENT_ACCESS);
        assert_eq!(called(&site, "activate-plugin"), 0);

        let s = core.add_agent_access(s.id, browser).await.unwrap();
        assert!(s.agent_access);
        assert_eq!(site.state().agent_grants(), 1);
        assert_eq!(site.state().live_grants(), 2);

        let err = core
            .agent_call("Test Site", "activate-plugin", edit.clone())
            .await
            .unwrap_err();
        let SiteError::NeedsApproval { approve_url, .. } = &err else {
            panic!("{err}")
        };
        assert!(approve_url.ends_with("page=cm-ai-approve&op=40"));
        assert!(err.to_string().contains(approve_url.as_str()));
        assert_eq!(called(&site, "activate-plugin"), 0);

        site.state().approve_all();
        core.agent_call(&s.url, "activate-plugin", edit.clone())
            .await
            .unwrap();
        assert_eq!(called(&site, "activate-plugin"), 1);
        // Approved once: the same change again asks again.
        assert!(matches!(
            core.agent_call(&s.url, "activate-plugin", edit.clone())
                .await,
            Err(SiteError::NeedsApproval { .. })
        ));

        // Reads still use the app's grant, with no approval.
        let host = s.url.split_once("://").unwrap().1.to_string();
        assert!(
            core.agent_call(&host, "get-site-snapshot", json!({}))
                .await
                .unwrap()["plugins"]
                .is_array()
        );

        let s = core.remove_agent_access(s.id).await.unwrap();
        assert!(!s.agent_access);
        assert_eq!(site.state().agent_grants(), 0);
        assert_eq!(site.state().live_grants(), 1);
        let err = core
            .agent_call(&s.url, "activate-plugin", edit)
            .await
            .unwrap_err();
        assert_eq!(err.to_string(), NO_AGENT_ACCESS);
    }

    #[tokio::test]
    async fn an_operator_sign_in_is_given_back() {
        let (_h, core) = core().await;
        let site = TestSite::start().await;
        let s = core.add_site_oauth(&site.url, browser).await.unwrap();
        site.state().agent_operator = true;
        let err = core.add_agent_access(s.id, browser).await.unwrap_err();
        assert_eq!(err.to_string(), AGENT_IS_OPERATOR);
        assert_eq!(site.state().agent_grants(), 0);
        assert!(!core.site(s.id).unwrap().agent_access);
    }

    #[tokio::test]
    async fn a_grant_the_site_ended_is_forgotten_and_the_app_keeps_working() {
        let (_h, core) = core().await;
        let site = TestSite::start().await;
        let s = core.add_site_oauth(&site.url, browser).await.unwrap();
        core.add_agent_access(s.id, browser).await.unwrap();
        // The owner removes the agents' connection on the site.
        site.state().end_agent_grants();
        let err = core
            .agent_call(&s.url, "activate-plugin", json!({ "id": 5 }))
            .await
            .unwrap_err();
        assert_eq!(err.to_string(), AGENT_ACCESS_ENDED);
        let s = core.site(s.id).unwrap();
        assert!(!s.agent_access && !s.sign_in_again);
        core.call_ability(s.id, "get-site-snapshot", json!({}))
            .await
            .unwrap();
    }

    #[tokio::test]
    async fn removing_a_site_signs_both_grants_out() {
        let (_h, core) = core().await;
        let site = TestSite::start().await;
        let s = core.add_site_oauth(&site.url, browser).await.unwrap();
        core.add_agent_access(s.id, browser).await.unwrap();
        // Turning it on again swaps the grant.
        core.add_agent_access(s.id, browser).await.unwrap();
        assert_eq!(site.state().agent_grants(), 1);
        core.remove_site(s.id).await.unwrap();
        assert_eq!(site.state().live_grants(), 0);
        let left: i64 = core
            .db(|c| c.query_row("SELECT count(*) FROM credentials", [], |r| r.get(0)))
            .unwrap();
        assert_eq!(left, 0);
    }

    #[tokio::test]
    async fn basic_mode_sites_get_no_agent_access() {
        let (_h, core) = core().await;
        let site = TestSite::start().await;
        let password = site.state().app_password.clone();
        let s = core
            .add_site_basic(&site.url, "admin", &password)
            .await
            .unwrap();
        assert!(core.add_agent_access(s.id, browser).await.is_err());
        assert!(core.find_site("nowhere").is_err());
    }
}
