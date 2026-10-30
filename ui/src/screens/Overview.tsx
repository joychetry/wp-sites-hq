// SPDX-License-Identifier: GPL-3.0-or-later
// Overview: what needs you across the fleet (docs/design/redesign, board 01). The fleet sentence is
// the page head's line; here are the stat cards, the fixes, your sites, the latest changes and versions.
import { ago, api, noTools, pluginName, siteStatus, slow, type Entry, type Job, type Monitor, type SecurityReport, type Site, type SiteInventory, useInventory } from "../api";
import { useEffect, useState, type ReactNode } from "react";
import { listen } from "@tauri-apps/api/event";
import { Button, Glyph, Icon, Kbd, Logo, Status, type GlyphName } from "../components/ui";
import { SiteTile } from "../components/SiteTile";
import { PkgTile, pkgNamed } from "../components/PkgTile";
import type { PlanRow } from "../components/JobSheet";
import { toolLabel } from "./ClassicMonks";
import { attention } from "../fleet";

export { attention, summary } from "../fleet";

const UNKNOWN = "not known yet";

/** One bar per value, then "5 sites on 7.1.3" for each. */
function Dist({ label, values, versions }: { label: string; values: string[]; versions?: boolean }) {
  const counts = new Map<string, number>();
  values.forEach((v) => counts.set(v, (counts.get(v) ?? 0) + 1));
  const rows = [...counts].sort((a, b) => b[1] - a[1] || b[0].localeCompare(a[0]));
  return (
    <>
      <h3>{label}</h3>
      <div className="seg" aria-hidden="true">
        {rows.map(([v, n]) => (
          <i key={v} style={{ flex: n }} />
        ))}
      </div>
      <p>
        {rows.map(([v, n]) => (
          <span key={v}>
            <b>{n}</b> {n === 1 ? "site" : "sites"}{" "}
            {v === UNKNOWN ? `where the version is ${UNKNOWN}` : <>on {versions ? <span className="mono">{v}</span> : v}</>}
          </span>
        ))}
      </p>
    </>
  );
}

type Props = {
  sites: Site[];
  /** Updates waiting, AI plans to confirm, security reports and monitors: the rest of what needs you. */
  waiting?: (PlanRow & { kind: string })[];
  plans?: Job[];
  reports?: SecurityReport[];
  monitors?: Monitor[];
  onOpen: (id: number) => void;
  onCheck: (id: number) => void;
  onSignInAgain: (id: number) => void;
  onAdd: () => void;
  /** Opens another part of the app, for the getting started steps and the fixes. */
  onGo?: (section: "Updates" | "AI" | "Sites" | "Security" | "palette") => void;
};

const TIPS = "mc-tips-hidden";

/** First run: what Monks Central does, in three steps, with the first one as the main button. */
function Welcome({ onAdd, onGo }: Pick<Props, "onAdd" | "onGo">) {
  return (
    <section className="welcome" aria-label="Getting started">
      <div className="card">
        <div className="empty">
          <span className="brand-disc" aria-hidden="true">
            <Logo />
          </span>
          <h2>Every WordPress site you look after, in one place</h2>
          <p>Monks Central checks your sites, keeps them updated and tells you what needs you. Add your first site to start.</p>
          <Button kind="primary" className="disc" aria-keyshortcuts="A" onClick={onAdd}>
            <span className="btn-disc">
              <Glyph name="plus" />
            </span>
            Add a site
          </Button>
          <p className="dim or">
            or press <Kbd>A</Kbd>
          </p>
          <ol className="steps-line" aria-label="Three steps">
            <li aria-current="step">
              <i>1</i>Add a site
            </li>
            <li>
              <i>2</i>Sign in once
            </li>
            <li>
              <i>3</i>See what needs you
            </li>
          </ol>
        </div>
      </div>
      <p className="dim">
        Your sign-ins stay on this computer, encrypted. Nothing goes to a Monks Central server. Press <Kbd>Ctrl K</Kbd> to find any page, site
        or action
        {onGo ? (
          <>
            {", or "}
            <button type="button" className="link" onClick={() => onGo("palette")}>
              open the command palette
            </button>
            .
          </>
        ) : (
          "."
        )}
      </p>
    </section>
  );
}

