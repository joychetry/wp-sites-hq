// SPDX-License-Identifier: GPL-3.0-or-later
// AI apps and Monks Central (plan Phase 5): plans AI agents proposed, waiting
// for you to confirm them; which sites agents may change; the activity log of
// who did what; and how to connect an AI app with `monks mcp`.
import "../styles/screens/ai.css";
import { Empty, Skeleton, toast } from "../components/feedback";
import { Page } from "../components/page";
import { Tabs } from "../components/controls";
import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import { ago, api, useInventory, type Entry, type Job, type JobItem, type Site } from "../api";
import { Button, Glyph, HeadActions, Status } from "../components/ui";
import { Sheet } from "../components/Sheet";
import { SiteTile } from "../components/SiteTile";
import { ChangeTile } from "../components/PkgTile";
import { said, when } from "./Overview";

type Tab = "plans" | "access" | "activity";
type Note = { text: string; ok: boolean };

const RESULT: Record<Exclude<Entry["outcome"], "done">, [string, "danger" | "warning"]> = {
  failed: ["Failed", "danger"],
  refused: ["Refused", "danger"],
  waiting: ["Waiting for you", "warning"],
};
const PER_PAGE = 50;
const CLAUDE = "claude mcp add monks-central -- monks mcp";
const CONFIG = '{ "mcpServers": { "monks-central": { "command": "monks", "args": ["mcp"] } } }';

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
const sitesIn = (j: Job) => new Set(j.items.map((i) => i.site_name)).size;
// Results float as toasts, so nothing above the plans moves under the pointer.
const note = (n: Note) => toast(n.text, { tone: n.ok ? "ok" : "danger" });

/** `focusPlan`: the plan the palette asked to review gets focus. */
type Props = { sites: Site[]; plans: Job[]; onWatch: (job: Job) => void; focusPlan?: number | null };

export function Ai({ sites, plans, onWatch, focusPlan }: Props) {
  const [tab, setTab] = useState<Tab>("plans");
  const [connect, setConnect] = useState(false);
  const live = plans.filter((p) => !p.expired).length;
  const tabs: { id: Tab; label: ReactNode }[] = [
    {
      id: "plans",
      label: (
        <>
          Plans to confirm
          {live > 0 && (
            <>
              <span className="sr-only"> (</span>
              <span className="cnt">{live}</span>
              <span className="sr-only">)</span>
            </>
          )}
        </>
      ),
    },
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
          <Plans plans={plans} sites={sites} onWatch={onWatch} focusPlan={focusPlan} />
        ) : tab === "access" ? (
          <Access sites={sites} full />
        ) : (
          <Log />
        )}
        <div className="stack">
          {tab === "plans" && <Access sites={sites} />}
          <How />
        </div>
      </div>
      {connect && <Connect onClose={() => setConnect(false)} />}
    </Page>
  );
}

type PlansProps = { plans: Job[]; sites: Site[]; onWatch: (j: Job) => void; focusPlan?: number | null };

