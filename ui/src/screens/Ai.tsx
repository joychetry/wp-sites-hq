// AI apps and Monks Central (plan Phase 5): plans AI agents proposed, waiting
// for you to confirm them; which sites agents may change; the activity log of
// who did what; and how to connect an AI app with `monks mcp`.
import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { ago, api, type Entry, type Job, type Site } from "../api";
import { Button, Status } from "../components/ui";
import { Versions } from "../components/JobSheet";

type Tab = "plans" | "access" | "activity" | "connect";
type Note = { text: string; ok: boolean };

const WHO: Record<Entry["actor"], string> = {
  human: "You",
  agent: "AI agent",
  agent_confirmed: "AI agent, confirmed by you",
};
const RESULT: Record<Entry["outcome"], [string, "ok" | "danger" | "warning"]> = {
  done: ["Done", "ok"],
  failed: ["Failed", "danger"],
  refused: ["Refused", "danger"],
  waiting: ["Waiting for you", "warning"],
};
const PER_PAGE = 50;
const CLAUDE = "claude mcp add monks-central -- monks mcp";
const CONFIG = '{ "mcpServers": { "monks-central": { "command": "monks", "args": ["mcp"] } } }';

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;
const sitesIn = (j: Job) => new Set(j.items.map((i) => i.site_name)).size;

/** `focusPlan`: the plan the palette asked to review gets focus. */
type Props = { sites: Site[]; plans: Job[]; onWatch: (job: Job) => void; focusPlan?: number | null };

