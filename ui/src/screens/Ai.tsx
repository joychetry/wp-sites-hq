// SPDX-License-Identifier: GPL-3.0-or-later
// AI apps and WP Sites HQ (plan Phase 5): plans AI agents proposed, waiting
// for you to confirm them; which sites agents may change; the activity log of
// who did what; and how to connect an AI app with `wpshq mcp`.
import "../styles/screens/ai.css";
import { askOpenSite, askSignIn, dismiss, Empty, Skeleton, toast } from "../components/feedback";
import { Page } from "../components/page";
import { Select, Tabs } from "../components/controls";
import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { ago, api, useInventory, type Entry, type Job, type JobItem, type Site } from "../api";
import { Button, Details, Glyph, HeadActions, Status } from "../components/ui";
import { Sheet } from "../components/Sheet";
import { SiteTile } from "../components/SiteTile";
import { ChangeTile } from "../components/PkgTile";
import { said } from "./Overview";
import { showApprovals, toolLabel } from "./ClassicMonks";
import { day, dayTime } from "../format";

type Tab = "plans" | "access" | "activity";
type Note = { text: string; ok: boolean };

const RESULT: Record<Exclude<Entry["outcome"], "done">, [string, "danger" | "warning"]> = {
  failed: ["Failed", "danger"],
  refused: ["Refused", "danger"],
  waiting: ["Waiting for approval on the site", "warning"],
};
const PER_PAGE = 50;
/** A site's note written for the AI app (a link and steps for it) shows only its first plain sentence. */
function plainDetail(detail: string): string {
  if (!/https?:\/\//.test(detail)) return detail;
  const first = detail.split(/(?<=\.)\s+/)[0];
  return /https?:\/\//.test(first) ? "The site sent steps for the AI app." : first;
}
const CLAUDE = "claude mcp add wp-sites-hq -- wpshq mcp";
const CONFIG = '{ "mcpServers": { "wp-sites-hq": { "command": "wpshq", "args": ["mcp"] } } }';

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
const sitesIn = (j: Job) => new Set(j.items.map((i) => i.site_name)).size;
// Results float as toasts, so nothing above the plans moves under the pointer.
const note = (n: Note) => toast(n.text, { tone: n.ok ? "ok" : "danger" });

/** `focusPlan`: the plan the palette asked to review gets focus. `onApprovals` opens Classic Monks (on the site ``showApprovals`` names). */
type Props = { sites: Site[]; plans: Job[]; onWatch: (job: Job) => void; focusPlan?: number | null; onApprovals?: () => void; tab?: Tab };

export function Ai({ sites, plans, onWatch, focusPlan, onApprovals, tab: opening = "plans" }: Props) {
  const [tab, setTab] = useState<Tab>(opening);
  const [connect, setConnect] = useState(false);
  const live = plans.filter((p) => !p.expired).length;
  const tabs: { id: Tab; label: string; count?: number }[] = [
    { id: "plans", label: "Plans to confirm", count: live },
    { id: "access", label: "Agent access" },
    { id: "activity", label: "Activity" },
  ];
  return (
    <Page className="ai">
      <HeadActions>
        <Button onClick={() => setConnect(true)}>
          Connect an AI app
          <Glyph name="link" />
        </Button>
      </HeadActions>
      <Tabs label="Show" idBase="ai" tabs={tabs} value={tab} onChange={setTab} />
      <div role="tabpanel" id="ai-panel" aria-labelledby={`ai-tab-${tab}`} className="ov-split">
        {tab === "plans" ? (
          <Plans plans={plans} sites={sites} onWatch={onWatch} focusPlan={focusPlan} onConnect={() => setConnect(true)} />
        ) : tab === "access" ? (
          <Access sites={sites} full />
        ) : (
          <Log />
        )}
        <div className="stack">
          {tab === "plans" && <OnSites sites={sites} onApprovals={onApprovals} />}
          {tab === "plans" && <Access sites={sites} />}
          <How />
        </div>
      </div>
      {connect && (
        <Connect
          onClose={() => setConnect(false)}
          onAccess={() => {
            setConnect(false);
            setTab("access");
          }}
        />
      )}
    </Page>
  );
}

/** The other queue: single changes AI apps asked for on one site, approved on that site (Classic Monks, Waiting for approval). */
function OnSites({ sites, onApprovals }: { sites: Site[]; onApprovals?: () => void }) {
  const counts = sites.map((s) => [s, Number(s.capabilities.pending_approvals) || 0] as const).filter(([, n]) => n > 0);
  const n = counts.reduce((sum, [, k]) => sum + k, 0);
  return (
    <section className="card" aria-labelledby="onsites-t">
      <div className="card-body">
        <b id="onsites-t">Waiting for approval on a site</b>
        <p className="dim">
          {n === 0 ? "Nothing waits on a site now." : n === 1 ? "1 change waits on a site." : `${n} changes wait on their sites.`} When an AI app asks to change one site, you approve
          that single change on the site itself, not here.
        </p>
        {n > 0 && onApprovals && (
          <div>
            <Button
              small
              onClick={() => {
                showApprovals(counts[0][0].id);
                onApprovals();
              }}
            >
              Open Classic Monks
              <Glyph name="arrow" />
            </Button>
          </div>
        )}
      </div>
    </section>
  );
}

type PlansProps = { plans: Job[]; sites: Site[]; onWatch: (j: Job) => void; focusPlan?: number | null; onConnect: () => void };

function Plans({ plans: all, sites, onWatch, focusPlan, onConnect }: PlansProps) {
  // Live plans first: an expired one can only be removed.
  const plans = [...all].sort((a, b) => Number(a.expired) - Number(b.expired));
  const [busy, setBusy] = useState<number | null>(null);
  const focused = useRef<HTMLHeadingElement>(null);
  useEffect(() => focused.current?.focus(), [focusPlan]);
  if (plans.length === 0)
    return (
      <section className="card">
        <Empty
          picture="inbox"
          title="No plans waiting"
          action={
            <Button onClick={onConnect}>
              Connect an AI app
              <Glyph name="link" />
            </Button>
          }
        >
          <p>
            When an AI app wants to change several sites, its plan shows up here first. Nothing runs until you confirm it, and no AI app can confirm it for you.
            {sites.length === 0 && " Add a site on Sites first, so an AI app has something to work on."}
          </p>
        </Empty>
      </section>
    );
  const decide = async (plan: Job, confirm: boolean) => {
    setBusy(plan.id);
    try {
      if (confirm) onWatch(await api.confirmPlan(plan.id));
      else {
        await api.declinePlan(plan.id);
        note({ text: plan.expired ? `Removed “${plan.title}”. Nothing changed.` : `Declined “${plan.title}”. Nothing changed.`, ok: true });
      }
    } catch (e) {
      note({ text: String(e), ok: false });
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="stack">
      {plans.map((p) => {
        // A site's changes sit together, as the design's one box per site.
        const bySite = new Map<number | null, JobItem[]>();
        p.items.forEach((i) => bySite.set(i.site_id, [...(bySite.get(i.site_id) ?? []), i]));
        const stuck = [...bySite.keys()].map((id) => sites.find((s) => s.id === id)).filter((s): s is Site => !!s && (s.health === "down" || s.sign_in_again));
        return (
          <section key={p.id} className="card plan" aria-labelledby={`plan-${p.id}`}>
            <div className="card-head">
              <span className="av ai lg" aria-hidden="true">
                <Glyph name="sparkle" />
              </span>
              <div className="who">
                <b>{p.agent_app ?? "AI agent"}</b>
                <small>Connected AI app · asked {ago(p.created_at)}</small>
              </div>
              {p.expired ? <Status pill tone="unknown">Expired</Status> : <Status pill tone="warning">Waiting for you to confirm</Status>}
            </div>
            <div className="card-body">
              <div className="plan-t">
                <h2 id={`plan-${p.id}`} tabIndex={-1} ref={p.id === focusPlan ? focused : undefined}>
                  {p.title}
                </h2>
                <p>
                  {plural(p.items.length, "change")} on {plural(sitesIn(p), "site")}.
                  {p.expired && " Nobody confirmed it within 7 days, so it will never run. Ask the AI app to plan it again if you still want it."}
                </p>
              </div>
              <div className="plan-what">
                <span className="label">Exactly what will change</span>
                <ul className="ai-diffs" aria-label={`Changes in ${p.title}`}>
                  {[...bySite].map(([id, items]) => (
                    <li key={id ?? "gone"} className="ai-diff">
                      <div>
                        <span>Site</span>
                        <b>
                          <SiteTile site={{ id: id ?? 0, name: items[0].site_name, icon: sites.find((s) => s.id === id)?.icon }} size="sm" />
                          {items[0].site_name}
                        </b>
                      </div>
                      {items.map((i) => (
                        <div key={i.id}>
                          <span className="named">
                            <ChangeTile action={i.action} size="xs" />
                            {i.label}
                          </span>
                          <Diff from={i.from_version} to={i.to_version} />
                        </div>
                      ))}
                    </li>
                  ))}
                </ul>
                {stuck.map((s) => (
                  <p key={s.id} className="callout warning">
                    <Glyph name="alert" />
                    <span>
                      {s.sign_in_again ? (
                        <>
                          <b>Sign in to {s.name} again</b> before this can run there.
                        </>
                      ) : (
                        <>
                          <b>{s.name} couldn't be reached</b> at the last check.{s.health_detail && ` ${s.health_detail}`}
                        </>
                      )}
                    </span>
                  </p>
                ))}
              </div>
            </div>
            <div className="card-foot">
              <span className="sum">{p.expired ? "It never runs. Remove it to clear it away." : "Nothing runs until you confirm."}</span>
              {p.expired ? (
                <Button disabled={busy === p.id} aria-label={`Remove ${p.title}`} onClick={() => decide(p, false)}>
                  Remove
                </Button>
              ) : (
                <>
                  <Button disabled={busy === p.id} aria-label={`Decline ${p.title}`} onClick={() => decide(p, false)}>
                    Decline
                  </Button>
                  <Button kind="primary" className="disc" disabled={busy === p.id} aria-label={`Confirm and make ${plural(p.items.length, "change")}: ${p.title}`} onClick={() => decide(p, true)}>
                    {busy === p.id ? "Starting…" : `Confirm and make ${plural(p.items.length, "change")}`}
                    <span className="btn-disc">
                      <Glyph name="check" />
                    </span>
                  </Button>
                </>
              )}
            </div>
          </section>
        );
      })}
    </div>
  );
}

/** The design's version change: the old one struck through in red, the new one in green. */
function Diff({ from, to }: { from: string | null; to: string | null }) {
  if (!from && !to) return null;
  if (!to) return <code>version {from}</code>;
  return (
    <span className="vdiff">
      <code className="old">{from ?? "Not known"}</code>
      <Glyph name="arrow" />
      <span className="sr-only">to</span>
      <code className="new">{to}</code>
    </span>
  );
}

function accessWord(s: Site): string {
  if (s.mode === "basic") return "Needs the WP Sites HQ plugin";
  if (s.sign_in_again) return "Sign-in expired";
  return s.agent_access ? "Can change, with your approval on the site" : "Can read only";
}

/** Agent access per site: a switch each. `full` (the Agent access tab) says what each one means. */
function Access({ sites, full }: { sites: Site[]; full?: boolean }) {
  const [busy, setBusy] = useState<number | null>(null);
  const flip = async (s: Site) => {
    setBusy(s.id);
    const steps = s.agent_access ? null : toast(`Finish in your browser: sign in to ${s.name} and press Connect. Leave “This is my WP Sites HQ app” unchecked.`, { tone: "info", stay: true });
    try {
      if (s.agent_access) {
        await api.agentAccessOff(s.id);
        note({ text: `AI agents can only read ${s.name} now.`, ok: true });
      } else {
        await api.agentAccessOn(s.id);
        note({ text: `AI agents can change ${s.name} now. The site asks you to approve each change.`, ok: true });
      }
    } catch (e) {
      note({ text: String(e), ok: false });
    } finally {
      if (steps != null) dismiss(steps);
      setBusy(null);
    }
  };
  return (
    <section className="card access" aria-label="Agent access">
      {/* Under its own tab the title would only repeat the tab. */}
      {!full && (
        <div className="card-head">
          <h2>
            <Glyph name="lock" />
            Agent access
          </h2>
        </div>
      )}
      {full && (
        <p className="note" id="access-legend">
          AI agents read every Classic Monks site. Where you turn on access, they may also change it, and the site asks you to approve each change first. Changes on many sites always wait for you under Plans to confirm.
        </p>
      )}
      {sites.length === 0 ? (
        <p className="quiet">Add a site on Sites, then choose here whether AI agents may change it.</p>
      ) : (
        <ul aria-label="Agent access" aria-describedby={full ? "access-legend" : undefined}>
          {sites.map((s) => {
            const can = s.mode === "classic_monks" && !s.sign_in_again;
            const waiting = busy === s.id && !s.agent_access;
            return (
              <li key={s.id}>
                <SiteTile site={s} size="sm" />
                <label htmlFor={`access-${s.id}`} data-tip={s.url}>
                  <b>{s.name}</b>
                  {(full || !can) && <small>{accessWord(s)}</small>}
                </label>
                {waiting ? (
                  <>
                    <span className="dim">Waiting for the browser…</span>
                    <Button small onClick={() => api.cancelSignIn()}>
                      Cancel
                    </Button>
                  </>
                ) : (
                  !can &&
                  !s.agent_access && (
                    <Button small onClick={() => (s.sign_in_again ? askSignIn(s.id) : askOpenSite(s.id))}>
                      {s.sign_in_again ? "Sign in again" : "Get the plugin"}
                    </Button>
                  )
                )}
                <input
                  type="checkbox"
                  role="switch"
                  id={`access-${s.id}`}
                  aria-label={`Access for ${s.name}`}
                  checked={s.agent_access}
                  disabled={busy != null || (!can && !s.agent_access)}
                  onChange={() => flip(s)}
                />
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

function How() {
  return (
    <section className="card how" aria-labelledby="how-t">
      <div className="card-body">
        <b id="how-t">How agents work here</b>
        <ul>
          <li>
            <Glyph name="check" />
            An agent reads every Classic Monks site, and changes only sites you switch on. The site asks you first.
          </li>
          <li>
            <Glyph name="check" />
            Changes on several sites come here as a plan. You see each change on each site before it runs, and can decline any plan.
          </li>
          <li>
            <Glyph name="check" />
            Everything an agent did or asked for shows under Activity on this page, beside your own changes.
          </li>
        </ul>
      </div>
    </section>
  );
}

function Log() {
  const [rows, setRows] = useState<Entry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const { inventory } = useInventory();
  const load = useCallback(() => {
    api.activityLog().then(
      (r) => {
        setRows(r);
        setMore(r.length === PER_PAGE);
        setError(null);
      },
      (e) => setError(String(e)),
    );
  }, []);
  useEffect(() => {
    load();
    const off = listen("activity-changed", load);
    return () => {
      off.then((f) => f()).catch(() => {});
    };
  }, [load]);
  const older = async () => {
    if (!rows?.length) return;
    const next = await api.activityLog(rows[rows.length - 1].id).catch((e) => {
      setError(String(e));
      return [];
    });
    // The log may have been read again meanwhile: add to what shows now, once each.
    setRows((now) => [...(now ?? []), ...next.filter((e) => !now?.some((x) => x.id === e.id))]);
    setMore(next.length === PER_PAGE);
  };
  return (
    <section className="card log" aria-label="Activity">
      <div className="card-head">
        <span className="dim">Everything done through WP Sites HQ, newest first</span>
      </div>
      {error ? (
        <Empty alert title="The activity log didn't load" action={<Button onClick={load}>Try again</Button>}>
          <p>{error}</p>
        </Empty>
      ) : !rows ? (
        <Skeleton label="Reading the activity log…" />
      ) : rows.length === 0 ? (
        <p className="quiet">Nothing in the log yet. Changes you make here, and anything an AI app asks WP Sites HQ to do, show here with who started them.</p>
      ) : (
        <ul className="feed" aria-label="Activity">
          {rows.map((r) => {
            // A single change waiting on its site: the AI app asked, nothing ran yet, and the site has the decision.
            const asked = r.outcome === "waiting" && r.actor === "agent" && !(r.what.includes(" ") && /ed$/.test(r.what.split(" ")[0]));
            const op = r.site_id != null ? /[?&]op=(\d+)/.exec(r.detail)?.[1] : undefined;
            return (
            <li key={r.id}>
              <span className={`av ${r.actor === "human" ? "me" : "ai"}`} aria-hidden="true">
                {r.actor === "human" ? "You" : <Glyph name="sparkle" />}
              </span>
              <div>
                <p>
                  {asked ? (
                    <>
                      An AI agent asked to <b>{r.what.includes(" ") ? r.what : toolLabel(r.what)}</b>
                    </>
                  ) : (
                    said(r, inventory)
                  )}
                  {r.site_name ? (
                    <>
                      {" "}
                      on <b>{r.site_name}</b>.
                    </>
                  ) : / on \d+ sites?$/.test(r.what) ? (
                    "."
                  ) : (
                    " on several sites."
                  )}
                  {r.detail && !op && <span className="why">{plainDetail(r.detail)}</span>}
                  <time dateTime={new Date(r.at * 1000).toISOString()} data-tip={day(r.at)}>
                    {dayTime(r.at)}
                  </time>
                </p>
                {op ? (
                  <div>
                    <Button
                      small
                      onClick={() =>
                        api.openApproval(r.site_id!, Number(op)).then(
                          () => note({ text: `Opened the approval page on ${r.site_name} in your browser.`, ok: true }),
                          (e) => note({ text: String(e), ok: false }),
                        )
                      }
                    >
                      Approve or decline on the site
                      <Glyph name="external" />
                    </Button>
                  </div>
                ) : (
                  r.detail && plainDetail(r.detail) !== r.detail && <Details>{r.detail}</Details>
                )}
              </div>
              {r.outcome === "done" ? (
                <Status tone="ok">Done</Status>
              ) : r.outcome === "waiting" && r.site_id == null ? (
                // A plan for several sites waits here, not on a site.
                <Status tone="warning">Waiting for you to confirm</Status>
              ) : (
                <Status tone={RESULT[r.outcome][1]}>{RESULT[r.outcome][0]}</Status>
              )}
            </li>
            );
          })}
        </ul>
      )}
      {more && (
        <div className="card-foot">
          <span className="sum">{rows!.length} shown</span>
          <Button small onClick={older}>
            Show older activity
          </Button>
        </div>
      )}
    </section>
  );
}

/** The settings as the design draws them: indented, the server's name picked out. */
const SETTINGS = (
  <>
    {"{\n  \"mcpServers\": {\n    "}
    <em>"wp-sites-hq"</em>
    {': {\n      "command": "wpshq",\n      "args": ["mcp"]\n    }\n  }\n}'}
  </>
);

type App = "code" | "desktop" | "cursor" | "other";
const APPS: { id: App; label: string }[] = [
  { id: "code", label: "Claude Code" },
  { id: "desktop", label: "Claude Desktop" },
  { id: "cursor", label: "Cursor" },
  { id: "other", label: "Other apps" },
];
const ASK = "Then ask it: “Which WordPress sites can you see?” It should name your sites.";
/** Where each app takes WP Sites HQ, after the copy step. */
const STEPS: Record<App, string[]> = {
  code: ["Paste it in a terminal and press Enter.", `Start Claude Code. ${ASK}`],
  desktop: ["In Claude Desktop, open Settings, then Developer, then Edit Config.", "Paste the settings into that file (keep anything already there inside its “mcpServers”) and save it.", `Quit and reopen Claude Desktop. ${ASK}`],
  cursor: ["In Cursor, open Settings, then MCP, then Add new global MCP server.", "Paste the settings into the file that opens and save it.", `Open a chat. ${ASK}`],
  other: ["Find where the app adds MCP servers (tools it can use), usually in its settings.", "Paste the settings there and save.", `Restart the app if it asks. ${ASK}`],
};

function Connect({ onClose, onAccess }: { onClose: () => void; onAccess: () => void }) {
  const [app, setApp] = useState<App>("code");
  const [opened] = useState(() => Math.floor(Date.now() / 1000));
  const [seen, setSeen] = useState(0);
  // The core notes when an AI app last asked it for something: read it while the dialog is open.
  useEffect(() => {
    const read = () => api.status().then((s) => setSeen(s?.agent_seen ?? 0), () => {});
    read();
    const timer = setInterval(read, 2000);
    return () => clearInterval(timer);
  }, []);
  const copy = (text: string, what: string) =>
    navigator.clipboard.writeText(text).then(
      () => note({ text: `Copied ${what}.`, ok: true }),
      () => note({ text: "Couldn't copy. Select the text and copy it yourself.", ok: false }),
    );
  const command = app === "code";
  return (
    <Sheet
      dialog
      title="Connect an AI app"
      intro="Add WP Sites HQ to an AI app on this computer. It works while this app is open, and starts on its own when it isn't."
      onClose={onClose}
      footer={
        <Button kind="primary" onClick={onClose}>
          Done
        </Button>
      }
    >
      <div className="connect">
        <label className="field">
          <span>Your AI app</span>
          <Select aria-label="Your AI app" value={app} onChange={(e) => setApp(e.target.value as App)}>
            {APPS.map((a) => (
              <option key={a.id} value={a.id}>
                {a.label}
              </option>
            ))}
          </Select>
        </label>
        <ol className="steps">
          <li>
            <span>{command ? "Copy this command." : "Copy these settings."}</span>
            <code className="code">{command ? CLAUDE : SETTINGS}</code>
            <Button small onClick={() => (command ? copy(CLAUDE, "the Claude Code command") : copy(CONFIG, "the settings"))}>
              Copy
              <Glyph name="copy" />
            </Button>
          </li>
          {STEPS[app].map((step) => (
            <li key={step}>
              <span>{step}</span>
            </li>
          ))}
        </ol>
        <p className="callout" role="status">
          <Glyph name={seen >= opened ? "check" : "clock"} />
          <span>
            {seen >= opened
              ? "Connected: an AI app just asked WP Sites HQ for your sites."
              : seen > 0
                ? `Waiting for the app. An AI app last used WP Sites HQ ${ago(seen)}.`
                : "Waiting for the app. This says Connected once it first asks for your sites."}
          </span>
        </p>
        <p className="callout">
          <Glyph name="lock" />
          <span>
            Every change on several sites waits for you under Plans to confirm, and the app changes only the sites you switch on in{" "}
            <button type="button" className="link" onClick={onAccess}>
              Agent access
            </button>
          </span>
        </p>
      </div>
    </Sheet>
  );
}