/** After the first site: a few next steps until they are done or hidden. */
function NextSteps({ sites, onGo, onAdd }: { sites: Site[]; onGo: NonNullable<Props["onGo"]>; onAdd: () => void }) {
  const [hidden, setHidden] = useState(() => localStorage.getItem(TIPS) === "1");
  const steps: [string, boolean, string, () => void][] = [
    ["Add more sites", sites.length > 1, "Add a site", onAdd],
    ["Put sites in groups, so the sidebar can show one group at a time", sites.some((s) => s.group), "Open Sites", () => onGo("Sites")],
    ["Review the updates waiting", false, "Open Updates", () => onGo("Updates")],
    ["Let an AI app plan work for you, with your confirmation", false, "Connect an AI app", () => onGo("AI")],
  ];
  // Only while the fleet is new; after that the steps are in the way.
  if (hidden || sites.length > 2 || steps.every(([, done]) => done)) return null;
  return (
    <section className="next-steps" aria-label="Next steps">
      <h2>Next steps</h2>
      <ul>
        {steps.map(([what, done, label, go]) => (
          <li key={what} className={done ? "done" : ""}>
            <Status tone={done ? "ok" : "unknown"}>
              {what}
              <span className="sr-only">{done ? ": done" : ": not done yet"}</span>
            </Status>
            {!done && (
              <Button small onClick={go}>
                {label}
              </Button>
            )}
          </li>
        ))}
      </ul>
      <Button
        small
        onClick={() => {
          localStorage.setItem(TIPS, "1");
          setHidden(true);
        }}
      >
        Hide these steps
      </Button>
    </section>
  );
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** A count split into coloured parts, with the words beside it (status is never colour alone). */
function Mix({ label, parts }: { label: string; parts: [string, number, string][] }) {
  const shown = parts.filter(([, n]) => n > 0);
  return (
    <>
      {shown.length > 0 && (
        <div className="mix" role="img" aria-label={`${label}: ${shown.map(([w, n]) => `${n} ${w}`).join(", ")}`}>
          {shown.map(([w, n, k]) => (
            <i key={w} className={k} style={{ flex: n }} />
          ))}
        </div>
      )}
      <ul className="mix-key">
        {shown.map(([w, n, k]) => (
          <li key={w} className={k}>
            <i aria-hidden="true" />
            <b>{n}</b> {w}
          </li>
        ))}
      </ul>
    </>
  );
}

function Stat({ label, icon, tone, n, unit, children }: { label: string; icon: GlyphName; tone?: string; n: number; unit: string; children?: ReactNode }) {
  return (
    <section className={`stat ${tone === "danger" && n > 0 ? "alert" : ""}`} aria-label={label}>
      <div className="stat-top">
        <h2 className="label">{label}</h2>
        <span className={`tile sm ${n > 0 ? (tone ?? "") : "neutral"}`}>
          <Glyph name={icon} />
        </span>
      </div>
      <p className="stat-n">
        <strong>{n}</strong> {unit}
      </p>
      {children}
    </section>
  );
}

/** One thing to fix: an icon tile, what is wrong, and the one step that fixes it. */
function Fix({ icon, tone, title, children, action }: { icon: GlyphName; tone: string; title: ReactNode; children: ReactNode; action: ReactNode }) {
  return (
    <li className="fix">
      <span className={`tile ${tone}`}>
        <Glyph name={icon} />
      </span>
      <div>
        <b>{title}</b>
        <span>{children}</span>
      </div>
      {action}
    </li>
  );
}

const WHO: Record<Entry["actor"], string> = { human: "You", agent: "An AI agent", agent_confirmed: "An AI agent, confirmed by you" };
const OUTCOME: Record<Entry["outcome"], string> = { done: "", failed: "It failed.", refused: "It was refused.", waiting: "It waits for you." };
const FEED = 6;

/** The design's feed sentence: "You turned on AI agent access", "An AI agent ran <b>Update post</b>". */
export function said(r: Entry, inventory?: Map<number, SiteInventory> | null) {
  const [verb] = r.what.split(" ");
  // The plugin or theme the change names, from what that site (or, for several sites, any site) runs.
  const runs = [...(inventory?.values() ?? [])].filter((i) => r.site_id == null || i.site_id === r.site_id).map((i) => i.inventory);
  const pkg = pkgNamed(r.what, runs);
  const tile = pkg && <PkgTile {...pkg} size="xs" />;
  // The log keeps past-tense phrases ("Turned on ...", "Proposed a plan: ...") and tool or job names ("update-post", "Update Yoast SEO").
  if (r.what.includes(" ") && /ed$/.test(verb)) {
    const phrase = `${r.what.charAt(0).toLowerCase()}${r.what.slice(1)}`;
    // The tile goes just before the name it shows: "confirmed the plan: Update [tile]Classic Editor".
    const at = pkg ? phrase.indexOf(pkg.name) : -1;
    return (
      <>
        {WHO[r.actor]}
        {r.actor === "agent_confirmed" ? "," : ""} {at < 0 ? phrase : phrase.slice(0, at)}
        {at >= 0 && tile}
        {at >= 0 && phrase.slice(at)}
      </>
    );
  }
  return (
    <>
      {WHO[r.actor]}
      {r.actor === "agent_confirmed" ? "," : ""} ran {tile}
      <b>{r.what.includes(" ") ? r.what : toolLabel(r.what)}</b>
    </>
  );
}

/** "Today, 10:42", "Yesterday, 17:20", "Oct 26, 11:15" in the computer's own clock format. */
export function when(unix: number, now = new Date()) {
  const d = new Date(unix * 1000);
  const time = d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const days = Math.round((new Date(now).setHours(0, 0, 0, 0) - new Date(d).setHours(0, 0, 0, 0)) / 86400000);
  if (days === 0) return `Today, ${time}`;
  if (days === 1) return `Yesterday, ${time}`;
  return `${d.toLocaleDateString([], { month: "short", day: "numeric" })}, ${time}`;
}

/** Latest changes from the activity log, with All, You and AI. */
function Feed({ onGo }: { onGo?: Props["onGo"] }) {
  const [rows, setRows] = useState<Entry[] | null>(null);
  const [error, setError] = useState(false);
  const [who, setWho] = useState<"All" | "You" | "AI">("All");
  const { inventory } = useInventory();
  useEffect(() => {
    const load = () => api.activityLog().then((r) => (setRows(r), setError(false)), () => setError(true));
    load();
    const off = listen("activity-changed", load);
    return () => {
      off.then((f) => f()).catch(() => {});
    };
  }, []);
  const shown = (rows ?? []).filter((r) => who === "All" || (who === "You") === (r.actor === "human")).slice(0, FEED);
  return (
    <section className="card" aria-labelledby="feed-t">
      <div className="card-head">
        <h2 id="feed-t">Latest changes</h2>
        <div className="segmented" role="group" aria-label="Who made the change">
          {(["All", "You", "AI"] as const).map((w) => (
            <button key={w} type="button" aria-pressed={who === w} onClick={() => setWho(w)}>
              {w}
            </button>
          ))}
        </div>
      </div>
      {error ? (
        <p className="quiet">The activity log didn't load. It reads again after the next change.</p>
      ) : rows && shown.length === 0 ? (
        <p className="quiet">{who === "All" ? "Nothing has changed through Monks Central yet." : `No changes by ${who === "You" ? "you" : "AI agents"} yet.`}</p>
      ) : (
        <ul className="feed">
          {shown.map((r) => (
            <li key={r.id}>
              <span className={`av ${r.actor === "human" ? "me" : "ai"}`} aria-hidden="true">
                {r.actor === "human" ? "You" : <Glyph name="sparkle" />}
              </span>
              <p>
                {said(r, inventory)}
                {r.site_name && (
                  <>
                    {" "}
                    on <b>{r.site_name}</b>
                  </>
                )}
                . {OUTCOME[r.outcome]}
                <time dateTime={new Date(r.at * 1000).toISOString()}>{when(r.at)}</time>
              </p>
            </li>
          ))}
        </ul>
      )}
      {onGo && (
        <div className="card-foot">
          <button type="button" className="link" onClick={() => onGo("AI")}>
            See all activity
            <Glyph name="arrow" />
          </button>
        </div>
      )}
    </section>
  );
}

const pct = (n: number | null | undefined) => (n == null ? "not yet" : `${n >= 99.95 || n === 0 ? n.toFixed(0) : n.toFixed(2)}%`);
const SHOW_SITES = 8;

export function Overview({ sites, waiting = [], plans = [], reports = [], monitors = [], onOpen, onCheck, onSignInAgain, onAdd, onGo }: Props) {
  const tone = (t: string) => sites.filter((s) => siteStatus(s).tone === t).length;
  const cm = sites.filter((s) => s.mode === "classic_monks").length;
  const approvals = sites.reduce((n, s) => n + (Number(s.capabilities.pending_approvals) || 0), 0);
  const needs = sites.filter((s) => attention(s));
  const slows = sites.filter(slow);
  const ids = new Set(sites.map((s) => s.id));
  const live = plans.filter((p) => !p.expired);
  const vulns = reports.filter((r) => ids.has(r.site_id)).flatMap((r) => r.vulnerabilities.map((v) => ({ ...v, site: sites.find((s) => s.id === r.site_id)!.name })));
  const kinds = (k: string) => waiting.filter((w) => w.kind === k).length;
  const updateSites = new Set(waiting.map((w) => w.site)).size;
  const mon = new Map(monitors.map((m) => [m.site_id, m]));
  // Sites that need you first, then the rest, as many as fit a glance.
  const listed = [...needs, ...sites.filter((s) => !attention(s))].slice(0, SHOW_SITES);
  const fixes = needs.length + (vulns.length ? 1 : 0) + (live.length ? 1 : 0) + (waiting.length ? 1 : 0);
  if (sites.length === 0)
    return (
      <div className="scroll page">
        <Welcome onAdd={onAdd} onGo={onGo} />
      </div>
    );
  return (
    <div className="scroll page">
      <div className="ov">
        {onGo && <NextSteps sites={sites} onGo={onGo} onAdd={onAdd} />}
        <div className="stats">
          <Stat label="Sites" icon="globe" n={sites.length} unit={sites.length === 1 ? "site connected" : "sites connected"}>
            <Mix
              label="Sites"
              parts={[
                ["up", tone("ok"), "k-up"],
                ["down", tone("danger"), "k-down"],
                ["need a look", tone("warning"), "k-sign"],
                ["not checked", tone("unknown"), "k-off"],
              ]}
            />
            <p className="stat-note">{plural(cm, "site")} through a plugin</p>
          </Stat>
          <Stat label="Updates waiting" icon="download" n={waiting.length} unit={waiting.length ? `on ${plural(updateSites, "site")}` : "nothing waiting"}>
            <Mix
              label="Updates waiting"
              parts={[
                ["core", kinds("WordPress"), "k-core"],
                [kinds("Plugin") === 1 ? "plugin" : "plugins", kinds("Plugin"), "k-plugin"],
                [kinds("Theme") === 1 ? "theme" : "themes", kinds("Theme"), "k-theme"],
                ["translations", kinds("Translations"), "k-off"],
              ]}
            />
          </Stat>
          <Stat label="Vulnerable plugins" icon="shield" tone="danger" n={vulns.length} unit={vulns.length ? (vulns.length === 1 ? "needs a fix" : "need a fix") : "none known"}>
            <p className="stat-note">
              {vulns.length === 0
                ? "The last scan found none."
                : `${vulns[0].name} on ${vulns[0].site}.${vulns[0].fixed_in ? ` Fixed in ${vulns[0].fixed_in}.` : ""}`}
            </p>
          </Stat>
          <Stat label="Waiting on you" icon="message" tone="neutral" n={approvals + live.length} unit={approvals + live.length === 1 ? "decision" : "decisions"}>
            <ul className="mix-key lines">
              <li>
                <b>{approvals}</b> {approvals === 1 ? "change" : "changes"} waiting for approval on sites
              </li>
              <li>
                <b>{live.length}</b> AI {live.length === 1 ? "plan" : "plans"} to confirm
              </li>
            </ul>
          </Stat>
        </div>
        <div className="ov-split">
          <div className="ov-col">
            <section className="card" aria-label="Needs attention">
              <div className="card-head">
                <h2>
                  Needs attention {fixes > 0 && <span className="tag warning">{fixes}</span>}
                </h2>
                <span className="dim">Fix each one from here</span>
              </div>
              {fixes === 0 && <p className="quiet">Nothing needs you right now.</p>}
              <ul className="fixes">
                {needs.map((s) => {
                  const st = siteStatus(s);
                  const again = s.sign_in_again || noTools(s);
                  return (
                    <Fix
                      key={s.id}
                      icon={s.health === "down" ? "unplug" : again ? "login" : "alert"}
                      tone={st.tone === "danger" ? "danger" : "warning"}
                      title={`${s.name}: ${st.tone === "ok" ? "Classic Monks is older" : st.label}`}
                      action={
                        again ? (
                          <Button small onClick={() => onSignInAgain(s.id)}>
                            Sign in again
                          </Button>
                        ) : s.health === "down" ? (
                          <Button small onClick={() => onCheck(s.id)}>
                            <Glyph name="refresh" />
                            Check again
                          </Button>
                        ) : (
                          <Button small onClick={() => onOpen(s.id)}>
                            Open in Sites
                          </Button>
                        )
                      }
                    >
                      {attention(s)}
                    </Fix>
                  );
                })}
                {vulns.length > 0 && onGo && (
                  <Fix
                    icon="shield"
                    tone="danger"
                    title={vulns.length === 1 ? `${vulns[0].name} ${vulns[0].installed} has a known vulnerability` : `${vulns.length} known vulnerabilities`}
                    action={
                      <Button small onClick={() => onGo("Security")}>
                        Open Security
                      </Button>
                    }
                  >
                    {vulns.length === 1
                      ? `On ${vulns[0].site}.${vulns[0].fixed_in ? ` Fixed in ${vulns[0].fixed_in}.` : " No fix yet."}`
                      : `On ${plural(new Set(vulns.map((v) => v.site)).size, "site")}. Security shows each one and its fix.`}
                  </Fix>
                )}
                {live.length > 0 && onGo && (
                  <Fix
                    icon="sparkle"
                    tone="ink"
                    title={live.length === 1 ? `An AI agent wants to: ${live[0].title}` : `${live.length} AI agent plans are waiting`}
                    action={
                      <Button small onClick={() => onGo("AI")}>
                        Review the plan{live.length === 1 ? "" : "s"}
                      </Button>
                    }
                  >
                    {live.length === 1 ? `Asked ${ago(live[0].created_at)}. ` : ""}Nothing runs until you confirm.
                  </Fix>
                )}
                {waiting.length > 0 && onGo && (
                  <Fix
                    icon="download"
                    tone=""
                    title={`${plural(waiting.length, "update is", "updates are")} waiting on ${plural(updateSites, "site")}`}
                    action={
                      <Button small kind="soft" onClick={() => onGo("Updates")}>
                        Review updates
                      </Button>
                    }
                  >
                    You review each change before it runs.
                  </Fix>
                )}
              </ul>
              {slows.map((s) => (
                <p key={s.id} className="quiet">
                  <Status tone="info">Note</Status> {s.name}. {s.health_detail} It still works.
                </p>
              ))}
            </section>
            <section className="card" aria-labelledby="yours-t">
              <div className="card-head">
                <h2 id="yours-t">Your sites</h2>
                {onGo && (
                  <button type="button" className="link" onClick={() => onGo("Sites")}>
                    Open Sites
                    <Glyph name="arrow" />
                  </button>
                )}
              </div>
              <table className="t">
                <caption className="sr-only">
                  {sites.length > SHOW_SITES ? `${SHOW_SITES} of your ${sites.length} sites, the ones that need you first` : "Your sites"}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Site</th>
                    <th scope="col">Status</th>
                    <th scope="col">WordPress</th>
                    <th scope="col" className="r">
                      Uptime, 30 days
                    </th>
                    <th scope="col" className="r">
                      Response
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {listed.map((s) => {
                    const st = siteStatus(s);
                    const m = mon.get(s.id);
                    return (
                      <tr key={s.id} className={st.tone === "danger" || st.tone === "warning" ? "warn" : ""}>
                        <td>
                          <span className="site">
                            <SiteTile site={s} />
                            <span>
                              <b>{s.name}</b>
                              <small>{s.url.replace(/^https?:\/\//, "")}</small>
                            </span>
                          </span>
                        </td>
                        <td>
                          <span className={`st pill ${st.tone}`}>
                            <Icon tone={st.tone} />
                            {st.label}
                          </span>
                        </td>
                        <td className="m">{s.wp_version ?? <span className="dim">not known</span>}</td>
                        <td className="m r">{pct(m?.uptime_month)}</td>
                        <td className="m r">{m?.up ? `${m.ms} ms` : <span className="dim">none</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </section>
          </div>
          <div className="ov-col">
            <Feed onGo={onGo} />
            <section className="card" aria-labelledby="versions-t">
              <div className="card-head">
                <h2 id="versions-t">Versions</h2>
                <span className="dim">How many of your sites run each version</span>
              </div>
              <div className="dist">
                <Dist label="WordPress" versions values={sites.map((s) => s.wp_version ?? UNKNOWN)} />
                <Dist label="PHP" versions values={sites.map((s) => s.php_version?.split(".").slice(0, 2).join(".") ?? UNKNOWN)} />
                <Dist
                  label="Connection"
                  values={sites.map((s) => (s.mode === "basic" ? "Basic mode" : noTools(s) ? `${pluginName(s)}, no tools` : s.capabilities.degraded ? `${pluginName(s)}, older` : pluginName(s)))}
                />
              </div>
            </section>
          </div>
        </div>
        <p className="note">Monks Central checks your sites while it is open. Sites cannot send alerts to it on their own.</p>
      </div>
    </div>
  );
}