export function Ai({ sites, plans, onWatch, focusPlan }: Props) {
  const [tab, setTab] = useState<Tab>("plans");
  const [note, setNote] = useState<Note | null>(null);
  const tabs: [Tab, string][] = [
    ["plans", plans.length ? `Plans to confirm (${plans.length})` : "Plans to confirm"],
    ["access", "Agent access"],
    ["activity", "Activity"],
    ["connect", "Connect an AI app"],
  ];
  return (
    <div className="scroll">
      <div className="bar">
        <div className="segmented types" role="group" aria-label="Show">
          {tabs.map(([t, label]) => (
            <button
              key={t}
              type="button"
              aria-pressed={t === tab}
              onClick={() => {
                setTab(t);
                setNote(null);
              }}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div role="status" className="notice">
        {note && <p className={`alert ${note.ok ? "ok" : "danger"}`}>{note.text}</p>}
      </div>
      {tab === "plans" ? (
        <Plans plans={plans} onNote={setNote} onWatch={onWatch} focusPlan={focusPlan} />
      ) : tab === "access" ? (
        <Access sites={sites} onNote={setNote} />
      ) : tab === "activity" ? (
        <Log />
      ) : (
        <Connect onNote={setNote} />
      )}
    </div>
  );
}

type PlansProps = { plans: Job[]; onNote: (n: Note) => void; onWatch: (j: Job) => void; focusPlan?: number | null };

function Plans({ plans, onNote, onWatch, focusPlan }: PlansProps) {
  const [busy, setBusy] = useState<number | null>(null);
  const focused = useRef<HTMLHeadingElement>(null);
  useEffect(() => focused.current?.focus(), [focusPlan]);
  if (plans.length === 0)
    return (
      <div className="empty">
        <h2>No plans are waiting.</h2>
        <p>When an AI app plans changes on your sites, the plan waits here. Nothing changes until you confirm it, and no AI app can confirm it for you.</p>
      </div>
    );
  const decide = async (plan: Job, confirm: boolean) => {
    setBusy(plan.id);
    try {
      if (confirm) onWatch(await api.confirmPlan(plan.id));
      else {
        await api.declinePlan(plan.id);
        onNote({ text: `Declined "${plan.title}". Nothing changed.`, ok: true });
      }
    } catch (e) {
      onNote({ text: String(e), ok: false });
    } finally {
      setBusy(null);
    }
  };
  return (
    <>
      <p className="legend" id="plans-legend">
        Changes an AI app proposed, oldest first. Each runs with your connection only after you confirm it. Versions show what each site runs now and what it moves to.
      </p>
      {plans.map((p) => (
        <section key={p.id} className="plan-card" aria-labelledby={`plan-${p.id}`} aria-describedby="plans-legend">
          <h2 id={`plan-${p.id}`} tabIndex={-1} ref={p.id === focusPlan ? focused : undefined}>
            {p.title}
          </h2>
          <p className="why">
            Proposed by an AI agent {ago(p.created_at)}. {plural(p.items.length, "change")} on {plural(sitesIn(p), "site")}.
          </p>
          <ul className="plan-list confirm" aria-label={`Changes in ${p.title}`}>
            {p.items.map((i) => (
              <li key={i.id}>
                <span className="grow">
                  <b>{i.site_name}</b>, {i.label}
                </span>
                <Versions from={i.from_version} to={i.to_version} />
              </li>
            ))}
          </ul>
          <div className="row">
            <Button disabled={busy === p.id} aria-label={`Decline ${p.title}`} onClick={() => decide(p, false)}>
              Decline
            </Button>
            <Button kind="primary" disabled={busy === p.id} aria-label={`Confirm and run ${plural(p.items.length, "change")}: ${p.title}`} onClick={() => decide(p, true)}>
              {busy === p.id ? "Starting…" : `Confirm and run ${plural(p.items.length, "change")}`}
            </Button>
          </div>
        </section>
      ))}
    </>
  );
}

function accessWord(s: Site): [string, "ok" | "unknown" | "warning"] {
  if (s.mode === "basic") return ["Needs Classic Monks", "unknown"];
  if (s.sign_in_again) return ["Sign in again first", "warning"];
  return s.agent_access ? ["Can change, with your approval on the site", "ok"] : ["Can read only", "unknown"];
}

function Access({ sites, onNote }: { sites: Site[]; onNote: (n: Note) => void }) {
  const [busy, setBusy] = useState<number | null>(null);
  if (sites.length === 0)
    return (
      <div className="empty">
        <h2>No sites yet.</h2>
        <p>Add a site on Sites, then choose here whether AI agents may change it.</p>
      </div>
    );
  const flip = async (s: Site) => {
    setBusy(s.id);
    if (!s.agent_access)
      onNote({ text: `Finish in your browser: sign in to ${s.name}, leave "This is my Monks Central app (operator)" unticked, then press Connect.`, ok: true });
    try {
      if (s.agent_access) {
        await api.agentAccessOff(s.id);
        onNote({ text: `AI agents can only read ${s.name} now.`, ok: true });
      } else {
        await api.agentAccessOn(s.id);
        onNote({ text: `AI agents can change ${s.name} now. The site asks you to approve each change.`, ok: true });
      }
    } catch (e) {
      onNote({ text: String(e), ok: false });
    } finally {
      setBusy(null);
    }
  };
  return (
    <>
      <p className="legend" id="access-legend">
        AI agents read every Classic Monks site. Where you turn on access, they may also change it, and the site asks you to approve each change first. Changes on many sites always wait for you under Plans to confirm.
      </p>
      <table className="t" aria-label="Agent access" aria-describedby="access-legend">
        <thead>
          <tr>
            <th scope="col">Site</th>
            <th scope="col">AI agents</th>
            <th scope="col">
              <span className="sr-only">Change access</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {sites.map((s) => {
            const [word, tone] = accessWord(s);
            const can = s.mode === "classic_monks" && !s.sign_in_again;
            return (
              <tr key={s.id}>
                <td title={s.url}>{s.name}</td>
                <td>
                  <Status tone={tone}>{word}</Status>
                </td>
                <td>
                  {(can || s.agent_access) && (
                    <span className="row">
                      <Button small disabled={busy != null} aria-label={`${s.agent_access ? "Turn off access" : "Turn on access"} for ${s.name}`} onClick={() => flip(s)}>
                        {busy === s.id ? (s.agent_access ? "Turning off…" : "Waiting for the browser…") : s.agent_access ? "Turn off access" : "Turn on access"}
                      </Button>
                      {busy === s.id && !s.agent_access && (
                        <Button small onClick={() => api.cancelSignIn()}>
                          Cancel
                        </Button>
                      )}
                    </span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </>
  );
}

function Log() {
  const [rows, setRows] = useState<Entry[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [more, setMore] = useState(false);
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
    setRows([...rows, ...next]);
    setMore(next.length === PER_PAGE);
  };
  if (error)
    return (
      <div className="empty" role="alert">
        <h2>The activity log didn't load.</h2>
        <p>{error}</p>
        <Button onClick={load}>Try again</Button>
      </div>
    );
  if (!rows)
    return (
      <p className="empty" role="status">
        Reading the activity log…
      </p>
    );
  if (rows.length === 0)
    return (
      <div className="empty">
        <h2>Nothing in the log yet.</h2>
        <p>Changes you make here, and anything an AI app asks Monks Central to do, show here with who started them.</p>
      </div>
    );
  return (
    <>
      <p className="legend" id="log-legend">
        Everything done through Monks Central on any site, newest first. Who says whether you started it, an AI agent did, or an AI agent proposed it and you confirmed it.
      </p>
      <table className="t" aria-label="Activity" aria-describedby="log-legend">
        <thead>
          <tr>
            <th scope="col">When</th>
            <th scope="col">Who</th>
            <th scope="col">Site</th>
            <th scope="col">What</th>
            <th scope="col">Result</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const [word, tone] = RESULT[r.outcome];
            return (
              <tr key={r.id}>
                <td title={new Date(r.at * 1000).toLocaleString()}>{ago(r.at)}</td>
                <td>{WHO[r.actor]}</td>
                <td>{r.site_name || "Several sites"}</td>
                <td>
                  {r.what}
                  {r.detail && <span className="why">{r.detail}</span>}
                </td>
                <td>
                  <Status tone={tone}>{word}</Status>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {more && (
        <div className="pager">
          <span>
            {rows.length} {rows.length === 1 ? "entry" : "entries"} shown
          </span>
          <Button small onClick={older}>
            Show older entries
          </Button>
        </div>
      )}
    </>
  );
}

function Connect({ onNote }: { onNote: (n: Note) => void }) {
  const copy = (text: string, what: string) =>
    navigator.clipboard.writeText(text).then(
      () => onNote({ text: `Copied ${what}.`, ok: true }),
      () => onNote({ text: "Couldn't copy. Select the text and copy it yourself.", ok: false }),
    );
  return (
    <div className="connect">
      <h2>Connect an AI app</h2>
      <p>
        Claude, Cursor, VS Code and other AI apps reach every site through one Monks Central server, <code>monks mcp</code>. It works while this app is open, and starts on its own when it isn't.
      </p>
      <h3>Claude Code</h3>
      <div className="code">
        <code>{CLAUDE}</code>
        <Button small onClick={() => copy(CLAUDE, "the Claude Code command")}>
          Copy
        </Button>
      </div>
      <h3>Other AI apps</h3>
      <p>Add this to the app's MCP settings file:</p>
      <div className="code">
        <code>{CONFIG}</code>
        <Button small onClick={() => copy(CONFIG, "the settings")}>
          Copy
        </Button>
      </div>
      <h3>What an AI app can do</h3>
      <ul>
        <li>Read every Classic Monks site: plugins, themes, content, users and more.</li>
        <li>Change one site only where you turned on agent access, and only after you approve the change on the site.</li>
        <li>Plan changes on many sites. A plan waits under Plans to confirm until you confirm it here. No AI app can confirm it.</li>
      </ul>
    </div>
  );
}
