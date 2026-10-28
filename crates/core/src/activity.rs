// SPDX-License-Identifier: GPL-3.0-or-later
//! Monks Central's own log of what was done through it, and who started it:
//! the person in the app, or an AI agent (plan 5.8). Each site's Classic Monks
//! keeps its own log too; this one covers every site, Basic mode included.

use rusqlite::params;
use serde::{Deserialize, Serialize};

use crate::connect::SiteError;
use crate::{Changed, Core};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Actor {
    /// The person in the app window.
    Human,
    /// An AI agent or script on the socket.
    Agent,
    /// An agent's plan that a person confirmed in the app.
    AgentConfirmed,
}

impl Actor {
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Actor::Human => "human",
            Actor::Agent => "agent",
            Actor::AgentConfirmed => "agent_confirmed",
        }
    }

    pub(crate) fn parse(s: &str) -> Self {
        match s {
            "agent" => Actor::Agent,
            "agent_confirmed" => Actor::AgentConfirmed,
            _ => Actor::Human,
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Outcome {
    Done,
    Failed,
    /// Monks Central said no before anything was sent.
    Refused,
    /// Waiting for a person: a plan to confirm, or a change to approve on the site.
    Waiting,
}

impl Outcome {
    fn as_str(self) -> &'static str {
        match self {
            Outcome::Done => "done",
            Outcome::Failed => "failed",
            Outcome::Refused => "refused",
            Outcome::Waiting => "waiting",
        }
    }

    fn parse(s: &str) -> Self {
        match s {
            "done" => Outcome::Done,
            "refused" => Outcome::Refused,
            "waiting" => Outcome::Waiting,
            _ => Outcome::Failed,
        }
    }

    /// How a call went: done, waiting for the site's approval, refused here, or failed.
    pub fn of<T>(r: &Result<T, SiteError>) -> (Self, String) {
        match r {
            Ok(_) => (Outcome::Done, String::new()),
            Err(e @ SiteError::NeedsApproval { .. }) => (Outcome::Waiting, e.to_string()),
            Err(SiteError::Plain(m)) if m == crate::fleet::NO_AGENT_ACCESS => {
                (Outcome::Refused, m.clone())
            }
            Err(e) => (Outcome::Failed, e.to_string()),
        }
    }
}

#[derive(Debug, Clone, Serialize)]
pub struct Entry {
    pub id: i64,
    pub at: i64,
    pub actor: Actor,
    pub site_id: Option<i64>,
    pub site_name: String,
    pub what: String,
    pub outcome: Outcome,
    pub detail: String,
}

/// Rows the window shows at a time.
pub const PER_PAGE: u32 = 50;

impl Core {
    /// Add a row. Never fails the action it records.
    pub fn record(
        &self,
        actor: Actor,
        site: Option<i64>,
        what: &str,
        outcome: Outcome,
        detail: &str,
    ) {
        let name = site
            .and_then(|id| self.site(id).ok())
            .map(|s| s.name)
            .unwrap_or_default();
        let _ = self.db(|c| {
            c.execute(
                "INSERT INTO activity (actor, site_id, site_name, what, outcome, detail)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
                params![actor.as_str(), site, name, what, outcome.as_str(), detail],
            )
        });
        let _ = self.changed.send(Changed::Activity);
    }

    /// Record how a call went, and hand its result on.
    pub fn record_result<T>(
        &self,
        actor: Actor,
        site: Option<i64>,
        what: &str,
        r: Result<T, SiteError>,
    ) -> Result<T, SiteError> {
        let (outcome, detail) = Outcome::of(&r);
        self.record(actor, site, what, outcome, &detail);
        r
    }

    /// The newest rows, older than `before` when given.
    pub fn activity_log(&self, before: Option<i64>) -> Result<Vec<Entry>, SiteError> {
        self.db(|c| {
            let mut stmt = c.prepare_cached(
                "SELECT id, at, actor, site_id, site_name, what, outcome, detail FROM activity
                 WHERE ?1 IS NULL OR id < ?1 ORDER BY id DESC LIMIT ?2",
            )?;
            stmt.query_map(params![before, PER_PAGE], |r| {
                Ok(Entry {
                    id: r.get(0)?,
                    at: r.get(1)?,
                    actor: Actor::parse(&r.get::<_, String>(2)?),
                    site_id: r.get(3)?,
                    site_name: r.get(4)?,
                    what: r.get(5)?,
                    outcome: Outcome::parse(&r.get::<_, String>(6)?),
                    detail: r.get(7)?,
                })
            })?
            .collect()
        })
    }
}