function Plans({ plans, sites, onWatch, focusPlan }: PlansProps) {
  const [busy, setBusy] = useState<number | null>(null);
  const focused = useRef<HTMLHeadingElement>(null);
  useEffect(() => focused.current?.focus(), [focusPlan]);
  if (plans.length === 0)
    return (
      <section className="card">
        <Empty picture="done" title="No plans waiting">
          <p>When an AI agent wants to change a site, its plan shows up here first. Nothing runs until you confirm it, and no AI app can confirm it for you.</p>
        </Empty>
      </section>
    );
  const decide = async (plan: Job, confirm: boolean) => {
    setBusy(plan.id);
    try {
      if (confirm) onWatch(await api.confirmPlan(plan.id));
      else {
        await api.declinePlan(plan.id);
        note({ text: plan.expired ? `Removed "${plan.title}". Nothing changed.` : `Declined "${plan.title}". Nothing changed.`, ok: true });
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
                <b>AI agent</b>
                <small>Connected AI app · asked {ago(p.created_at)}</small>
              </div>
              {p.expired ? <span className="tag">Expired</span> : <span className="tag warning">Waiting for you</span>}
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
                  <Button kind="primary" className="disc" disabled={busy === p.id} aria-label={`Confirm and run ${plural(p.items.length, "change")}: ${p.title}`} onClick={() => decide(p, true)}>
                    {busy === p.id ? "Starting…" : `Confirm and run ${plural(p.items.length, "change")}`}
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
  if (!to) return <code>{from}</code>;
  return (
    <span className="vdiff">
      <code className="old">{from ?? "not known"}</code>
      <Glyph name="arrow" />
      <span className="sr-only">to</span>
      <code className="new">{to}</code>
    </span>
  );
}

function accessWord(s: Site): string {
  if (s.mode === "basic") return "Needs Classic Monks";
  if (s.sign_in_again) return "Sign in again first";
  return s.agent_access ? "Can change, with your approval on the site" : "Can read only";
}

/** Agent access per site: a switch each. `full` (the Agent access tab) says what each one means. */
function Access({ sites, full }: { sites: Site[]; full?: boolean }) {
  const [busy, setBusy] = useState<number | null>(null);
  const flip = async (s: Site) => {
    setBusy(s.id);
    if (!s.agent_access) note({ text: `Finish in your browser: sign in to ${s.name}, leave "This is my Monks Central app (operator)" unticked, then press Connect.`, ok: true });
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
      setBusy(null);
    }
  };
  return (
    <section className="card access" aria-labelledby="access-t">
      <div className="card-head">
        <h2 id="access-t">
          <Glyph name="lock" />
          Agent access
        </h2>
      </div>
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
                  <span className="dim">{s.agent_access ? "On" : "Off"}</span>
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
            Everything an agent ran shows in Activity, beside your own changes.
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
    <section className="card log" aria-labelledby="log-t">
      <div className="card-head">
        <h2 id="log-t">Activity</h2>
        <span className="dim">Everything done through Monks Central, newest first</span>
      </div>
      {error ? (
        <Empty alert title="The activity log didn't load." action={<Button onClick={load}>Try again</Button>}>
          <p>{error}</p>
        </Empty>
      ) : !rows ? (
        <Skeleton label="Reading the activity log…" />
      ) : rows.length === 0 ? (
        <p className="quiet">Nothing in the log yet. Changes you make here, and anything an AI app asks Monks Central to do, show here with who started them.</p>
      ) : (
        <ul className="feed" aria-label="Activity">
          {rows.map((r) => (
            <li key={r.id}>
              <span className={`av ${r.actor === "human" ? "me" : "ai"}`} aria-hidden="true">
                {r.actor === "human" ? "You" : <Glyph name="sparkle" />}
              </span>
              <p>
                {said(r, inventory)}
                {r.site_name ? (
                  <>
                    {" "}
                    on <b>{r.site_name}</b>.
                  </>
                ) : (
                  " on several sites."
                )}
                {r.detail && <span className="why">{r.detail}</span>}
                <time dateTime={new Date(r.at * 1000).toISOString()} data-tip={new Date(r.at * 1000).toLocaleString()}>
                  {when(r.at)}
                </time>
              </p>
              {r.outcome !== "done" && <Status tone={RESULT[r.outcome][1]}>{RESULT[r.outcome][0]}</Status>}
            </li>
          ))}
        </ul>
      )}
      {more && (
        <div className="card-foot">
          <span className="sum">
            {rows!.length} {rows!.length === 1 ? "entry" : "entries"} shown
          </span>
          <Button small onClick={older}>
            Show older entries
          </Button>
        </div>
      )}
    </section>
  );
}

/** The settings snippet as the design draws it: indented, the server's name picked out. */
const SNIPPET = (
  <>
    {"{\n  \"mcpServers\": {\n    "}
    <em>"monks-central"</em>
    {': {\n      "command": "monks",\n      "args": ["mcp"]\n    }\n  }\n}'}
  </>
);

function Connect({ onClose }: { onClose: () => void }) {
  const copy = (text: string, what: string) =>
    navigator.clipboard.writeText(text).then(
      () => note({ text: `Copied ${what}.`, ok: true }),
      () => note({ text: "Couldn't copy. Select the text and copy it yourself.", ok: false }),
    );
  return (
    <Sheet dialog title="Connect an AI app" intro="Add Monks Central to any app that takes MCP servers. It works while this app is open, and starts on its own when it isn't." onClose={onClose}>
      <div className="connect">
        <div className="snip">
          <span className="label">Claude Code</span>
          <code className="code">{CLAUDE}</code>
          <Button small onClick={() => copy(CLAUDE, "the Claude Code command")}>
            Copy
            <Glyph name="copy" />
          </Button>
        </div>
        <div className="snip">
          <span className="label">Other apps: connection snippet</span>
          <code className="code">
            {SNIPPET}
          </code>
          <Button small onClick={() => copy(CONFIG, "the settings")}>
            Copy
            <Glyph name="copy" />
          </Button>
        </div>
        <p className="callout">
          <Glyph name="lock" />
          <span>
            The app changes only sites you switch on in <b>Agent access</b>, and every change on several sites waits for you here.
          </span>
        </p>
      </div>
    </Sheet>
  );
}
